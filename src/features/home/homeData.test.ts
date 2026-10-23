import { describe, expect, it } from 'vitest'
import { computeMonthSummary, UNCATEGORIZED_ID, type CategorySpend } from '@/domain/summary'
import {
  expense,
  makeCategory,
  makeData,
  makeRecurring,
  walletExpense,
} from '@/domain/test-helpers/budgetFixtures'
import type { Category, HomeCardKey, ISODate } from '@/domain/types'
import type { WalletSummary } from '@/domain/wallet'
import {
  cardOrder,
  dayAndMonth,
  limitRows,
  recentExpenses,
  spendingSegments,
  startOfDayMs,
  trendHasData,
  trendPoints,
  trendTitle,
  walletHasContent,
} from '@/features/home/homeData'

function mapOf(categories: Category[]): Readonly<Record<string, Category>> {
  return Object.fromEntries(categories.map((category) => [category.id, category]))
}

function spend(categoryId: string, total: number, budget: number | null, status: CategorySpend['status']): CategorySpend {
  return { categoryId, fixed: 0, daily: total, total, budget, count: 1, status }
}

describe('limitRows (SPEC §3.1 Limits)', () => {
  const categories = mapOf([
    makeCategory('groceries', { budget: 18000 }),
    makeCategory('coffee', { budget: 4000 }),
    makeCategory('eating', { budget: 15000 }),
    makeCategory('going-out', { budget: 10000 }),
    makeCategory('old', { budget: 5000, archived: true }),
    makeCategory('free'),
  ])

  it('puts over first, then near the limit, then the highest share', () => {
    const rows = [
      spend('groceries', 11860, 18000, 'ok'),
      spend('going-out', 2000, 10000, 'ok'),
      spend('coffee', 3850, 4000, 'warning'),
      spend('eating', 15660, 15000, 'over'),
    ]
    expect(limitRows(rows, categories).map((row) => row.categoryId)).toEqual(['eating', 'coffee', 'groceries', 'going-out'])
  })

  it('leaves out archived and unknown categories and those without a limit', () => {
    const rows = [
      spend('old', 6000, 5000, 'over'),
      spend('free', 3000, null, 'none'),
      spend(UNCATEGORIZED_ID, 900, null, 'none'),
      spend('gone', 900, 500, 'over'),
      spend('coffee', 100, 4000, 'ok'),
    ]
    expect(limitRows(rows, categories).map((row) => row.categoryId)).toEqual(['coffee'])
  })

  it('works on a real summary: a limit covers fixed costs and daily spending', () => {
    const data = makeData({
      categories: [makeCategory('cat-rent', { budget: 70000 }), makeCategory('coffee', { budget: 4000, order: 1 })],
      recurring: [makeRecurring({ amount: 64000 })],
      transactions: [expense('2026-10-03', 3850, { categoryId: 'coffee' }), expense('2026-10-04', 700, { categoryId: 'cat-rent' })],
    })
    const summary = computeMonthSummary(data, '2026-10', '2026-10-18')
    const rows = limitRows(summary.byCategory, mapOf(data.categories))
    expect(rows.map((row) => [row.categoryId, row.total, row.status])).toEqual([
      ['coffee', 3850, 'warning'],
      ['cat-rent', 64700, 'warning'],
    ])
  })
})

describe('spendingSegments (SPEC §3.1 Where it went)', () => {
  it('has one segment per category with daily spending, in its ink', () => {
    const data = makeData({
      categories: [
        makeCategory('groceries', { name: 'Groceries', color: 'green' }),
        makeCategory('coffee', { name: 'Coffee & snacks', color: 'yellow', order: 1 }),
        makeCategory('cat-rent', { name: 'Rent', color: 'blue', order: 2 }),
      ],
      recurring: [makeRecurring({ amount: 64000 })],
      transactions: [
        expense('2026-10-03', 11860, { categoryId: 'groceries' }),
        expense('2026-10-04', 3850, { categoryId: 'coffee' }),
        expense('2026-10-05', 500, { categoryId: 'deleted' }),
        walletExpense('2026-10-06', 54900, { categoryId: 'coffee' }),
      ],
    })
    const summary = computeMonthSummary(data, '2026-10', '2026-10-18')
    expect(spendingSegments(summary.byCategory, mapOf(data.categories))).toEqual([
      { key: 'groceries', value: 11860, color: 'green', label: 'Groceries' },
      { key: 'coffee', value: 3850, color: 'yellow', label: 'Coffee & snacks' },
      { key: UNCATEGORIZED_ID, value: 500, color: 'other', label: 'Uncategorized' },
    ])
  })
})

