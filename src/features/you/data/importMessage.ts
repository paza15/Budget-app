import type { ParsedBackup } from '@/domain/backup'
import { dateLocaleFor, formatDate, localDateOf, parseISODate } from '@/domain/dates'
import { droppedCount } from '@/domain/normalize'
import type { AppData, ISODate } from '@/domain/types'

/** The words of the import confirmation (docs/SPEC.md §3.7). Pure: the caller passes the clock. */

/** "1 entry", "3 entries": a count with the matching form of its noun. */
export function countOf(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "no entries", "1 entry", "41 entries". */
export function entriesPhrase(n: number): string {
  return n === 0 ? 'no entries' : countOf(n, 'entry', 'entries')
}

/** "no fixed costs or income items", "1 fixed cost or income item", "9 fixed costs and income items". */
export function recurringPhrase(n: number): string {
  if (n === 0) return 'no fixed costs or income items'
  return n === 1 ? '1 fixed cost or income item' : `${n} fixed costs and income items`
}

/**
 * Entries on this iPhone that were added or changed after `since` (epoch ms), so a backup made at
 * `since` does not hold them as they are now.
 */
export function entriesNewerThan(data: AppData, since: number): number {
  let count = 0
  for (const tx of data.transactions) {
    if (Math.max(tx.createdAt, tx.updatedAt) > since) count += 1
  }
  return count
}

/** "14 Oct" in the current year, else "14 Oct 2025" (en-US: "Oct 14", "Oct 14, 2025"). */
export function backupDateLabel(epochMs: number, today: ISODate, numberLocale: string): string {
  const date = localDateOf(epochMs)
  const short = formatDate(date, numberLocale, 'short')
  const { y } = parseISODate(date)
  if (y === parseISODate(today).y) return short
  return dateLocaleFor(numberLocale) === 'en-US' ? `${short}, ${y}` : `${short} ${y}`
}

/**
 * The message of "Replace everything on this iPhone?": what the backup holds, what this iPhone
 * holds (and how much of it is newer than the backup), and how many damaged rows the file loses.
 * "The backup from 14 Oct has 9 entries and 2 fixed costs and income items. This iPhone has 41
 * entries, 3 of them newer than the backup. Settings and categories are replaced too."
 */
export function importConfirmMessage(backup: ParsedBackup, current: AppData, now: number): string {
  const exportedAt = Date.parse(backup.exportedAt)
  const from = Number.isFinite(exportedAt)
    ? ` from ${backupDateLabel(exportedAt, localDateOf(now), current.settings.locale)}`
    : ''
  const here = current.transactions.length
  const newer = Number.isFinite(exportedAt) ? entriesNewerThan(current, exportedAt) : 0
  const damaged = droppedCount(backup.report)
  const sentences = [
    `The backup${from} has ${entriesPhrase(backup.data.transactions.length)} and ${recurringPhrase(backup.data.recurring.length)}.`,
    `This iPhone has ${entriesPhrase(here)}${newer > 0 ? `, ${newer} of them newer than the backup` : ''}.`,
    'Settings and categories are replaced too.',
  ]
  if (damaged > 0) sentences.push(`${countOf(damaged, 'damaged entry', 'damaged entries')} in the file will be skipped.`)
  return sentences.join(' ')
}
