import { describe, expect, it } from 'vitest'
import { addDays, diffDays } from '@/domain/dates'
import {
  categoryTrend,
  dailyAverage,
  dailySeries,
  frequentEntries,
  trend,
  upcomingFixed,
  type DayAmount,
} from '@/domain/insights'
import type { RecurringLine } from '@/domain/recurring'
import { computeMonthSummary, UNCATEGORIZED_ID } from '@/domain/summary'
import {
  expense,
  income,
  makeCategory,
  makeData,
  makeRecurring,
  makeSplit,
  makeTransaction,
  monthsBetween,
  walletExpense,
} from '@/domain/test-helpers/budgetFixtures'
import type { AppData, Category, ISODate, Transaction } from '@/domain/types'

const TODAY: ISODate = '2026-10-18'

/** Whether the series runs day by day without gaps or repeats. */
function isConsecutive(dates: readonly ISODate[]): boolean {
  return dates.every((date, i) => i === 0 || diffDays(dates[i - 1] ?? date, date) === 1)
}

/** The ids of the items behind some lines, in order. */
function ids(lines: readonly RecurringLine[]): string[] {
  return lines.map((line) => line.recurring.id)
}

/** An expense with a note in a category, created at `createdAt` (ms) unless given otherwise. */
function noted(note: string, amount: number, categoryId: string, date: ISODate, createdAt?: number): Transaction {
  const created = createdAt === undefined ? {} : { createdAt }
  return makeTransaction({ kind: 'expense', note, amount, categoryId, date, ...created })
}

/** The sum of a daily series. */
function total(series: readonly DayAmount[]): number {
  return series.reduce((sum, day) => sum + day.amount, 0)
}

/** A category that exists and one that is archived; byCategory gives both rows of their own. */
const CATEGORIES: readonly Category[] = [makeCategory('coffee'), makeCategory('old', { archived: true })]

