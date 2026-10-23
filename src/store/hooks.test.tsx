import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { categoryTrend, trend } from '@/domain/insights'
import { MASKED } from '@/domain/money'
import { sortedCategories } from '@/domain/queries'
import { monthReview } from '@/domain/review'
import { owedSummary } from '@/domain/splits'
import { computeMonthSummary } from '@/domain/summary'
import { NOW, sampleData, TODAY } from '@/domain/test-helpers/dataFixtures'
import type { MonthKey } from '@/domain/types'
import { walletSummary } from '@/domain/wallet'
import { actions } from '@/store/actions'
import { getData, useAppStore } from '@/store/appStore'
import {
  useCategories,
  useCategoryMap,
  useCategoryTrend,
  useData,
  useMonthReview,
  useMonthSummary,
  useMoneyFormat,
  useOwed,
  useSettings,
  useTrend,
  useUnreviewedMonth,
  useWallet,
} from '@/store/hooks'
import { useUiStore } from '@/store/uiStore'

/** A change to the data that no hook in these tests reads. */
function unrelatedChange(): void {
  act(() => {
    actions.addTransaction({ kind: 'income', amount: 100, categoryId: null, date: '2026-01-05' })
  })
}

/** A store update that keeps the data object: hooks that read the data must not render again. */
function sameDataUpdate(): void {
  act(() => useAppStore.setState({ status: 'ready' }))
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  useAppStore.setState({ data: sampleData(), status: 'ready' })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document, 'visibilityState')
  vi.useRealTimers()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useUiStore.setState(useUiStore.getInitialState(), true)
})

describe('useData', () => {
  it('re-renders only when a selected reference changes', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useData((d) => [d.settings.currency, d.quickAdds] as const)
    })
    const first = result.current
    expect(first).toEqual([getData().settings.currency, getData().quickAdds])

    unrelatedChange()
    expect(result.current).toBe(first)
    expect(renders).toBe(1)

    act(() => actions.updateSettings({ currency: 'USD' }))
    expect(result.current[0]).toBe('USD')
    expect(result.current[1]).toBe(first[1])
    expect(renders).toBe(2)
  })

  it('selects primitives and store values', () => {
    const { result } = renderHook(() => useData((d) => d.transactions.length))
    const count = result.current
    unrelatedChange()
    expect(result.current).toBe(count + 1)
  })
})

describe('useSettings', () => {
  it('returns the settings object and follows its changes', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current).toBe(getData().settings)
    unrelatedChange()
    expect(result.current).toBe(getData().settings)
    act(() => actions.updateSettings({ name: 'Sam' }))
    expect(result.current.name).toBe('Sam')
  })
})

describe('useCategories', () => {
  it('lists active categories by order, memoised until the categories change', () => {
    const { result, rerender } = renderHook(() => useCategories())
    const first = result.current
    expect(first).toEqual(sortedCategories(getData().categories))
    expect(first.map(({ id }) => id)).not.toContain('cat-gym')

    rerender()
    unrelatedChange()
    expect(result.current).toBe(first)

    act(() => actions.updateCategory('cat-books', { name: 'Reading' }))
    expect(result.current).not.toBe(first)
    expect(result.current.find(({ id }) => id === 'cat-books')?.name).toBe('Reading')
  })

  it('includes archived categories and filters by kind on request', () => {
    const { result: all } = renderHook(() => useCategories({ includeArchived: true }))
    expect(all.current.map(({ id }) => id)).toContain('cat-gym')

    const { result: daily } = renderHook(() => useCategories({ kind: 'daily' }))
    expect(daily.current.every(({ kind }) => kind === 'daily' || kind === 'both')).toBe(true)
    expect(daily.current.map(({ id }) => id)).toContain('cat-transport')
    expect(daily.current.map(({ id }) => id)).not.toContain('cat-rent')
  })
})

describe('useCategoryMap', () => {
  it('maps every category by id, archived ones included, and stays stable', () => {
    const { result } = renderHook(() => useCategoryMap())
    const first = result.current
    expect(first['cat-gym']?.archived).toBe(true)
    expect(Object.hasOwn(first, 'constructor')).toBe(false)
    unrelatedChange()
    expect(result.current).toBe(first)
  })
})

describe('summaries and trends', () => {
  it('useMonthSummary computes the period as of today, memoised per data', () => {
    const { result, rerender } = renderHook(() => useMonthSummary('2026-10'))
    const first = result.current
    expect(first).toEqual(computeMonthSummary(getData(), '2026-10', TODAY))
    rerender()
    expect(result.current).toBe(first)

    act(() => actions.addTransaction({ kind: 'expense', amount: 500, categoryId: 'cat-coffee', date: TODAY }))
    expect(result.current).not.toBe(first)
    expect(result.current.daily).toBe(first.daily + 500)
  })

  it('useTrend and useCategoryTrend follow the domain', () => {
    const { result: overall } = renderHook(() => useTrend('2026-10', 6))
    expect(overall.current).toEqual(trend(getData(), '2026-10', 6, TODAY))
    const { result: coffee } = renderHook(() => useCategoryTrend('cat-coffee', '2026-10', 6))
    expect(coffee.current).toEqual(categoryTrend(getData(), 'cat-coffee', '2026-10', 6, TODAY))
  })
})

