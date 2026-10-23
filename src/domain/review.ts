import { BEFORE_APP_NOTE } from '@/domain/constants'
import { addMonths, compareISO, localDateOf } from '@/domain/dates'
import { dailySeries } from '@/domain/insights'
import { periodOf } from '@/domain/period'
import { budgetAmount } from '@/domain/splits'
import { computeMonthSummary, type CategorySpend } from '@/domain/summary'
import type { AppData, Cents, ISODate, MonthKey, Transaction } from '@/domain/types'
import { monthResult, walletStart, walletSummary } from '@/domain/wallet'

/**
 * The month-end review (docs/SPEC.md §3.15, §4.9): the statement of a closed period, compared with
 * the period before it, and which closed period still waits to be reviewed. Spending counts at
 * budget amounts (your share; wallet-paid expenses are not part of the month). Onboarding's "Before
 * On a Budget" entry (§3.9 step 5) totals what was spent before the install: it counts as spending,
 * but it is never the biggest expense, and days without spending count from the install on. Pure:
 * everything comes from the data and `today`.
 */

/** A category with daily spending in the reviewed period: one of the top five, or behind the fold. */
export interface ReviewCategory {
  categoryId: string
  /** Daily spending in the reviewed period (its byCategory row). */
  daily: Cents
  /** The same category's daily spending in the period before (0 when it had none). */
  previous: Cents
  /**
   * (daily − previous) / previous: 0.12 reads "12% more", −0.12 "12% less", 0 "the same"; null
   * when previous is 0 ("New").
   */
  change: number | null
}

export interface MonthReview {
  month: MonthKey
  /** The period the categories are compared with: the one before `month` under the current start day. */
  previousMonth: MonthKey
  /**
   * income − fixed − daily (§4.8): what moved into the wallet, or out of it when negative. Always
   * savings + left.
   */
  result: Cents
  /** The period's savings goal (§4.5): the part of the result set aside on purpose. */
  savings: Cents
  /** available − daily (§4.5): what was left over, negative after an overspend. */
  left: Cents
  income: Cents
  fixed: Cents
  daily: Cents
  /**
   * The top 5 categories by daily spending (above 0), highest first; ties by category order
   * (Uncategorized last), then id.
   */
  categories: ReviewCategory[]
  /**
   * Every further category with daily spending (above 0), in the same order and with the same
   * comparison: what the "{n} more" fold holds (docs/design/EXTRAS.md §1.4). Empty when at most 5
   * categories had spending.
   */
  rest: ReviewCategory[]
  /** How many more categories had daily spending (above 0) than `categories` lists: rest.length. */
  moreCategories: number
  /**
   * The expense with the largest budget amount (the newest on a tie), or null when none counts.
   * Never onboarding's "Before On a Budget" entry, which totals what was spent before the install.
   */
  biggestExpense: Transaction | null
  /**
   * Days without budget spending from the period's first day or the install day (the local date of
   * settings.createdAt), whichever is later, up to the period's last day or today, whichever is
   * earlier. The days before the install were not tracked, so a period that ended before it has 0.
   */
  noSpendDays: number
  /** Expenses that count against the period (wallet-paid ones do not). */
  entries: number
  /** Fixed-cost charge lines ticked off as paid. */
  fixedPaid: number
  /**
   * Fixed-cost charge lines (§4.4) of the period that are not skipped: the "of 6" in "6 of 6". A
   * skipped cost is not due, so a month can still end with everything paid.
   */
  fixedCount: number
  /** Σ open splits on the period's expenses: what people still owe you for them. */
  owedOpen: Cents
  /** The wallet's running balance after every movement up to the period's last day, its closing included. */
  walletAfter: Cents
}

/** How many categories the review lists. */
const TOP_CATEGORIES = 5

/** Code-unit order: the same on every device, unlike localeCompare. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

/**
 * The rows with daily spending, the highest first; ties by category order (Uncategorized last),
 * then id, as byCategory breaks them. Each with the previous period's daily spending in that
 * category and the change against it.
 */
