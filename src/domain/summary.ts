import { compareISO } from '@/domain/dates'
import { sumCents } from '@/domain/money'
import {
  dayIndexInPeriod,
  daysLeftInPeriod,
  periodDays,
  periodRange,
  periodTiming,
  type PeriodRange,
  type PeriodTiming,
} from '@/domain/period'
import { linesFor, type RecurringLine } from '@/domain/recurring'
import { budgetAmount } from '@/domain/splits'
import type { AppData, Category, Cents, ISODate, MonthKey, Transaction } from '@/domain/types'

/**
 * Month summary: the numbers behind Home, Daily and Fixed (docs/SPEC.md §4.5). Everything is
 * integer cents; lines, rows and transactions reference the stored objects, never copies.
 *
 * Expenses count at their budget amount (§4.9, splits.ts): your share of a split expense, and
 * nothing for an expense paid from the wallet, which leaves the month alone. So daily, todaySpent,
 * perDay, pace and the byCategory amounts and counts never include a wallet-paid expense. It is
 * still an expense of the period: it appears in `transactions` and gives its category a byCategory
 * row, as any expense does.
 */

/**
 * "No known category": expenses loaded without a category get this id, and byCategory merges
 * every unknown category id into one row under it.
 */
export const UNCATEGORIZED_ID = '__none__'

/**
 * The id that byCategory files a category reference under (§4.5): `categoryId` itself when it names
 * an existing category, archived ones included; otherwise UNCATEGORIZED_ID, which covers null,
 * UNCATEGORIZED_ID itself and the ids of deleted categories. `known` holds the ids of every
 * category, as a Set of ids or a Map keyed by id. Every category filter uses this mapping
 * (dailySeries, frequentEntries, and the lists of category detail and Daily), so what a filter
 * shows adds up to that category's byCategory row.
 */
export function categoryKeyOf(categoryId: string | null, known: { has(id: string): boolean }): string {
  return categoryId !== null && known.has(categoryId) ? categoryId : UNCATEGORIZED_ID
}

/** none: no limit set. warning: at least 85% of the limit used. over: above the limit. */
export type BudgetStatus = 'none' | 'ok' | 'warning' | 'over'

/** One category's share of a period. */
export interface CategorySpend {
  categoryId: string
  fixed: Cents
  /** Σ budgetAmount of the category's expenses in the period (your share; wallet-paid ones count 0). */
  daily: Cents
  /** fixed + daily. */
  total: Cents
  budget: Cents | null
  /** Number of expense transactions, wallet-paid ones left out. */
  count: number
  status: BudgetStatus
}

export interface PaceInfo {
  /** dayIndex / days in the current period, else null. */
  timeRatio: number | null
  /** daily / available (1 when nothing is available but something was spent). */
  spendRatio: number
  /** over: left < 0. ahead: spending runs more than 10 points ahead of time. */
  status: 'ok' | 'ahead' | 'over'
}

export interface MonthSummary {
  month: MonthKey
  range: PeriodRange
  timing: PeriodTiming
  days: number
  /** Today's 1-based day in the period, or null when today is outside it. */
  dayIndex: number | null
  /** Days left including today: current → days − dayIndex + 1; past → 0; future → days. */
  daysLeft: number
  incomeRecurring: Cents
  incomeOneOff: Cents
  /** incomeRecurring + incomeOneOff. */
  income: Cents
  /** Sum of the fixed-cost lines. */
  fixed: Cents
  /**
   * Σ budgetAmount of the expenses in the period: your share of each, and 0 for expenses paid from
   * the wallet.
   */
  daily: Cents
  savings: Cents
  /** fixed + daily. */
  spent: Cents
  /** income − fixed − savings: what there is for daily life. */
  available: Cents
  /** available − daily. Negative when over budget. */
  left: Cents
  /** current → floor((left + todaySpent) / daysLeft); future → floor(left / days); past → null. */
  perDay: Cents | null
  /** Σ budgetAmount of the expenses dated today (current period only, else 0). */
  todaySpent: Cents
  /** current → perDay − todaySpent, else null. */
  todayLeft: Cents | null
  pace: PaceInfo
  fixedLines: RecurringLine[]
  incomeLines: RecurringLine[]
  /** Sorted by total desc, then category order (Uncategorized last), then id. */
  byCategory: CategorySpend[]
  /**
   * Transactions in the period, wallet-paid expenses included (the lists show them), by date desc,
   * then createdAt desc.
   */
  transactions: Transaction[]
}

