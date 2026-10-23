import { compareISO, dateLocaleFor, monthName, parseISODate } from '@/domain/dates'
import { categoryDisplay } from '@/domain/queries'
import type { CategorySpend } from '@/domain/summary'
import type { Category, Cents, HomeCardKey, ISODate, MonthKey, Transaction } from '@/domain/types'
import type { WalletSummary } from '@/domain/wallet'
import type { StackedBarSegment } from '@/ui/charts'

/**
 * What Home's cards show (docs/SPEC.md §3.1), as pure functions of the month summary and the
 * stored data, so each rule is unit-tested apart from the screen.
 */

/** Limits shows at most this many rows, then "Show all {n}". */
export const LIMIT_ROWS = 5

/** Recent shows the latest five expenses of the period. */
export const RECENT_ROWS = 5

/** The trend covers this many periods, ending with the selected one. */
export const TREND_PERIODS = 6

const STATUS_RANK: Readonly<Record<CategorySpend['status'], number>> = { over: 0, warning: 1, ok: 2, none: 3 }

/** How much of its limit a row has used. */
function share(row: CategorySpend): number {
  return row.budget !== null && row.budget > 0 ? row.total / row.budget : 0
}

/**
 * The Limits card's rows: one per category that exists, is not archived and has a limit; over the
 * limit first, then near it, then by the share of the limit used, highest first (ties keep the
 * summary's order). A limit covers fixed costs and daily spending together (row.total).
 */
export function limitRows(rows: readonly CategorySpend[], categories: Readonly<Record<string, Category>>): CategorySpend[] {
  return rows
    .filter((row) => {
      if (row.budget === null || row.budget < 1 || !Object.hasOwn(categories, row.categoryId)) return false
      return categories[row.categoryId]?.archived === false
    })
    .toSorted((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || share(b) - share(a))
}

/**
 * Where it went: one segment per category with daily spending in the period (your share; nothing
 * for an expense paid from the wallet, §4.9), in the category's ink. Unknown categories are the
 * summary's Uncategorized row, drawn in the neutral ink. foldSegments sorts and folds them.
 */
export function spendingSegments(
  rows: readonly CategorySpend[],
  categories: Readonly<Record<string, Category>>,
): StackedBarSegment[] {
  return rows
    .filter((row) => row.daily > 0)
    .map((row) => {
      const display = categoryDisplay(row.categoryId, categories)
      return { key: row.categoryId, value: row.daily, color: display.color ?? 'other', label: display.name }
    })
}

/** The latest expenses of the period, newest first (the summary's order), wallet-paid ones included. */
export function recentExpenses(transactions: readonly Transaction[], limit = RECENT_ROWS): Transaction[] {
  const expenses: Transaction[] = []
  for (const tx of transactions) {
    if (tx.kind !== 'expense') continue
    expenses.push(tx)
    if (expenses.length === limit) break
  }
  return expenses
}

/** The trend's periods from the first period with data on (SPEC §3.1: only periods ≥ firstPeriod). */
export function trendPoints<T extends { month: MonthKey }>(points: readonly T[], first: MonthKey): T[] {
  return points.filter((point) => compareISO(point.month, first) >= 0)
}

/** The trend shows once two of its periods have a fixed cost or an expense (SPEC §3.1). */
export function trendHasData(points: readonly { fixed: Cents; daily: Cents }[]): boolean {
  let periods = 0
  for (const point of points) if (point.fixed > 0 || point.daily > 0) periods += 1
  return periods >= 2
}

/**
 * Whether the Home Wallet card has something to say: a balance, a movement of money, or a result
 * the current period will add or take. A wallet with none of these (a first run, or months that
 * closed at 0,00 €) counts as empty when Home decides whether every card is empty.
 */
export function walletHasContent(wallet: WalletSummary): boolean {
  return (
    wallet.balance !== 0 ||
    wallet.movements.some((movement) => movement.amount !== 0) ||
    (wallet.pending !== null && wallet.pending !== 0)
  )
}

/** Home cards in the user's order; 'equation' is no card (it shows the sums inside the hero). */
export function cardOrder(homeCards: readonly HomeCardKey[]): Exclude<HomeCardKey, 'equation'>[] {
  const cards: Exclude<HomeCardKey, 'equation'>[] = []
  for (const key of homeCards) if (key !== 'equation' && !cards.includes(key)) cards.push(key)
  return cards
}

/** "30 September" (en-GB) or "September 30" (en-US): the day a statement closed, for VoiceOver. */
export function dayAndMonth(date: ISODate, locale: string): string {
  const { m, d } = parseISODate(date)
  return dateLocaleFor(locale) === 'en-US' ? `${monthName(m)} ${d}` : `${d} ${monthName(m)}`
}

/** "Last 6 months", or "6 months to September" when the selected period is not the current one. */
export function trendTitle(isCurrent: boolean, name: string): string {
  return isCurrent ? `Last ${TREND_PERIODS} months` : `${TREND_PERIODS} months to ${name}`
}

/**
 * Local midnight at the start of `date` (from useToday), in epoch ms. Components never read the
 * clock while rendering, so day-based rules (the backup reminder) take this as "now" and switch at
 * the midnight useToday re-renders on.
 */
export function startOfDayMs(date: ISODate): number {
  const { y, m, d } = parseISODate(date)
  return new Date(y, m - 1, d).getTime()
}
