import { withUndo } from '@/app/undo'
import {
  BACKUP_ERROR_MESSAGES,
  backupFileName,
  createBackup,
  csvFileName,
  parseBackup,
  serializeBackup,
  transactionsToCsv,
  type ParsedBackup,
} from '@/domain/backup'
import { DataError } from '@/domain/normalize'
import type { AppData } from '@/domain/types'
import { importConfirmMessage } from '@/features/you/data/importMessage'
import { holdSystemSheet } from '@/features/you/data/systemSheet'
import { actions } from '@/store/actions'
import { getData } from '@/store/appStore'
import { importData } from '@/store/persistence'
import { confirmDialog, toast } from '@/ui'

export { BackupFileInput, type BackupFileInputProps } from '@/features/you/data/BackupFileInput'

/**
 * Files in and out of the app (docs/SPEC.md §3.7, §4.7, §5.7): backups and the CSV leave through
 * the share sheet or a download, and backups come back in through the file picker. The shell's
 * error fallback, storage screen and banners and the onboarding's "Restore from a backup" use
 * these too, so names and signatures stay as §5.7 lists them.
 */

/** How a file left the app: through the share sheet, as a download, or not at all. */
export type SaveResult = 'shared' | 'downloaded' | 'cancelled'

/** A download's object URL lives this long: iOS reads the file after the tap has returned. */
export const REVOKE_AFTER_MS = 60_000

/** "Backup restored" offers Undo this long (§3.7). */
export const IMPORT_UNDO_MS = 10_000

/**
 * Bigger than any real backup (some 250,000 entries); reading it would only stall the iPhone. The
 * limit keeps a wrong pick, such as a video, from being read into memory.
 */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024

/** What the user reads when a file cannot be read at all (not a DataError). */
export const READ_FAILED_MESSAGE =
  "Couldn't open this file. If it's in iCloud Drive, download it in the Files app, then try again."

/** What the user reads when a confirmed import could not replace the data. */
export const IMPORT_FAILED_MESSAGE =
  "Couldn't restore the backup, so nothing was replaced. Close the app completely, open it again and try again."

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/** The share sheet can take this file: share and canShare exist, and canShare({ files }) agrees. */
function canShareFile(file: File): boolean {
  if (typeof navigator === 'undefined') return false
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

/** Downloads the file through a temporary <a download> with an object URL, revoked after 60 s. */
function download(file: File): SaveResult {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.rel = 'noopener'
  link.hidden = true
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
  }
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
  return 'downloaded'
}

/**
 * Hands a file to the share sheet when it can take files (`share({ files })`, nothing else, so iOS
 * offers "Save to Files"), else downloads it. A cancelled share sheet (AbortError) resolves
 * 'cancelled'; a share that fails otherwise (no user activation left, a type it refuses) falls back
 * to the download. systemSheetOpen is up while the share sheet is open.
 *
 * Call it from a tap handler before any await: share() runs before this function first awaits, so
 * it still counts as started by the tap.
 */
export async function saveFile(file: File): Promise<SaveResult> {
  if (canShareFile(file)) {
    const release = holdSystemSheet()
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (error) {
      if (isAbortError(error)) return 'cancelled'
      // Anything else: the download below still gets the file out.
    } finally {
      release()
    }
  }
  return download(file)
}

/**
 * Exports everything as `on-a-budget-backup-YYYY-MM-DD.json` (§4.7). The file is built from the
 * current data synchronously, inside the caller's tap handler, and handed straight to saveFile.
 * Marks the backup done (settings.lastBackupAt) only when it was shared or downloaded. The caller
 * shows the "Backup exported" toast.
 */
export async function exportBackup(): Promise<SaveResult> {
  const now = Date.now()
  const text = serializeBackup(createBackup(getData(), now))
  const result = await saveFile(new File([text], backupFileName(now), { type: 'application/json' }))
  if (result !== 'cancelled') actions.markBackupDone()
  return result
}

/** Exports every entry as `on-a-budget-spending-YYYY-MM-DD.csv` (§4.7); same rules as exportBackup. */
export function exportCsv(): Promise<SaveResult> {
  const now = Date.now()
  return saveFile(new File([transactionsToCsv(getData())], csvFileName(now), { type: 'text/csv' }))
}

/**
 * Reads and checks a backup file, whatever type the system gave it (iOS often reports none).
 * Rejects with a DataError whose message is meant for the user (§4.7: not a backup, newer version,
 * damaged), or with an Error carrying READ_FAILED_MESSAGE when the file cannot be read.
 */
export async function readBackupFile(file: File): Promise<ParsedBackup> {
  if (file.size > MAX_BACKUP_BYTES) throw new DataError('not-backup', BACKUP_ERROR_MESSAGES['not-backup'])
  let text: string
  try {
    text = await file.text()
  } catch (error) {
    throw new Error(READ_FAILED_MESSAGE, { cause: error })
  }
  return parseBackup(text, Date.now())
}

export interface ImportOptions {
  /**
   * Onboarding's "Restore from a backup" (§3.9 step 1): the restored data keeps onboarding open
   * (settings.onboarded false), so it can go on at the lock step, which no backup holds, and
   * finish there. Undo returns to the empty first-run data.
   */
  continueOnboarding?: boolean
}

/**
 * The data to put in place. The backup itself is the newest backup of this data, so the last
 * backup counts from its export (at most now): the backup nudge does not ask for a backup the user
 * has just restored from.
 */
function importedData({ data, exportedAt }: ParsedBackup, o: ImportOptions, now: number): AppData {
  const exported = Date.parse(exportedAt)
  const backupAt = Number.isFinite(exported) ? Math.min(exported, now) : null
  const lastBackupAt =
    backupAt === null ? data.settings.lastBackupAt : Math.max(data.settings.lastBackupAt ?? backupAt, backupAt)
  const onboarded = o.continueOnboarding === true ? false : data.settings.onboarded
  if (lastBackupAt === data.settings.lastBackupAt && onboarded === data.settings.onboarded) return data
  return { ...data, settings: { ...data.settings, lastBackupAt, onboarded } }
}

/**
 * Imports a backup file after asking (§3.7): reads it, asks "Replace everything on this iPhone?"
 * with what the file and this iPhone hold, then replaces all data (importData keeps a copy of the
 * old data first) and shows "Backup restored" with Undo for 10 s. The app lock is not part of
 * backups and stays as it is.
 *
 * Resolves true once imported, false when the user said no or it failed; failures are told in a
 * toast (the file's problem, or that nothing was replaced). Never rejects. Call it from the file
 * input's change handler.
 */
export async function importWithConfirm(file: File, o: ImportOptions = {}): Promise<boolean> {
  let backup: ParsedBackup
  try {
    backup = await readBackupFile(file)
  } catch (error) {
    // A DataError says what is wrong with the file in words for the user; anything else is told as
    // a file that could not be read, never with its technical message.
    toast({ message: error instanceof DataError ? error.message : READ_FAILED_MESSAGE, tone: 'critical' })
    return false
  }

  const replace = await confirmDialog({
    title: 'Replace everything on this iPhone?',
    message: importConfirmMessage(backup, getData(), Date.now()),
    confirmLabel: 'Replace',
    destructive: true,
  })
  if (!replace) return false

  const data = importedData(backup, o, Date.now())
  try {
    await withUndo('Backup restored', () => importData(data), { durationMs: IMPORT_UNDO_MS })
  } catch {
    toast({ message: IMPORT_FAILED_MESSAGE, tone: 'critical' })
    return false
  }
  return true
}