describe('dailySeries', () => {
  it('has one zero-filled entry per day of the period', () => {
    const series = dailySeries([], '2026-10', 1)
    expect(series).toHaveLength(31)
    expect(series[0]).toEqual({ date: '2026-10-01', amount: 0 })
    expect(series.at(-1)).toEqual({ date: '2026-10-31', amount: 0 })
    expect(series.every((day) => day.amount === 0)).toBe(true)
    expect(isConsecutive(series.map((day) => day.date))).toBe(true)
  })

  it('adds up the expenses of each day and ignores income and other periods', () => {
    const series = dailySeries(
      [
        expense('2026-10-03', 350),
        expense('2026-10-03', 450),
        expense('2026-10-31', 1000),
        income('2026-10-03', 5000),
        expense('2026-09-30', 700),
        expense('2026-11-01', 800),
      ],
      '2026-10',
      1,
    )
    expect(series[2]).toEqual({ date: '2026-10-03', amount: 800 })
    expect(series[30]).toEqual({ date: '2026-10-31', amount: 1000 })
    expect(series.reduce((sum, day) => sum + day.amount, 0)).toBe(1800)
  })

  it('keeps to one category when asked', () => {
    const transactions = [
      expense('2026-10-03', 350, { categoryId: 'coffee' }),
      expense('2026-10-03', 450, { categoryId: 'eating' }),
    ]
    expect(dailySeries(transactions, '2026-10', 1, 'coffee')[2]?.amount).toBe(350)
    expect(dailySeries(transactions, '2026-10', 1, 'eating')[2]?.amount).toBe(450)
    expect(dailySeries(transactions, '2026-10', 1, 'groceries').every((day) => day.amount === 0)).toBe(true)
  })

  it('with the categories, counts expenses of deleted categories as Uncategorized, like byCategory', () => {
    const transactions = [
      expense('2026-10-03', 350, { categoryId: 'coffee' }),
      expense('2026-10-03', 500, { categoryId: 'cat-x' }),
      expense('2026-10-04', 300, { categoryId: 'cat-y' }),
      expense('2026-10-04', 200, { categoryId: UNCATEGORIZED_ID }),
      expense('2026-10-05', 900, { categoryId: 'old' }),
    ]
    const uncategorized = dailySeries(transactions, '2026-10', 1, UNCATEGORIZED_ID, CATEGORIES)
    expect(uncategorized.slice(2, 5).map((day) => day.amount)).toEqual([500, 500, 0])
    expect(total(uncategorized)).toBe(1000)
    // Existing categories, archived ones too, keep their own expenses.
    expect(total(dailySeries(transactions, '2026-10', 1, 'coffee', CATEGORIES))).toBe(350)
    expect(total(dailySeries(transactions, '2026-10', 1, 'old', CATEGORIES))).toBe(900)
    // A deleted category has no row of its own, so nothing counts under its id.
    expect(total(dailySeries(transactions, '2026-10', 1, 'cat-x', CATEGORIES))).toBe(0)
    // Without a filter the categories change nothing.
    expect(dailySeries(transactions, '2026-10', 1, undefined, CATEGORIES)).toEqual(dailySeries(transactions, '2026-10', 1))
  })

  it('without the categories, compares ids as stored and counts an expense without one as Uncategorized', () => {
    const transactions = [
      expense('2026-10-03', 500, { categoryId: 'cat-x' }),
      expense('2026-10-03', 200, { categoryId: UNCATEGORIZED_ID }),
      expense('2026-10-03', 100, { categoryId: null }),
    ]
    expect(dailySeries(transactions, '2026-10', 1, UNCATEGORIZED_ID)[2]?.amount).toBe(300)
    expect(dailySeries(transactions, '2026-10', 1, 'cat-x')[2]?.amount).toBe(500)
  })

  it('follows periods that start on the 25th across New Year', () => {
    const series = dailySeries([expense('2027-01-01', 500), expense('2026-12-24', 900)], '2026-12', 25)
    expect(series).toHaveLength(31)
    expect(series[0]?.date).toBe('2026-12-25')
    expect(series.at(-1)?.date).toBe('2027-01-24')
    expect(series[7]).toEqual({ date: '2027-01-01', amount: 500 })
    expect(series.reduce((sum, day) => sum + day.amount, 0)).toBe(500)
  })

  it('counts every calendar day in DST months and leap Februaries', () => {
    for (const [month, days] of [
      ['2026-03', 31],
      ['2026-10', 31],
      ['2028-02', 29],
      ['2027-02', 28],
    ] as const) {
      const series = dailySeries([], month, 1)
      expect(series).toHaveLength(days)
      expect(isConsecutive(series.map((day) => day.date))).toBe(true)
    }
  })
})

describe('trend', () => {
  const data = makeData({
    recurring: [
      makeRecurring({ amount: 64000, startMonth: '2026-09' }),
      makeRecurring({ kind: 'income', amount: 150000, startMonth: '2026-10' }),
    ],
    transactions: [
      expense('2026-08-15', 1000),
      expense('2026-09-10', 2000),
      expense('2026-10-05', 3000),
      expense('2026-10-20', 500),
      income('2026-09-01', 7000),
    ],
  })

  it('gives fixed costs, daily spending and income per period, oldest first', () => {
    expect(trend(data, '2026-10', 4, TODAY)).toEqual([
      { month: '2026-07', fixed: 0, daily: 0, income: 0 },
      { month: '2026-08', fixed: 0, daily: 1000, income: 0 },
      { month: '2026-09', fixed: 64000, daily: 2000, income: 7000 },
      { month: '2026-10', fixed: 64000, daily: 3500, income: 150000 },
    ])
  })

  it('agrees with the month summaries, also across New Year', () => {
    const points = trend(data, '2027-02', 6, TODAY)
    expect(points.map((point) => point.month)).toEqual(monthsBetween('2026-09', '2027-02'))
    for (const point of points) {
      const summary = computeMonthSummary(data, point.month, TODAY)
      expect(point).toEqual({ month: point.month, fixed: summary.fixed, daily: summary.daily, income: summary.income })
    }
  })

  it('uses budget periods, not calendar months', () => {
    const late = makeData({
      settings: { monthStartDay: 25 },
      transactions: [expense('2026-10-24', 100), expense('2026-10-26', 200)],
    })
    expect(trend(late, '2026-10', 2, TODAY).map((point) => point.daily)).toEqual([100, 200])
  })

  it('is empty for 0 periods and rejects a negative or fractional count', () => {
    expect(trend(data, '2026-10', 0, TODAY)).toEqual([])
    expect(() => trend(data, '2026-10', -1, TODAY)).toThrow(RangeError)
    expect(() => trend(data, '2026-10', 1.5, TODAY)).toThrow(RangeError)
  })
})

