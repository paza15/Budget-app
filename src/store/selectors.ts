import { categoryTrend, trend, type CategoryTrendPoint, type TrendPoint } from '@/domain/insights'
import { monthReview, unreviewedClosedMonth, type MonthReview } from '@/domain/review'
import { owedSummary, type OwedSummary } from '@/domain/splits'
import { computeMonthSummary, type MonthSummary } from '@/domain/summary'
import type { AppData, Category, ISODate, MonthKey } from '@/domain/types'
import { walletSummary, type WalletSummary } from '@/domain/wallet'

/**
 * Memoised derived data (docs/SPEC.md §5.4). Plain functions, safe to call during render: results
 * are cached per AppData object, so a new value appears only when the data changes, and the same
 * inputs return the same object between renders.
 */

/** Results per data object. A replaced data object takes its cache with it. */
const cache = new WeakMap<AppData, Map<string, unknown>>()

/**
 * Caches `compute()` per data object (WeakMap<AppData, Map<string, unknown>>) under `key`. The key
 * must name everything else the result depends on (month, today, …).
 */
export function memoByData<T>(data: AppData, key: string, compute: () => T): T {
  let results = cache.get(data)
  if (results === undefined) {
    results = new Map()
    cache.set(data, results)
  }
  if (results.has(key)) return results.get(key) as T
  const value = compute()
  results.set(key, value)
  return value
}

/** A cache key from parts that may contain any characters. */
function keyOf(...parts: readonly (string | number)[]): string {
  return JSON.stringify(parts)
}

/** computeMonthSummary, memoised per data object, month and today. */
export function getMonthSummary(data: AppData, month: MonthKey, today: ISODate): MonthSummary {
  return memoByData(data, keyOf('summary', month, today), () => computeMonthSummary(data, month, today))
}

/** trend (fixed, daily and income of `count` periods ending at `endMonth`), memoised. */
export function getTrend(data: AppData, endMonth: MonthKey, count: number, today: ISODate): TrendPoint[] {
  return memoByData(data, keyOf('trend', endMonth, count, today), () => trend(data, endMonth, count, today))
}

/** categoryTrend for one category, memoised. */
export function getCategoryTrend(
  data: AppData,
  categoryId: string,
  endMonth: MonthKey,
  count: number,
  today: ISODate,
): CategoryTrendPoint[] {
  return memoByData(data, keyOf('categoryTrend', categoryId, endMonth, count, today), () =>
    categoryTrend(data, categoryId, endMonth, count, today),
  )
}

/**
 * The wallet as of `today` (walletSummary, §4.8, §4.9): balance, pending result, goals filled from
 * the balance and the passbook, memoised per data object and day.
 */
export function getWalletSummary(data: AppData, today: ISODate): WalletSummary {
  return memoByData(data, keyOf('wallet', today), () => walletSummary(data, today))
}

/** What people owe you (owedSummary, §3.16, §4.9), memoised per data object. */
export function getOwedSummary(data: AppData): OwedSummary {
  return memoByData(data, keyOf('owed'), () => owedSummary(data))
}

/** The month-end review of `month` (monthReview, §3.15, §4.9), memoised per data object, month and day. */
export function getMonthReview(data: AppData, month: MonthKey, today: ISODate): MonthReview {
  return memoByData(data, keyOf('review', month, today), () => monthReview(data, month, today))
}

/** The closed period the month-end banner offers, or null (unreviewedClosedMonth, §3.15), memoised. */
export function getUnreviewedMonth(data: AppData, today: ISODate): MonthKey | null {
  return memoByData(data, keyOf('unreviewed', today), () => unreviewedClosedMonth(data, today))
}

/**
 * Every category by id, archived ones included, as an object without a prototype, so an id such
 * as 'constructor' finds nothing. Use it with categoryDisplay.
 */
export function categoryMapOf(categories: readonly Category[]): Readonly<Record<string, Category>> {
  const map: Record<string, Category> = Object.create(null) as Record<string, Category>
  for (const category of categories) map[category.id] = category
  return map
}

/** categoryMapOf the data's categories, memoised (for event handlers; components use useCategoryMap). */
export function getCategoryMap(data: AppData): Readonly<Record<string, Category>> {
  return memoByData(data, keyOf('categoryMap'), () => categoryMapOf(data.categories))
}