/** What computePace needs: the period's money for daily life and today's place in it. */
export interface PaceInput {
  available: Cents
  daily: Cents
  days: number
  /** Today's 1-based day in the period; null unless the period is the current one. */
  dayIndex: number | null
}

/** Code-unit order: the same on every device, unlike localeCompare. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

/** Newest first: by date desc, then createdAt desc. */
function compareNewestFirst(a: Transaction, b: Transaction): number {
  return compareISO(b.date, a.date) || b.createdAt - a.createdAt
}

/** The period's own savings goal when it has one (0 included), else the general one. */
function savingsFor(data: AppData, month: MonthKey): Cents {
  const own = Object.hasOwn(data.months, month) ? data.months[month]?.savingsGoal : undefined
  return own ?? data.settings.savingsGoal
}

/**
 * How daily spending keeps pace with the period (§4.5):
 * - spendRatio = daily / available, or (when nothing is available) 1 once anything is spent;
 * - timeRatio = dayIndex / days in the current period, else null;
 * - status 'over' when left < 0; 'ahead' in the current period when spendRatio > timeRatio + 0.10,
 *   compared in integers as 10 × daily × days > available × (10 × dayIndex + days); else 'ok'.
 */
export function computePace(o: PaceInput): PaceInfo {
  const { available, daily, days, dayIndex } = o
  let spendRatio = 0
  if (available > 0) spendRatio = daily / available
  else if (daily > 0) spendRatio = 1

  let status: PaceInfo['status'] = 'ok'
  if (available - daily < 0) status = 'over'
  else if (dayIndex !== null && available > 0 && 10 * daily * days > available * (10 * dayIndex + days)) {
    status = 'ahead'
  }
  return { timeRatio: dayIndex === null ? null : dayIndex / days, spendRatio, status }
}

/** none when budget is null or 0; over when spent > budget; warning from 85%; else ok. */
export function budgetStatus(spent: Cents, budget: Cents | null): BudgetStatus {
  if (budget === null || budget <= 0) return 'none'
  if (spent > budget) return 'over'
  return 100 * spent >= 85 * budget ? 'warning' : 'ok'
}

interface CategoryTotals {
  fixed: Cents
  daily: Cents
  count: number
}

/**
 * byCategory (§4.5, §4.9). A category gets a row when it has a fixed line with an amount above 0,
 * at least one expense in the period, or (not archived) a budget of at least 1. Expenses add their
 * budget amount and count once each, except that a wallet-paid expense leaves the month alone: it
 * makes its category's row like any expense of the period (the Daily chips and category detail list
 * it), but adds nothing to it and is not counted. Ids that are not in `categories` (and null) merge
 * into one UNCATEGORIZED_ID row without a budget (categoryKeyOf).
 */