describe('useWallet', () => {
  it('gives the wallet as of today, the same object until the data changes', () => {
    let renders = 0
    const { result, rerender } = renderHook(() => {
      renders += 1
      return useWallet()
    })
    const first = result.current
    expect(first).toEqual(walletSummary(getData(), TODAY))
    rerender()
    expect(result.current).toBe(first)
    sameDataUpdate()
    expect(result.current).toBe(first)
    expect(renders).toBe(2)

    act(() => {
      actions.addWalletEntry({ kind: 'deposit', amount: 2500, date: TODAY })
    })
    expect(renders).toBe(3)
    expect(result.current).not.toBe(first)
    expect(result.current.balance).toBe(first.balance + 2500)
  })

  it('follows the goals', () => {
    const { result } = renderHook(() => useWallet())
    expect(result.current.goals.map(({ goal }) => goal.id)).toEqual(['goal-laptop', 'goal-trip'])
    act(() => actions.setGoalDone('goal-laptop', true))
    expect(result.current.goals.map(({ goal }) => goal.id)).toEqual(['goal-trip'])
    expect(result.current.goals[0]?.goal).toBe(getData().wallet.goals.find(({ id }) => id === 'goal-trip'))
  })
})

describe('useOwed', () => {
  it('gives what people owe, the same object until the data changes', () => {
    let renders = 0
    const { result, rerender } = renderHook(() => {
      renders += 1
      return useOwed()
    })
    const first = result.current
    expect(first).toEqual(owedSummary(getData()))
    expect(first.people.map(({ person }) => person)).toEqual(['Jonas'])
    rerender()
    sameDataUpdate()
    expect(result.current).toBe(first)
    expect(renders).toBe(2)

    act(() => actions.setSplitStatus('tx-book', 'split-jonas', 'paid'))
    expect(result.current).toEqual({ total: 0, people: [] })
  })
})

describe('useMonthReview', () => {
  it('reviews a period, the same object for the same month until the data changes', () => {
    const { result, rerender } = renderHook(({ month }: { month: MonthKey }) => useMonthReview(month), {
      initialProps: { month: '2026-09' },
    })
    const september = result.current
    expect(september).toEqual(monthReview(getData(), '2026-09', TODAY))
    rerender({ month: '2026-09' })
    sameDataUpdate()
    expect(result.current).toBe(september)

    rerender({ month: '2026-08' })
    expect(result.current).toEqual(monthReview(getData(), '2026-08', TODAY))
    rerender({ month: '2026-09' })
    expect(result.current).toBe(september)

    act(() => {
      actions.addTransaction({ kind: 'expense', amount: 1000, categoryId: 'cat-coffee', date: '2026-09-20' })
    })
    expect(result.current).not.toBe(september)
    expect(result.current.daily).toBe(september.daily + 1000)
  })
})

describe('useUnreviewedMonth', () => {
  it('offers the closed period until it is reviewed, and the next one when it closes', () => {
    const data = sampleData()
    useAppStore.setState({ data: { ...data, settings: { ...data.settings, lastReviewedMonth: '2026-08' } } })
    const { result } = renderHook(() => useUnreviewedMonth())
    expect(result.current).toBe('2026-09')

    act(() => actions.markReviewed('2026-09'))
    expect(result.current).toBeNull()

    // The app comes back on 1 November, after October has closed.
    vi.setSystemTime(new Date(2026, 10, 1, 9))
    setVisibility('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe('2026-10')
  })
})

describe('derived hooks', () => {
  it('never allocate in a store selector (React would warn about an uncached snapshot)', () => {
    const errors = vi.spyOn(console, 'error')
    const { rerender } = renderHook(() => [useWallet(), useOwed(), useMonthReview('2026-09'), useUnreviewedMonth()])
    rerender()
    unrelatedChange()
    expect(errors).not.toHaveBeenCalled()
  })
})

describe('useMoneyFormat', () => {
  it('masks amounts while hidden and not revealed', () => {
    const { result } = renderHook(() => useMoneyFormat())
    expect(getData().settings.hideAmounts).toBe(true)
    expect(result.current).toMatchObject({ currency: 'EUR', locale: 'de-DE', showCents: false, masked: true })
    expect(result.current.format(350)).toBe(MASKED)

    act(() => useUiStore.getState().setAmountsRevealed(true))
    expect(result.current.masked).toBe(false)
    expect(result.current.format(350)).toBe('3,50 €')
  })

  it('stays the same object until a money setting changes', () => {
    const { result } = renderHook(() => useMoneyFormat())
    const first = result.current
    unrelatedChange()
    act(() => actions.updateSettings({ name: 'Sam' }))
    expect(result.current).toBe(first)

    act(() => actions.updateSettings({ currency: 'JPY', hideAmounts: false }))
    expect(result.current).not.toBe(first)
    expect(result.current).toMatchObject({ currency: 'JPY', digits: 0, masked: false })
  })
})