describe('categoryTrend', () => {
  const data = makeData({
    categories: [makeCategory('coffee', { order: 0 }), makeCategory('subs', { order: 1 })],
    recurring: [makeRecurring({ amount: 1399, categoryId: 'subs', startMonth: '2026-10' })],
    transactions: [
      expense('2026-09-03', 350, { categoryId: 'coffee' }),
      expense('2026-10-03', 450, { categoryId: 'coffee' }),
      expense('2026-10-04', 200, { categoryId: 'cat-x' }),
    ],
  })

  it('takes fixed, daily and total from each period, with zeros where the category has no row', () => {
    expect(categoryTrend(data, 'coffee', '2026-10', 3, TODAY)).toEqual([
      { month: '2026-08', fixed: 0, daily: 0, total: 0 },
      { month: '2026-09', fixed: 0, daily: 350, total: 350 },
      { month: '2026-10', fixed: 0, daily: 450, total: 450 },
    ])
    expect(categoryTrend(data, 'subs', '2026-11', 3, TODAY)).toEqual([
      { month: '2026-09', fixed: 0, daily: 0, total: 0 },
      { month: '2026-10', fixed: 1399, daily: 0, total: 1399 },
      { month: '2026-11', fixed: 1399, daily: 0, total: 1399 },
    ])
  })

  it('follows the merged row of unknown categories under UNCATEGORIZED_ID', () => {
    expect(categoryTrend(data, UNCATEGORIZED_ID, '2026-10', 2, TODAY)).toEqual([
      { month: '2026-09', fixed: 0, daily: 0, total: 0 },
      { month: '2026-10', fixed: 0, daily: 200, total: 200 },
    ])
    // An unknown id has no row of its own.
    expect(categoryTrend(data, 'cat-x', '2026-10', 1, TODAY)).toEqual([
      { month: '2026-10', fixed: 0, daily: 0, total: 0 },
    ])
  })

  it('is empty for 0 periods', () => {
    expect(categoryTrend(data, 'coffee', '2026-10', 0, TODAY)).toEqual([])
  })
})