function rankedCategories(
  spendingRows: readonly CategorySpend[],
  previousRows: readonly CategorySpend[],
  categoryOrder: ReadonlyMap<string, number>,
): ReviewCategory[] {
  const previousDaily = new Map(previousRows.map((row) => [row.categoryId, row.daily]))
  const rank = (categoryId: string): number => categoryOrder.get(categoryId) ?? Number.POSITIVE_INFINITY
  return spendingRows
    .toSorted((a, b) => {
      if (a.daily !== b.daily) return b.daily - a.daily
      const rankA = rank(a.categoryId)
      const rankB = rank(b.categoryId)
      if (rankA !== rankB) return rankA < rankB ? -1 : 1
      return compareStrings(a.categoryId, b.categoryId)
    })
    .map(({ categoryId, daily }) => {
      const previous = previousDaily.get(categoryId) ?? 0
      return { categoryId, daily, previous, change: previous > 0 ? (daily - previous) / previous : null }
    })
}

/**
 * The review of `month` (§3.15, §4.9), meant for a past period. Compares with the period before it
 * (previousMonth) under the current start day. noSpendDays counts the days from the install up to
 * today, so a period that is still running reports the days so far. walletAfter is the running
 * balance after the last movement dated on or before the period's last day: for a closed period ≥
 * the wallet's start that is its closing movement, which comes last on its date.
 */
export function monthReview(data: AppData, month: MonthKey, today: ISODate): MonthReview {
  const startDay = data.settings.monthStartDay
  const previousMonth = addMonths(month, -1)
  const summary = computeMonthSummary(data, month, today)
  const before = computeMonthSummary(data, previousMonth, today)
  const categoryOrder = new Map(data.categories.map((category) => [category.id, category.order]))

  let biggestExpense: Transaction | null = null
  let biggestAmount = 0
  let entries = 0
  let owedOpen = 0
  // Newest first, so on a tie the newest expense stays the biggest.
  for (const tx of summary.transactions) {
    if (tx.kind !== 'expense') continue
    const amount = budgetAmount(tx)
    // Onboarding's total of everything spent before the install is not one purchase (§3.9 step 5).
    if (amount > biggestAmount && tx.note !== BEFORE_APP_NOTE) {
      biggestExpense = tx
      biggestAmount = amount
    }
    if (!tx.fromWallet) entries += 1
    for (const split of tx.splits) {
      if (split.status === 'open') owedOpen += split.amount
    }
  }

  // Before the install nothing was tracked day by day (onboarding's entry totals those days).
  const installed = localDateOf(data.settings.createdAt)
  const noSpendDays = dailySeries(summary.transactions, month, startDay).filter(
    (day) => day.amount === 0 && compareISO(installed, day.date) <= 0 && compareISO(day.date, today) <= 0,
  ).length

  let walletAfter = 0
  for (const movement of walletSummary(data, today).movements) {
    if (compareISO(movement.date, summary.range.end) > 0) break
    walletAfter = movement.balance
  }

  const ranked = rankedCategories(
    summary.byCategory.filter((row) => row.daily > 0),
    before.byCategory,
    categoryOrder,
  )
  const rest = ranked.slice(TOP_CATEGORIES)
  const chargeLines = summary.fixedLines.filter((line) => line.isChargeMonth)

  return {
    month,
    previousMonth,
    result: monthResult(summary),
    savings: summary.savings,
    left: summary.left,
    income: summary.income,
    fixed: summary.fixed,
    daily: summary.daily,
    categories: ranked.slice(0, TOP_CATEGORIES),
    rest,
    moreCategories: rest.length,
    biggestExpense,
    noSpendDays,
    entries,
    // Only charge lines can be paid, and a skipped one never is.
    fixedPaid: chargeLines.filter((line) => line.paid).length,
    fixedCount: chargeLines.filter((line) => !line.skipped).length,
    owedOpen,
    walletAfter,
  }
}

/**
 * The closed period the month-end banner offers (§3.15): the latest closed period (the one before
 * today's, under the current start day) when it is newer than settings.lastReviewedMonth (or none
 * was reviewed) and not before the wallet's start; else null. So a new install, whose wallet starts
 * with the current period, has nothing to review.
 */
export function unreviewedClosedMonth(data: AppData, today: ISODate): MonthKey | null {
  const latestClosed = addMonths(periodOf(today, data.settings.monthStartDay), -1)
  const { lastReviewedMonth } = data.settings
  if (lastReviewedMonth !== null && compareISO(latestClosed, lastReviewedMonth) <= 0) return null
  return compareISO(latestClosed, walletStart(data)) >= 0 ? latestClosed : null
}