describe('recentExpenses', () => {
  it('keeps the newest expenses, wallet-paid ones included, and skips income', () => {
    const data = makeData({
      transactions: [
        expense('2026-10-01', 100),
        expense('2026-10-02', 200),
        expense('2026-10-03', 300),
        walletExpense('2026-10-04', 400),
        expense('2026-10-05', 500),
        expense('2026-10-06', 600),
        { ...expense('2026-10-07', 700), kind: 'income', categoryId: null },
      ],
    })
    const summary = computeMonthSummary(data, '2026-10', '2026-10-18')
    expect(recentExpenses(summary.transactions).map((tx) => tx.amount)).toEqual([600, 500, 400, 300, 200])
    expect(recentExpenses(summary.transactions, 2).map((tx) => tx.amount)).toEqual([600, 500])
  })
})

describe('trend', () => {
  const points = [
    { month: '2026-05' as const, fixed: 0, daily: 0, income: 0 },
    { month: '2026-06' as const, fixed: 0, daily: 0, income: 0 },
    { month: '2026-07' as const, fixed: 0, daily: 0, income: 0 },
    { month: '2026-08' as const, fixed: 77888, daily: 48210, income: 145000 },
    { month: '2026-09' as const, fixed: 77888, daily: 0, income: 145000 },
    { month: '2026-10' as const, fixed: 0, daily: 0, income: 145000 },
  ]

  it('starts at the first period with data', () => {
    expect(trendPoints(points, '2026-08').map((point) => point.month)).toEqual(['2026-08', '2026-09', '2026-10'])
  })

  it('shows once two periods have a fixed cost or an expense', () => {
    expect(trendHasData(points)).toBe(true)
    expect(trendHasData(points.slice(0, 4))).toBe(false)
    expect(trendHasData([])).toBe(false)
  })

  it('is titled after the selected period', () => {
    expect(trendTitle(true, 'October')).toBe('Last 6 months')
    expect(trendTitle(false, 'September')).toBe('6 months to September')
  })
})

describe('walletHasContent', () => {
  const empty: WalletSummary = { start: '2026-10', balance: 0, free: 0, pending: 0, goals: [], doneGoals: [], movements: [] }

  it('is empty on a first run', () => {
    expect(walletHasContent(empty)).toBe(false)
    expect(walletHasContent({ ...empty, pending: null })).toBe(false)
  })

  it('has something to say with a balance, a movement of money or a pending result', () => {
    expect(walletHasContent({ ...empty, balance: -500 })).toBe(true)
    expect(walletHasContent({ ...empty, pending: 33472 })).toBe(true)
    const closed = {
      key: 'month:2026-09',
      kind: 'month' as const,
      date: '2026-09-30' as ISODate,
      month: '2026-09' as const,
      amount: 0,
      balance: 0,
      note: '',
      entryId: null,
      transactionId: null,
    }
    // A month that closed at 0,00 € moved nothing.
    expect(walletHasContent({ ...empty, movements: [closed] })).toBe(false)
    expect(walletHasContent({ ...empty, movements: [closed, { ...closed, key: 'entry:e1', amount: 5000 }] })).toBe(true)
  })
})

describe('cardOrder', () => {
  it('follows the settings, without the equation and duplicates', () => {
    const cards: HomeCardKey[] = ['recent', 'equation', 'budgets', 'trend', 'recent']
    expect(cardOrder(cards)).toEqual(['recent', 'budgets', 'trend'])
  })
})

describe('names and dates', () => {
  it('writes the closing day in the locale’s order', () => {
    expect(dayAndMonth('2026-09-30', 'de-DE')).toBe('30 September')
    expect(dayAndMonth('2026-09-30', 'en-US')).toBe('September 30')
  })

  it('finds local midnight, also on the day the clocks change', () => {
    expect(new Date(startOfDayMs('2026-10-18')).getHours()).toBe(0)
    expect(startOfDayMs('2026-10-26') - startOfDayMs('2026-10-25')).toBe(25 * 3_600_000)
  })
})