describe('upcomingFixed', () => {
  const months: AppData['months'] = {
    '2026-10': { overrides: { spotify: { paid: true }, insurance: { skipped: true } } },
  }
  const data = makeData({
    months,
    recurring: [
      makeRecurring({ id: 'rent', dueDay: 1 }),
      makeRecurring({ id: 'streaming', dueDay: 31 }),
      makeRecurring({ id: 'internet', dueDay: 30, order: 1 }),
      makeRecurring({ id: 'dsl', dueDay: 30, order: 0 }),
      makeRecurring({ id: 'phone', dueDay: 28 }),
      makeRecurring({ id: 'netflix', dueDay: 22 }),
      makeRecurring({ id: 'gym', dueDay: 18 }),
      makeRecurring({ id: 'spotify', dueDay: 25 }),
      makeRecurring({ id: 'insurance', dueDay: 20 }),
      makeRecurring({ id: 'loan' }),
      makeRecurring({ id: 'yearly', dueDay: 20, startMonth: '2026-03', everyMonths: 12, spread: true }),
      makeRecurring({ id: 'quarterly', dueDay: 20, startMonth: '2026-09', everyMonths: 3 }),
      makeRecurring({ id: 'salary', kind: 'income', dueDay: 25 }),
    ],
  })
  const summary = computeMonthSummary(data, '2026-10', TODAY)

  it('lists unpaid, unskipped charges due from today to the end of the period, at most 4', () => {
    expect(ids(upcomingFixed(summary, TODAY))).toEqual(['gym', 'netflix', 'phone', 'dsl'])
  })

  it('orders by due date, then order, then name, up to the limit', () => {
    expect(ids(upcomingFixed(summary, TODAY, 10))).toEqual(['gym', 'netflix', 'phone', 'dsl', 'internet', 'streaming'])
    expect(ids(upcomingFixed(summary, TODAY, 2))).toEqual(['gym', 'netflix'])
  })

  it('returns the summary’s own lines', () => {
    const [first] = upcomingFixed(summary, TODAY)
    expect(first).toBe(summary.fixedLines.find((line) => line.recurring.id === 'gym'))
  })

  it('is empty for a limit of 0 or below', () => {
    expect(upcomingFixed(summary, TODAY, 0)).toEqual([])
    expect(upcomingFixed(summary, TODAY, -1)).toEqual([])
  })

  it('is empty outside the current period', () => {
    expect(upcomingFixed(computeMonthSummary(data, '2026-09', TODAY), TODAY)).toEqual([])
    expect(upcomingFixed(computeMonthSummary(data, '2026-11', TODAY), TODAY)).toEqual([])
  })

  it('uses due dates when periods start on the 25th', () => {
    const late = makeData({
      settings: { monthStartDay: 25 },
      recurring: [
        makeRecurring({ id: 'first', dueDay: 1 }),
        makeRecurring({ id: 'fifth', dueDay: 5 }),
        makeRecurring({ id: 'end', dueDay: 24 }),
        makeRecurring({ id: 'start', dueDay: 26 }),
      ],
    })
    // Period 2026-10 runs from 2026-10-25 to 2026-11-24.
    const today: ISODate = '2026-11-02'
    const lines = upcomingFixed(computeMonthSummary(late, '2026-10', today), today)
    expect(lines.map((line) => [line.recurring.id, line.dueDate])).toEqual([
      ['fifth', '2026-11-05'],
      ['end', '2026-11-24'],
    ])
  })
})

describe('dailyAverage', () => {
  it('current: spending up to today divided by the days so far, rounded', () => {
    const data = makeData({
      transactions: [
        expense('2026-10-02', 1000),
        expense('2026-10-18', 2609),
        expense('2026-10-25', 5000),
        income('2026-10-03', 9999),
      ],
    })
    // (1000 + 2609) / 18 = 200.5
    expect(dailyAverage(computeMonthSummary(data, '2026-10', TODAY))).toBe(201)
  })

  it('past: the daily spending divided by the days of the period, rounded', () => {
    const data = makeData({ transactions: [expense('2026-09-02', 3000), expense('2026-09-30', 15)] })
    // 3015 / 30 = 100.5
    expect(dailyAverage(computeMonthSummary(data, '2026-09', TODAY))).toBe(101)
  })

  it('future: none', () => {
    const data = makeData({ transactions: [expense('2026-11-02', 3000)] })
    expect(dailyAverage(computeMonthSummary(data, '2026-11', TODAY))).toBeNull()
  })

  it('is 0 without expenses', () => {
    const data = makeData()
    expect(dailyAverage(computeMonthSummary(data, '2026-10', TODAY))).toBe(0)
    expect(dailyAverage(computeMonthSummary(data, '2026-09', TODAY))).toBe(0)
  })

  it('counts days from the start day of the period', () => {
    const data = makeData({
      settings: { monthStartDay: 25 },
      transactions: [expense('2026-10-25', 900), expense('2026-11-02', 900), expense('2026-11-10', 5000)],
    })
    // 2026-11-02 is day 9 of the period that started on 2026-10-25.
    expect(dailyAverage(computeMonthSummary(data, '2026-10', '2026-11-02'))).toBe(200)
  })
})

