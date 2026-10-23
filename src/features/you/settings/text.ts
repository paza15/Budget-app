import { parseISODate } from '@/domain/dates'
import type { CategoryKind, ISODate } from '@/domain/types'

/**
 * Small text helpers of the settings pages (docs/SPEC.md §3.7): counts in words, lists in
 * sentences, the category kinds and a search key. Copy rules: sentence case, no " · " joins.
 */

/** "1 expense", "12 expenses". */
export function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "A", "A and B", "A, B and C" (no serial comma, as the rest of the app writes lists). */
export function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`
}

/** How many records use a category (queries.ts CategoryUsage). */
export interface UsageCounts {
  transactions: number
  recurring: number
  quickAdds: number
}

/**
 * What deleting a used category moves (§3.7), counting only what there is: "12 expenses, 1 fixed
 * cost and 2 quick adds", "3 expenses". Every transaction with a category is an expense, and
 * every recurring item with one is a fixed cost.
 */
export function usageWords(usage: UsageCounts): string {
  const parts: string[] = []
  if (usage.transactions > 0) parts.push(countOf(usage.transactions, 'expense', 'expenses'))
  if (usage.recurring > 0) parts.push(countOf(usage.recurring, 'fixed cost', 'fixed costs'))
  if (usage.quickAdds > 0) parts.push(countOf(usage.quickAdds, 'quick add', 'quick adds'))
  return joinWords(parts)
}

/** "Show in" of the category sheet (§3.7): where a category is offered first. */
export const KIND_OPTIONS: { value: CategoryKind; label: string }[] = [
  { value: 'fixed', label: 'Fixed costs' },
  { value: 'daily', label: 'Daily spending' },
  { value: 'both', label: 'Both' },
]

/** The kind as a row subtitle on the Categories page: "Both" alone would say nothing there. */
export function kindLabel(kind: CategoryKind): string {
  switch (kind) {
    case 'fixed':
      return 'Fixed costs'
    case 'daily':
      return 'Daily spending'
    default:
      return 'Fixed and daily'
  }
}

/**
 * Local midnight at the start of `today` (from useToday), in epoch ms. Components never read the
 * clock during render, so rules measured in days (the backup reminder dot, §4.6) take this as
 * "now" and switch at most a day late, at the midnight useToday re-renders on.
 */
export function startOfDayMs(today: ISODate): number {
  const { y, m, d } = parseISODate(today)
  return new Date(y, m - 1, d).getTime()
}

/** Lower case without accents, so "zloty" finds "Polish złoty" and "eur" finds "EUR". */
export function searchKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/gu, 'l')
    .replace(/Ł/gu, 'L')
    .toLocaleLowerCase('en')
    .trim()
}
