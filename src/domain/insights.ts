import { addDays, addMonths, compareISO } from '@/domain/dates'
import { periodDays, periodRange } from '@/domain/period'
import { compareLines, type RecurringLine } from '@/domain/recurring'
import { budgetAmount } from '@/domain/splits'
import { categoryKeyOf, computeMonthSummary, UNCATEGORIZED_ID, type MonthSummary } from '@/domain/summary'
import type { AppData, Category, Cents, ISODate, MonthKey, Transaction } from '@/domain/types'

/**
 * Series and lists derived from the data for charts and suggestions (docs/SPEC.md §4.6). Given the
 * categories, a category filter counts each expense under the category byCategory files it under
 * (categoryKeyOf: an expense of a deleted category counts as UNCATEGORIZED_ID), so a chart or a
 * suggestion list for a byCategory row adds up to that row. Spending counts at its budget amount
 * (§4.9): your share of a split expense, nothing for an expense paid from the wallet. Lists hold
 * existing references, never copies.
 */

export interface DayAmount {
  date: ISODate
  amount: Cents
}

export interface TrendPoint {
  month: MonthKey
  fixed: Cents
  daily: Cents
  income: Cents
}

export interface CategoryTrendPoint {
  month: MonthKey
  fixed: Cents
  daily: Cents
  total: Cents
}

/** A note and amount entered at least twice recently, offered as a suggestion chip. */
export interface FrequentEntry {
  note: string
  amount: Cents
  categoryId: string
  count: number
}

/** Options of frequentEntries. */
export interface FrequentEntriesOptions {
  /** How many days to look back, today included. Default 60. */
  days?: number
  /** The most entries to return. Default 4. */
  limit?: number
  /** Only the expenses that count under this category (see `categories`). */
  categoryId?: string
  /**
   * Every category, archived ones included. Given these, an expense counts under the category
   * byCategory files it under, so an expense of a deleted category counts as UNCATEGORIZED_ID.
   * Without them, an expense counts under its stored id, or UNCATEGORIZED_ID when it has none.
   */
  categories?: readonly Category[]
}

