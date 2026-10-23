import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CategoryTrendPoint, TrendPoint } from '@/domain/insights'
import { createMoneyFormat, type MoneyFormat } from '@/domain/money'
import { sortedCategories } from '@/domain/queries'
import type { MonthReview } from '@/domain/review'
import type { OwedSummary } from '@/domain/splits'
import type { MonthSummary } from '@/domain/summary'
import type { AppData, Category, MonthKey, Settings } from '@/domain/types'
import type { WalletSummary } from '@/domain/wallet'
import { useAppStore } from '@/store/appStore'
import {
  categoryMapOf,
  getCategoryTrend,
  getMonthReview,
  getMonthSummary,
  getOwedSummary,
  getTrend,
  getUnreviewedMonth,
  getWalletSummary,
} from '@/store/selectors'
import { useToday } from '@/store/today'
import { useUiStore } from '@/store/uiStore'

/**
 * How components read the data (docs/SPEC.md §5.4). Zustand 5 has no selector equality: a selector
 * returns a store value unchanged, a primitive, or (inside useShallow) a flat object or array of
 * existing references. Derived data comes from selectors.ts or useMemo.
 */

/**
 * Subscribes to part of the data through useShallow: the component re-renders only when the
 * selected value, or one of the references in a selected flat array or object, changes. The
 * selector must not compute or allocate anything else (`d => d.quickAdds`,
 * `d => [d.settings.currency, d.settings.locale]`).
 */
export function useData<T>(selector: (d: AppData) => T): T {
  return useAppStore(useShallow((state) => selector(state.data)))
}

export function useSettings(): Settings {
  return useAppStore((state) => state.data.settings)
}

/** sortedCategories over the store's categories, memoised. */
export function useCategories(o: { includeArchived?: boolean; kind?: 'fixed' | 'daily' } = {}): Category[] {
  const categories = useAppStore((state) => state.data.categories)
  const includeArchived = o.includeArchived ?? false
  const kind = o.kind
  return useMemo(() => sortedCategories(categories, { includeArchived, kind }), [categories, includeArchived, kind])
}

/** Every category by id, archived ones included. */
export function useCategoryMap(): Readonly<Record<string, Category>> {
  const categories = useAppStore((state) => state.data.categories)
  return useMemo(() => categoryMapOf(categories), [categories])
}

/** getMonthSummary(data, month, useToday()). */
export function useMonthSummary(month: MonthKey): MonthSummary {
  const data = useAppStore((state) => state.data)
  const today = useToday()
  return getMonthSummary(data, month, today)
}

/** Fixed, daily and income of `count` periods ending at `endMonth`, oldest first. */
export function useTrend(endMonth: MonthKey, count: number): TrendPoint[] {
  const data = useAppStore((state) => state.data)
  const today = useToday()
  return getTrend(data, endMonth, count, today)
}

/** One category's fixed, daily and total over `count` periods ending at `endMonth`, oldest first. */
export function useCategoryTrend(categoryId: string, endMonth: MonthKey, count: number): CategoryTrendPoint[] {
  const data = useAppStore((state) => state.data)
  const today = useToday()
  return getCategoryTrend(data, categoryId, endMonth, count, today)
}

/**
 * The wallet as of today (§4.8, §4.9): balance, the current period's pending result, the goals
 * filled from the balance and the passbook. The same object until the data or the day changes.
 */
export function useWallet(): WalletSummary {
  const data = useAppStore((state) => state.data)
  const today = useToday()
  return getWalletSummary(data, today)
}

/** What people owe you, by person (§3.16). The same object until the data changes. */
export function useOwed(): OwedSummary {
  const data = useAppStore((state) => state.data)
  return getOwedSummary(data)
}

/** The month-end review of `month` (§3.15). The same object until the data or the day changes. */
export function useMonthReview(month: MonthKey): MonthReview {
  const data = useAppStore((state) => state.data)
  const today = useToday()
  return getMonthReview(data, month, today)
}

/**
 * The closed period whose review the Home banner offers (§3.15), or null: the latest closed
 * period when it is newer than settings.lastReviewedMonth and not before the wallet's start.
 * Follows the day, so a period that closes while the app is open shows up at midnight.
 */
export function useUnreviewedMonth(): MonthKey | null {
  const data = useAppStore((state) => state.data)
  const today = useToday()
  return getUnreviewedMonth(data, today)
}

/**
 * The MoneyFormat for MoneyFormatContext: currency, locale, showCents and masking (hideAmounts on
 * and the amounts not revealed with the eye button).
 */
export function useMoneyFormat(): MoneyFormat {
  const currency = useAppStore((state) => state.data.settings.currency)
  const locale = useAppStore((state) => state.data.settings.locale)
  const showCents = useAppStore((state) => state.data.settings.showCents)
  const hideAmounts = useAppStore((state) => state.data.settings.hideAmounts)
  const revealed = useUiStore((state) => state.amountsRevealed)
  const masked = hideAmounts && !revealed
  return useMemo(() => createMoneyFormat({ currency, locale, showCents, masked }), [currency, locale, showCents, masked])
}