function spendByCategory(
  categories: readonly Category[],
  fixedLines: readonly RecurringLine[],
  transactions: readonly Transaction[],
): CategorySpend[] {
  const known = new Map(categories.map((category) => [category.id, category]))
  const totals = new Map<string, CategoryTotals>()
  const totalsOf = (categoryId: string | null): CategoryTotals => {
    const id = categoryKeyOf(categoryId, known)
    let entry = totals.get(id)
    if (entry === undefined) {
      entry = { fixed: 0, daily: 0, count: 0 }
      totals.set(id, entry)
    }
    return entry
  }

  for (const line of fixedLines) {
    if (line.amount > 0) totalsOf(line.recurring.categoryId).fixed += line.amount
  }
  for (const tx of transactions) {
    if (tx.kind !== 'expense') continue
    const entry = totalsOf(tx.categoryId)
    // 0 for a wallet-paid expense, which is not counted either (§4.9).
    entry.daily += budgetAmount(tx)
    if (!tx.fromWallet) entry.count += 1
  }
  for (const category of categories) {
    if (!category.archived && category.budget !== null && category.budget >= 1) totalsOf(category.id)
  }

  const rows: CategorySpend[] = []
  for (const [categoryId, { fixed, daily, count }] of totals) {
    const budget = known.get(categoryId)?.budget ?? null
    const total = fixed + daily
    rows.push({ categoryId, fixed, daily, total, budget, count, status: budgetStatus(total, budget) })
  }

  // Uncategorized has no place in the category order, so it comes after every category.
  const rank = (row: CategorySpend): number => known.get(row.categoryId)?.order ?? Number.POSITIVE_INFINITY
  return rows.toSorted((a, b) => {
    if (a.total !== b.total) return b.total - a.total
    const rankA = rank(a)
    const rankB = rank(b)
    if (rankA !== rankB) return rankA < rankB ? -1 : 1
    return compareStrings(a.categoryId, b.categoryId)
  })
}

/**
 * Computes everything for one period (§4.5, expenses at their budget amount §4.9) as of `today`.
 * Memoise per AppData with store/selectors.ts. Throws a RangeError for an invalid month, date or
 * start day.
 */
export function computeMonthSummary(data: AppData, month: MonthKey, today: ISODate): MonthSummary {
  const startDay = data.settings.monthStartDay
  const range = periodRange(month, startDay)
  const timing = periodTiming(month, today, startDay)
  const days = periodDays(month, startDay)
  const dayIndex = dayIndexInPeriod(today, month, startDay)
  const daysLeft = daysLeftInPeriod(month, today, startDay)

  const incomeLines = linesFor(data.recurring, 'income', month, data.months, startDay)
  const fixedLines = linesFor(data.recurring, 'expense', month, data.months, startDay)
  // ISO dates compare as strings, so the range check needs no date parsing per transaction.
  const transactions = data.transactions
    .filter((tx) => compareISO(range.start, tx.date) <= 0 && compareISO(tx.date, range.end) <= 0)
    .toSorted(compareNewestFirst)

  let incomeOneOff = 0
  let daily = 0
  // Only the current period contains today, so this stays 0 for past and future periods.
  let todaySpent = 0
  for (const tx of transactions) {
    if (tx.kind === 'income') {
      incomeOneOff += tx.amount
    } else if (tx.kind === 'expense') {
      // Your share; 0 when paid from the wallet (§4.9).
      const amount = budgetAmount(tx)
      daily += amount
      if (tx.date === today) todaySpent += amount
    }
  }

  const incomeRecurring = sumCents(incomeLines.map((line) => line.amount))
  const fixed = sumCents(fixedLines.map((line) => line.amount))
  const income = incomeRecurring + incomeOneOff
  const savings = savingsFor(data, month)
  const available = income - fixed - savings
  const left = available - daily

  let perDay: Cents | null = null
  let todayLeft: Cents | null = null
  if (timing === 'current') {
    // What was left this morning (left + todaySpent), spread over the days left including today.
    perDay = Math.floor((left + todaySpent) / daysLeft)
    todayLeft = perDay - todaySpent
  } else if (timing === 'future') {
    perDay = Math.floor(left / days)
  }

  return {
    month,
    range,
    timing,
    days,
    dayIndex,
    daysLeft,
    incomeRecurring,
    incomeOneOff,
    income,
    fixed,
    daily,
    savings,
    spent: fixed + daily,
    available,
    left,
    perDay,
    todaySpent,
    todayLeft,
    pace: computePace({ available, daily, days, dayIndex }),
    fixedLines,
    incomeLines,
    byCategory: spendByCategory(data.categories, fixedLines, transactions),
    transactions,
  }
}