/** `count` periods ending at `endMonth`, oldest first. Throws a RangeError unless count is a whole number ≥ 0. */
function periodsEndingAt(endMonth: MonthKey, count: number): MonthKey[] {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Not a number of periods: ${count}`)
  return Array.from({ length: count }, (_, i) => addMonths(endMonth, i - count + 1))
}

/**
 * The category a filter counts an expense under. Given `categories`, this is byCategory's mapping
 * (categoryKeyOf): the expense's own category id when that category exists, else UNCATEGORIZED_ID.
 * Without them, it is the id as stored, with none read as UNCATEGORIZED_ID.
 */
function categoryKeys(categories: readonly Category[] | undefined): (categoryId: string | null) => string {
  if (categories === undefined) return (categoryId) => categoryId ?? UNCATEGORIZED_ID
  const known = new Set(categories.map(({ id }) => id))
  return (categoryId) => categoryKeyOf(categoryId, known)
}

/**
 * Spending per day of the period, zero-filled, one entry per day: Σ budgetAmount of the day's
 * expenses (your share; 0 for wallet-paid ones), so the series adds up to the summary's `daily`.
 * With `categoryId`, only the expenses that count under that category. Pass `categories` (all of
 * them, archived ones included) to count them the way byCategory does. Then UNCATEGORIZED_ID also
 * covers the expenses of deleted categories, the id of a deleted category matches nothing, and the
 * series adds up to the row's `daily`. Without `categories`, ids are compared as stored, and an
 * expense without one counts as UNCATEGORIZED_ID.
 */
export function dailySeries(
  transactions: readonly Transaction[],
  month: MonthKey,
  startDay: number,
  categoryId?: string,
  categories?: readonly Category[],
): DayAmount[] {
  const { start, end } = periodRange(month, startDay)
  const keyOf = categoryKeys(categories)
  const byDate = new Map<ISODate, Cents>()
  for (const tx of transactions) {
    if (tx.kind !== 'expense') continue
    if (categoryId !== undefined && keyOf(tx.categoryId) !== categoryId) continue
    if (compareISO(tx.date, start) < 0 || compareISO(tx.date, end) > 0) continue
    byDate.set(tx.date, (byDate.get(tx.date) ?? 0) + budgetAmount(tx))
  }
  return Array.from({ length: periodDays(month, startDay) }, (_, i) => {
    const date = addDays(start, i)
    return { date, amount: byDate.get(date) ?? 0 }
  })
}

/** `count` periods ending at `endMonth`, oldest first: fixed, daily and income of each summary. */
export function trend(data: AppData, endMonth: MonthKey, count: number, today: ISODate): TrendPoint[] {
  return periodsEndingAt(endMonth, count).map((month) => {
    const { fixed, daily, income } = computeMonthSummary(data, month, today)
    return { month, fixed, daily, income }
  })
}

/**
 * One category over `count` periods ending at `endMonth`, oldest first, from each summary's
 * byCategory row (zeros when absent). UNCATEGORIZED_ID gives the merged row of unknown categories.
 */
export function categoryTrend(
  data: AppData,
  categoryId: string,
  endMonth: MonthKey,
  count: number,
  today: ISODate,
): CategoryTrendPoint[] {
  return periodsEndingAt(endMonth, count).map((month) => {
    const row = computeMonthSummary(data, month, today).byCategory.find((r) => r.categoryId === categoryId)
    return { month, fixed: row?.fixed ?? 0, daily: row?.daily ?? 0, total: row?.total ?? 0 }
  })
}

/**
 * Current period only: unpaid, unskipped fixed charge lines due from today to the period end,
 * by dueDate, order, name; at most `limit` (default 4). Lines without a due date are left out.
 */
export function upcomingFixed(summary: MonthSummary, today: ISODate, limit = 4): RecurringLine[] {
  if (summary.timing !== 'current') return []
  const { end } = summary.range
  return summary.fixedLines
    .filter(
      (line) =>
        line.isChargeMonth &&
        !line.paid &&
        !line.skipped &&
        line.dueDate !== null &&
        compareISO(line.dueDate, today) >= 0 &&
        compareISO(line.dueDate, end) <= 0,
    )
    .toSorted(compareLines)
    .slice(0, Math.max(0, limit))
}

/**
 * Average daily spending, at budget amounts (§4.9): current → round(Σ budgetAmount of the expenses
 * dated up to today / dayIndex), so entries dated later in the period do not count yet; past →
 * round(daily / days); future → null.
 */
export function dailyAverage(summary: MonthSummary): Cents | null {
  const { timing, dayIndex } = summary
  if (timing === 'past') return Math.round(summary.daily / summary.days)
  if (timing === 'future' || dayIndex === null) return null

  const today = addDays(summary.range.start, dayIndex - 1)
  let spent = 0
  for (const tx of summary.transactions) {
    if (tx.kind === 'expense' && compareISO(tx.date, today) <= 0) spent += budgetAmount(tx)
  }
  return Math.round(spent / dayIndex)
}

/** A run of expenses with the same note, amount and category. */
interface EntryGroup {
  /** Trimmed, whitespace collapsed, lower-cased: the note part of the group key. */
  noteKey: string
  amount: Cents
  categoryId: string
  count: number
  /** The latest expense of the group by (date, createdAt). Its trimmed note is shown. */
  latest: Transaction
}

/** The note as frequentEntries groups it: trimmed, whitespace collapsed, lower-cased. */
function noteKeyOf(note: string): string {
  return note.trim().replace(/\s+/gu, ' ').toLowerCase()
}

/** Later by date, then by createdAt. */
function isLater(a: Transaction, b: Transaction): boolean {
  const byDate = compareISO(a.date, b.date)
  return byDate > 0 || (byDate === 0 && a.createdAt > b.createdAt)
}

/** Code-unit order: the same on every device, unlike localeCompare. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

/** Most entered first, then most recently entered, then by key (note, amount, category). */
function compareGroups(a: EntryGroup, b: EntryGroup): number {
  if (a.count !== b.count) return b.count - a.count
  if (isLater(a.latest, b.latest)) return -1
  if (isLater(b.latest, a.latest)) return 1
  return (
    compareStrings(a.noteKey, b.noteKey) || a.amount - b.amount || compareStrings(a.categoryId, b.categoryId)
  )
}

/**
 * Notes entered at least twice in the last `days` days (default 60, today included, future dates
 * excluded) with the same amount and category, most frequent first, at most `limit` (default 4).
 * Notes match after trimming, collapsing whitespace and lower-casing; empty notes never count.
 * Each entry shows the trimmed note of the group's latest expense. An expense's category is the one
 * it counts under (FrequentEntriesOptions.categories), for grouping, for the `categoryId` filter and
 * in the result. A suggestion fills in a new budget expense, so it carries the full amount (a split
 * expense too), and expenses paid from the wallet are left out.
 */
export function frequentEntries(
  transactions: readonly Transaction[],
  today: ISODate,
  o: FrequentEntriesOptions = {},
): FrequentEntry[] {
  const { days = 60, limit = 4, categoryId, categories } = o
  if (days < 1) return []
  // 0 ≤ diffDays(date, today) ≤ days − 1, as a date range.
  const first = addDays(today, -(days - 1))
  const keyOf = categoryKeys(categories)

  const groups = new Map<string, EntryGroup>()
  for (const tx of transactions) {
    if (tx.kind !== 'expense' || tx.fromWallet) continue
    const txCategoryId = keyOf(tx.categoryId)
    if (categoryId !== undefined && txCategoryId !== categoryId) continue
    if (compareISO(tx.date, first) < 0 || compareISO(tx.date, today) > 0) continue
    const noteKey = noteKeyOf(tx.note)
    if (noteKey === '') continue

    // JSON keeps the three parts apart whatever characters the note contains.
    const key = JSON.stringify([noteKey, tx.amount, txCategoryId])
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, { noteKey, amount: tx.amount, categoryId: txCategoryId, count: 1, latest: tx })
    } else {
      group.count += 1
      if (isLater(tx, group.latest)) group.latest = tx
    }
  }

  return [...groups.values()]
    .filter((group) => group.count >= 2)
    .toSorted(compareGroups)
    .slice(0, Math.max(0, limit))
    .map((group) => ({
      note: group.latest.note.trim(),
      amount: group.amount,
      categoryId: group.categoryId,
      count: group.count,
    }))
}
