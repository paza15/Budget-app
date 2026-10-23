import { APP_ID } from '@/domain/constants'
import { compareISO, localDateOf } from '@/domain/dates'
import { CURRENT_SCHEMA_VERSION } from '@/domain/defaults'
import { centsToDecimalString, currencyDigits } from '@/domain/money'
import { DataError, isRecord, normalizeAppData, ownValue } from '@/domain/normalize'
import type { DataErrorCode, NormalizeReport } from '@/domain/normalize'
import { UNCATEGORIZED_DISPLAY } from '@/domain/queries'
import { myShare } from '@/domain/splits'
import type { AppData, Transaction } from '@/domain/types'

/**
 * Backup files and CSV export (docs/SPEC.md §4.7). The security config (PIN hash, passkey id) is
 * never part of either: it is stored apart from AppData and only works on the device anyway.
 */

/** The JSON file written by "Export backup". */
export interface BackupFile {
  app: 'on-a-budget'
  kind: 'backup'
  /** Must equal data.schemaVersion; a mismatch makes the file damaged. */
  schemaVersion: number
  /** ISO timestamp of the export. */
  exportedAt: string
  data: AppData
}

/** A backup file read back and normalised. */
export interface ParsedBackup {
  data: AppData
  report: NormalizeReport
  /** The file's export time, as written (an ISO timestamp). */
  exportedAt: string
}

/** What parseBackup's DataError says for each code, shown to the user as is. */
export const BACKUP_ERROR_MESSAGES: Readonly<Record<DataErrorCode, string>> = {
  'not-backup': "This file isn't an On a Budget backup.",
  'newer-version':
    'This backup was made by a newer version of the app. Close the app, open it again to update, then import again.',
  damaged: "This backup is damaged and can't be imported.",
}

/** U+FEFF: tells spreadsheet apps (Excel, Numbers) that the CSV is UTF-8. Editors may add it to JSON. */
const BYTE_ORDER_MARK = '\u{FEFF}'
const CRLF = '\r\n'
const CSV_HEADER = 'date,type,category,note,amount,currency,my_share,paid_from'

function backupError(code: DataErrorCode, cause?: unknown): DataError {
  return new DataError(code, BACKUP_ERROR_MESSAGES[code], cause === undefined ? undefined : { cause })
}

/** Wraps the data for export; schemaVersion is data.schemaVersion, exportedAt the ISO time of `now`. */
export function createBackup(data: AppData, now: number): BackupFile {
  return {
    app: APP_ID,
    kind: 'backup',
    schemaVersion: data.schemaVersion,
    // An instant, not a calendar date, so toISOString (UTC) is the right format here.
    exportedAt: new Date(now).toISOString(),
    data,
  }
}

/** The file's text content: indented JSON, so the file stays readable in the Files app. */
export function serializeBackup(b: BackupFile): string {
  return `${JSON.stringify(b, null, 2)}\n`
}

/**
 * Reads a backup file's text (a leading byte order mark is ignored) and normalises its data.
 * Throws DataError with the BACKUP_ERROR_MESSAGES text:
 * - not-backup: not JSON, or JSON without `app: 'on-a-budget'` and `kind: 'backup'`. Text that is
 *   not JSON but names the app is a backup cut short, so it counts as damaged instead.
 * - newer-version: `data.schemaVersion` is newer than this build's (the outer field is ignored).
 * - damaged: `data` is missing, the outer schemaVersion differs from `data.schemaVersion`,
 *   `exportedAt` is not a timestamp, or normalizeAppData finds the data unusable.
 */
export function parseBackup(text: string, now: number): ParsedBackup {
  const json = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text
  let file: unknown
  try {
    file = JSON.parse(json)
  } catch (error) {
    throw backupError(json.includes(`"${APP_ID}"`) ? 'damaged' : 'not-backup', error)
  }

  if (!isRecord(file) || ownValue(file, 'app') !== APP_ID || ownValue(file, 'kind') !== 'backup') {
    throw backupError('not-backup')
  }

  const data = ownValue(file, 'data')
  if (!isRecord(data)) throw backupError('damaged')
  const dataVersion = ownValue(data, 'schemaVersion')
  if (Number.isSafeInteger(dataVersion) && (dataVersion as number) > CURRENT_SCHEMA_VERSION) {
    throw backupError('newer-version')
  }
  if (ownValue(file, 'schemaVersion') !== dataVersion) throw backupError('damaged')

  const exportedAt = ownValue(file, 'exportedAt')
  if (typeof exportedAt !== 'string' || Number.isNaN(Date.parse(exportedAt))) throw backupError('damaged')

  try {
    const { data: normalized, report } = normalizeAppData(data, now)
    return { data: normalized, report, exportedAt }
  } catch (error) {
    // normalizeAppData throws only DataError; reword it for a backup file.
    if (error instanceof DataError) throw backupError(error.code, error)
    throw error
  }
}

/** "on-a-budget-backup-YYYY-MM-DD.json", with the local date of `now`. */
export function backupFileName(now: number): string {
  return `${APP_ID}-backup-${localDateOf(now)}.json`
}

/** A value that a spreadsheet would read as a formula: =, +, -, @, tab or carriage return first. */
const FORMULA_START = /^[=+\-@\t\r]/

/** Characters that need the field quoted. */
const NEEDS_QUOTES = /[",\r\n]/

/**
 * Escapes free text for CSV: a leading formula character gets a ' prefix, so spreadsheets show
 * the text instead of running it; then the field is quoted, inner quotes doubled, when it holds a
 * comma, quote, CR or LF.
 */
function csvField(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** Code-unit order, the same on every engine (localeCompare is not). */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

/** Oldest first: by date, then creation time, then id, so the order is the same every time. */
function byDateThenCreated(a: Transaction, b: Transaction): number {
  return compareISO(a.date, b.date) || a.createdAt - b.createdAt || compareStrings(a.id, b.id)
}

/**
 * Every transaction as CSV: UTF-8 with BOM, CRLF after every row (the last too), header
 * `date,type,category,note,amount,currency,my_share,paid_from`, formula-safe escaping of category
 * and note (§4.7). Expenses name their category ("Uncategorized" when it no longer exists), their
 * share after splits (§4.9 myShare) and where the money came from, `budget` or `wallet` (§3.13);
 * income has none of the three. Amounts are positive plain decimals in the currency's digits
 * ("3.50", JPY "350").
 */
export function transactionsToCsv(data: AppData): string {
  const { currency } = data.settings
  const digits = currencyDigits(currency)
  const categoryNames = new Map(data.categories.map(({ id, name }) => [id, name]))
  const lines = data.transactions.toSorted(byDateThenCreated).map((tx) => {
    const amount = centsToDecimalString(Math.abs(tx.amount), digits)
    if (tx.kind === 'income') return [tx.date, tx.kind, '', csvField(tx.note), amount, currency, '', ''].join(',')
    const category = (tx.categoryId === null ? undefined : categoryNames.get(tx.categoryId)) ?? UNCATEGORIZED_DISPLAY.name
    const share = centsToDecimalString(myShare(tx), digits)
    const paidFrom = tx.fromWallet ? 'wallet' : 'budget'
    return [tx.date, tx.kind, csvField(category), csvField(tx.note), amount, currency, share, paidFrom].join(',')
  })
  return BYTE_ORDER_MARK + [CSV_HEADER, ...lines].map((line) => line + CRLF).join('')
}

/** "on-a-budget-spending-YYYY-MM-DD.csv", with the local date of `now`. */
export function csvFileName(now: number): string {
  return `${APP_ID}-spending-${localDateOf(now)}.csv`
}