describe('frequentEntries', () => {
  it('groups expenses by note, amount and category and keeps groups entered at least twice', () => {
    const transactions = [
      noted('Cappuccino', 350, 'coffee', '2026-10-01'),
      noted(' cappuccino  ', 350, 'coffee', '2026-10-15'),
      noted('Cappuccino ', 350, 'coffee', '2026-10-18'),
      noted('Mensa', 450, 'eating', '2026-10-10'),
      noted('mensa', 450, 'eating', '2026-10-12'),
      noted('Mensa', 500, 'eating', '2026-10-12'),
      noted('Mensa', 450, 'coffee', '2026-10-13'),
      noted('Bar', 1800, 'going-out', '2026-10-14'),
      noted('', 200, 'coffee', '2026-10-14'),
      noted('', 200, 'coffee', '2026-10-15'),
      noted('   ', 200, 'coffee', '2026-10-16'),
      noted('   ', 200, 'coffee', '2026-10-17'),
      income('2026-10-01', 450, { note: 'Mensa' }),
      income('2026-10-02', 450, { note: 'Mensa' }),
    ]
    expect(frequentEntries(transactions, TODAY)).toEqual([
      { note: 'Cappuccino', amount: 350, categoryId: 'coffee', count: 3 },
      { note: 'mensa', amount: 450, categoryId: 'eating', count: 2 },
    ])
  })

  it('matches notes with whitespace collapsed and shows the latest note, trimmed', () => {
    const transactions = [
      noted('coffee   to go', 300, 'coffee', '2026-10-10'),
      noted('  Coffee  To Go ', 300, 'coffee', '2026-10-11'),
    ]
    expect(frequentEntries(transactions, TODAY)).toEqual([
      { note: 'Coffee  To Go', amount: 300, categoryId: 'coffee', count: 2 },
    ])
  })

  it('looks back 60 days including today and ignores future dates', () => {
    const transactions = [
      noted('Döner', 700, 'eating', addDays(TODAY, -59)),
      noted('Döner', 700, 'eating', TODAY),
      noted('Kebab', 800, 'eating', addDays(TODAY, -60)),
      noted('Kebab', 800, 'eating', TODAY),
      noted('Pizza', 900, 'eating', addDays(TODAY, 1)),
      noted('Pizza', 900, 'eating', TODAY),
    ]
    expect(frequentEntries(transactions, TODAY)).toEqual([
      { note: 'Döner', amount: 700, categoryId: 'eating', count: 2 },
    ])
  })

  it('takes another window when asked', () => {
    const transactions = [
      noted('Bakery', 250, 'coffee', addDays(TODAY, -6)),
      noted('Bakery', 250, 'coffee', TODAY),
      noted('Kiosk', 150, 'coffee', addDays(TODAY, -7)),
      noted('Kiosk', 150, 'coffee', TODAY),
    ]
    expect(frequentEntries(transactions, TODAY, { days: 7 }).map((entry) => entry.note)).toEqual(['Bakery'])
    expect(frequentEntries(transactions, TODAY, { days: 0 })).toEqual([])
  })

  it('orders by count, then the latest entry (date, then creation), then key', () => {
    const transactions = [
      noted('Often', 100, 'coffee', '2026-10-01', 1),
      noted('Often', 100, 'coffee', '2026-10-02', 2),
      noted('Often', 100, 'coffee', '2026-10-03', 3),
      noted('Early today', 100, 'coffee', '2026-10-10', 4),
      noted('Early today', 100, 'coffee', '2026-10-18', 2000),
      noted('Late today', 100, 'coffee', '2026-10-10', 5),
      noted('Late today', 100, 'coffee', '2026-10-18', 3000),
      noted('Yesterday', 100, 'coffee', '2026-10-10', 6),
      // Created after everything else, but on an earlier date.
      noted('Yesterday', 100, 'coffee', '2026-10-17', 9000),
      noted('banana', 100, 'coffee', '2026-10-01', 7),
      noted('banana', 100, 'coffee', '2026-10-16', 5000),
      noted('Apple', 100, 'coffee', '2026-10-01', 8),
      noted('Apple', 100, 'coffee', '2026-10-16', 5000),
    ]
    expect(frequentEntries(transactions, TODAY, { limit: 10 }).map((entry) => entry.note)).toEqual([
      'Often',
      'Late today',
      'Early today',
      'Yesterday',
      'Apple',
      'banana',
    ])
  })

  it('keeps to one category when asked', () => {
    const transactions = [
      noted('Mensa', 450, 'eating', '2026-10-10'),
      noted('Mensa', 450, 'eating', '2026-10-11'),
      noted('Latte', 390, 'coffee', '2026-10-10'),
      noted('Latte', 390, 'coffee', '2026-10-11'),
    ]
    expect(frequentEntries(transactions, TODAY, { categoryId: 'coffee' })).toEqual([
      { note: 'Latte', amount: 390, categoryId: 'coffee', count: 2 },
    ])
  })

  it('returns at most `limit` entries, 4 by default', () => {
    const transactions = ['A', 'B', 'C', 'D', 'E', 'F'].flatMap((note) => [
      noted(note, 100, 'coffee', '2026-10-10'),
      noted(note, 100, 'coffee', '2026-10-11'),
    ])
    expect(frequentEntries(transactions, TODAY)).toHaveLength(4)
    expect(frequentEntries(transactions, TODAY, { limit: 5 })).toHaveLength(5)
    expect(frequentEntries(transactions, TODAY, { limit: 0 })).toEqual([])
  })

  it('files expenses without a category under UNCATEGORIZED_ID', () => {
    const transactions = [
      makeTransaction({ kind: 'expense', categoryId: null, note: 'Kiosk', amount: 150, date: '2026-10-10' }),
      makeTransaction({ kind: 'expense', categoryId: null, note: 'Kiosk', amount: 150, date: '2026-10-11' }),
    ]
    const kiosk = [{ note: 'Kiosk', amount: 150, categoryId: UNCATEGORIZED_ID, count: 2 }]
    expect(frequentEntries(transactions, TODAY)).toEqual(kiosk)
    expect(frequentEntries(transactions, TODAY, { categoryId: UNCATEGORIZED_ID })).toEqual(kiosk)
  })

  it('with the categories, files expenses of deleted categories under UNCATEGORIZED_ID, like byCategory', () => {
    const transactions = [
      noted('Kiosk', 500, 'cat-x', '2026-10-10'),
      noted('Kiosk', 500, 'cat-y', '2026-10-11'),
      noted('Kiosk', 500, UNCATEGORIZED_ID, '2026-10-12'),
      noted('Latte', 390, 'old', '2026-10-10'),
      noted('Latte', 390, 'old', '2026-10-11'),
      noted('Latte', 390, 'coffee', '2026-10-09'),
    ]
    const kiosk = { note: 'Kiosk', amount: 500, categoryId: UNCATEGORIZED_ID, count: 3 }
    // Archived categories keep their own id, so the coffee latte stays a group of one.
    expect(frequentEntries(transactions, TODAY, { categories: CATEGORIES })).toEqual([
      kiosk,
      { note: 'Latte', amount: 390, categoryId: 'old', count: 2 },
    ])
    expect(frequentEntries(transactions, TODAY, { categoryId: UNCATEGORIZED_ID, categories: CATEGORIES })).toEqual([
      kiosk,
    ])
    // A deleted category has no row of its own, so nothing counts under its id.
    expect(frequentEntries(transactions, TODAY, { categoryId: 'cat-x', categories: CATEGORIES })).toEqual([])
  })

  it('without the categories, keeps ids as stored', () => {
    const transactions = [noted('Kiosk', 500, 'cat-x', '2026-10-10'), noted('Kiosk', 500, 'cat-y', '2026-10-11')]
    expect(frequentEntries(transactions, TODAY)).toEqual([])
    expect(frequentEntries([...transactions, noted('Kiosk', 500, 'cat-x', '2026-10-12')], TODAY)).toEqual([
      { note: 'Kiosk', amount: 500, categoryId: 'cat-x', count: 2 },
    ])
  })
})

describe('the Uncategorized row', () => {
  /** Kiosk twice on a deleted category and one expense without a category (the review's case). */
  const today: ISODate = '2026-10-14'
  const data = makeData({
    categories: [makeCategory('coffee')],
    transactions: [
      noted('Kiosk', 500, 'cat-x', '2026-10-10'),
      noted('Kiosk', 500, 'cat-x', '2026-10-11'),
      expense('2026-10-12', 300, { categoryId: UNCATEGORIZED_ID }),
    ],
  })

  it('adds up the same in byCategory, categoryTrend, dailySeries and frequentEntries', () => {
    const row = computeMonthSummary(data, '2026-10', today).byCategory.find((r) => r.categoryId === UNCATEGORIZED_ID)
    expect(row).toMatchObject({ daily: 1300, count: 3 })
    expect(categoryTrend(data, UNCATEGORIZED_ID, '2026-10', 1, today)[0]?.daily).toBe(1300)
    expect(total(dailySeries(data.transactions, '2026-10', 1, UNCATEGORIZED_ID, data.categories))).toBe(1300)
    expect(frequentEntries(data.transactions, today, { categoryId: UNCATEGORIZED_ID, categories: data.categories })).toEqual([
      { note: 'Kiosk', amount: 500, categoryId: UNCATEGORIZED_ID, count: 2 },
    ])
  })

  it('gives every byCategory row of every period a daily series that adds up to its daily spending', () => {
    const mixed = makeData({
      settings: { monthStartDay: 25 },
      categories: [...CATEGORIES, makeCategory('rent', { budget: 70000 })],
      recurring: [makeRecurring({ amount: 64000, categoryId: 'rent' }), makeRecurring({ amount: 999, categoryId: 'cat-z' })],
      transactions: [
        expense('2026-09-24', 100, { categoryId: 'coffee' }),
        expense('2026-09-25', 200, { categoryId: 'old' }),
        expense('2026-10-01', 300, { categoryId: 'cat-x' }),
        expense('2026-10-24', 400, { categoryId: UNCATEGORIZED_ID }),
        expense('2026-10-25', 500, { categoryId: 'cat-y' }),
        expense('2026-11-30', 600, { categoryId: 'coffee' }),
        income('2026-10-02', 70000),
      ],
    })
    const checked: string[] = []
    for (const month of monthsBetween('2026-08', '2026-11')) {
      for (const row of computeMonthSummary(mixed, month, TODAY).byCategory) {
        expect(total(dailySeries(mixed.transactions, month, 25, row.categoryId, mixed.categories))).toBe(row.daily)
        checked.push(`${month} ${row.categoryId} ${row.daily}`)
      }
    }
    // Rent and the deleted category's fixed cost give rows in every period, expenses the rest.
    expect(checked).toEqual([
      '2026-08 rent 0',
      '2026-08 __none__ 0',
      '2026-08 coffee 100',
      '2026-09 rent 0',
      '2026-09 __none__ 700',
      '2026-09 old 200',
      '2026-10 rent 0',
      '2026-10 __none__ 500',
      '2026-11 rent 0',
      '2026-11 __none__ 0',
      '2026-11 coffee 600',
    ])
  })
})

describe('budget amounts (§4.9)', () => {
  const categories = [makeCategory('coffee'), makeCategory('home')]
  const transactions = [
    // Your share 600: Anna owes 400.
    expense('2026-10-03', 1000, { categoryId: 'coffee', splits: [makeSplit('Anna', 400)] }),
    walletExpense('2026-10-03', 50000, { categoryId: 'home' }),
    // Ben's part was forgiven, so all 900 is yours.
    expense('2026-10-05', 900, { categoryId: 'coffee', splits: [makeSplit('Ben', 300, { status: 'forgiven' })] }),
    // A deleted category: your share 500 counts as Uncategorized; the wallet-paid one not at all.
    expense('2026-10-06', 800, { categoryId: 'cat-x', splits: [makeSplit('Carla', 300)] }),
    walletExpense('2026-10-06', 4000, { categoryId: 'cat-y' }),
    // Today: Anna paid her 1200 back, which is still her part, not yours.
    expense(TODAY, 2400, { categoryId: 'home', splits: [makeSplit('Anna', 1200, { status: 'paid' })] }),
    walletExpense(TODAY, 7000, { categoryId: 'coffee' }),
    // Later this month: in the period, not yet in the average.
    expense('2026-10-25', 5000, { categoryId: 'coffee' }),
  ]
  const data = makeData({ categories, transactions })
  const summary = computeMonthSummary(data, '2026-10', TODAY)

  it('dailySeries adds up your shares per day and nothing of wallet-paid expenses', () => {
    const series = dailySeries(transactions, '2026-10', 1)
    expect([3, 5, 6, 18, 25].map((day) => series[day - 1]?.amount)).toEqual([600, 900, 500, 1200, 5000])
    expect(total(series)).toBe(8200)
    expect(summary.daily).toBe(8200)
  })

  it('dailySeries of each byCategory row adds up to the row’s daily spending', () => {
    expect(summary.byCategory.map((r) => [r.categoryId, r.daily, r.count])).toEqual([
      ['coffee', 6500, 3],
      ['home', 1200, 1],
      [UNCATEGORIZED_ID, 500, 1],
    ])
    for (const r of summary.byCategory) {
      expect([r.categoryId, total(dailySeries(transactions, '2026-10', 1, r.categoryId, categories))]).toEqual([
        r.categoryId,
        r.daily,
      ])
    }
  })

  it('dailyAverage counts your shares up to today in the current period', () => {
    // (600 + 900 + 500 + 1200) / 18 = 177.8
    expect(dailyAverage(summary)).toBe(178)
  })

  it('dailyAverage of a past period divides its daily spending by its days', () => {
    // 8200 / 31 = 264.5
    expect(dailyAverage(computeMonthSummary(data, '2026-10', '2026-11-05'))).toBe(265)
  })

  it('trend and categoryTrend count daily spending at your share', () => {
    expect(trend(data, '2026-10', 1, TODAY)).toEqual([{ month: '2026-10', fixed: 0, daily: 8200, income: 0 }])
    expect(categoryTrend(data, 'home', '2026-10', 1, TODAY)).toEqual([
      { month: '2026-10', fixed: 0, daily: 1200, total: 1200 },
    ])
    expect(categoryTrend(data, UNCATEGORIZED_ID, '2026-10', 1, TODAY)).toEqual([
      { month: '2026-10', fixed: 0, daily: 500, total: 500 },
    ])
  })

  it('frequentEntries suggests split expenses at their full amount and skips wallet-paid ones', () => {
    const entries = [
      noted('Pizza', 2400, 'eating', '2026-10-10'),
      makeTransaction({
        kind: 'expense',
        note: 'Pizza',
        amount: 2400,
        categoryId: 'eating',
        date: '2026-10-12',
        splits: [makeSplit('Anna', 1200)],
      }),
      walletExpense('2026-10-11', 9900, { note: 'IKEA', categoryId: 'home' }),
      walletExpense('2026-10-13', 9900, { note: 'IKEA', categoryId: 'home' }),
      walletExpense('2026-10-14', 250, { note: 'Bakery', categoryId: 'coffee' }),
      noted('Bakery', 250, 'coffee', '2026-10-15'),
    ]
    expect(frequentEntries(entries, TODAY)).toEqual([{ note: 'Pizza', amount: 2400, categoryId: 'eating', count: 2 }])
  })
})
