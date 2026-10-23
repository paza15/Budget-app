import { describe, expect, it } from 'vitest'
import {
  budgetStatus,
  categoryKeyOf,
  computeMonthSummary,
  computePace,
  UNCATEGORIZED_ID,
  type CategorySpend,
  type MonthSummary,
  type PaceInfo,
  type PaceInput,
} from '@/domain/summary'
import {
  expense,
  income,
  makeCategory,
  makeData,
  makeRecurring,
  makeSplit,
  makeTransaction,
  walletExpense,
} from '@/domain/test-helpers/budgetFixtures'
import type { AppData, SplitStatus } from '@/domain/types'

/** Freezes a value and everything reachable from it, so any mutation throws (modules are strict). */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/** A byCategory row with the defaults of a category that has nothing in the period. */
function row(categoryId: string, values: Partial<CategorySpend>): CategorySpend {
  const fixed = values.fixed ?? 0
  const daily = values.daily ?? 0
  return {
    categoryId,
    fixed,
    daily,
    total: fixed + daily,
    budget: null,
    count: 0,
    status: 'none',
    ...values,
  }
}

/** Every money figure of a summary, without the transaction list. */
function figuresOf(s: MonthSummary): Partial<MonthSummary> {
  const { income: inc, fixed, daily, savings, spent, available, left, perDay, todaySpent, todayLeft, pace, byCategory } = s
  return { income: inc, fixed, daily, savings, spent, available, left, perDay, todaySpent, todayLeft, pace, byCategory }
}

describe('categoryKeyOf', () => {
  const known = new Set(['coffee', 'old'])

  it.each([
    ['coffee', 'coffee'],
    ['old', 'old'],
    ['cat-deleted', UNCATEGORIZED_ID],
    [UNCATEGORIZED_ID, UNCATEGORIZED_ID],
    [null, UNCATEGORIZED_ID],
    ['constructor', UNCATEGORIZED_ID],
  ] as const)('files %j under %j', (categoryId, expected) => {
    expect(categoryKeyOf(categoryId, known)).toBe(expected)
  })

  it('also takes the categories as a Map keyed by id', () => {
    const byId = new Map([['coffee', makeCategory('coffee')]])
    expect(categoryKeyOf('coffee', byId)).toBe('coffee')
    expect(categoryKeyOf('tea', byId)).toBe(UNCATEGORIZED_ID)
  })
})

describe('budgetStatus', () => {
  it.each([
    [8500, 10000, 'warning'],
    [8499, 10000, 'ok'],
    [10000, 10000, 'warning'],
    [10001, 10000, 'over'],
    [500, 0, 'none'],
    [500, null, 'none'],
    [0, 10000, 'ok'],
    [1, 1, 'warning'],
    [2, 1, 'over'],
    [84, 100, 'ok'],
    [85, 100, 'warning'],
  ] as const)('(%i, %s) → %s', (spent, budget, expected) => {
    expect(budgetStatus(spent, budget)).toBe(expected)
  })
})

/** The §4.5 pace example (100000 available, day 7 of 10) with some values changed. */
function input(patch: Partial<PaceInput>): PaceInput {
  return { available: 100000, daily: 0, days: 10, dayIndex: 7, ...patch }
}

/** The pace on day 21 of November (30 days) with 100000 income and `daily` spent. */
function paceOnDay21(daily: number): PaceInfo {
  const data = makeData({
    recurring: [makeRecurring({ kind: 'income', amount: 100000 })],
    transactions: [expense('2026-11-02', daily)],
  })
  return computeMonthSummary(data, '2026-11', '2026-11-21').pace
}

describe('computePace', () => {
  it('§4.5 tests: 10 points ahead of time is still ok, beyond that is ahead', () => {
    expect(computePace(input({ daily: 80000 }))).toEqual({ timeRatio: 0.7, spendRatio: 0.8, status: 'ok' })
    expect(computePace(input({ daily: 80001 })).status).toBe('ahead')
  })

  it('compares in integers, where 0.7 + 0.10 in floating point would call 0.8 ahead', () => {
    expect(0.7 + 0.1 < 0.8).toBe(true)
    expect(computePace(input({ daily: 80000 })).status).toBe('ok')
  })

  it('§4.5 test: fixed costs above income make every spend a full share and the period over', () => {
    // income 90000 − fixed 100000 leaves −10000 for daily life.
    expect(computePace(input({ available: -10000, daily: 5000 }))).toMatchObject({ spendRatio: 1, status: 'over' })
  })

  it('has a spend ratio of 0 while nothing is spent, whatever is available', () => {
    expect(computePace(input({ available: 0, daily: 0 })).spendRatio).toBe(0)
    expect(computePace(input({ available: -500, daily: 0 }))).toMatchObject({ spendRatio: 0, status: 'over' })
    expect(computePace(input({ available: 100000, daily: 0 }))).toMatchObject({ spendRatio: 0, status: 'ok' })
  })

  it('is over only below zero: spending exactly what is available on the last day is ok', () => {
    expect(computePace({ available: 1000, daily: 1000, days: 30, dayIndex: 30 })).toEqual({
      timeRatio: 1,
      spendRatio: 1,
      status: 'ok',
    })
    expect(computePace({ available: 1000, daily: 1001, days: 30, dayIndex: 30 }).status).toBe('over')
  })

  it('is never ahead outside the current period', () => {
    expect(computePace(input({ daily: 99000, dayIndex: null }))).toEqual({
      timeRatio: null,
      spendRatio: 0.99,
      status: 'ok',
    })
  })

  it('reports over rather than ahead', () => {
    expect(computePace(input({ daily: 100001, dayIndex: 1 })).status).toBe('over')
  })
})

describe('computeMonthSummary', () => {
  describe('totals', () => {
    const salary = makeRecurring({ id: 'salary', kind: 'income', amount: 150000, dueDay: 25 })
    const parents = makeRecurring({ id: 'parents', kind: 'income', amount: 20000, dueDay: 1 })
    const rent = makeRecurring({ id: 'rent', amount: 64000, categoryId: 'cat-rent', dueDay: 1 })
    const netflix = makeRecurring({ id: 'netflix', amount: 1399, categoryId: 'cat-subs', dueDay: 22 })
    // 6000 a year set aside monthly: 500 in October, which is not its charge period.
    const insurance = makeRecurring({
      id: 'insurance',
      amount: 6000,
      categoryId: 'cat-insurance',
      startMonth: '2026-03',
      everyMonths: 12,
      spread: true,
    })
    // Charged in September and December only.
    const quarterly = makeRecurring({ id: 'quarterly', amount: 3000, startMonth: '2026-09', everyMonths: 3 })
    const transactions = [
      income('2026-10-05', 5000),
      expense('2026-10-02', 2000),
      expense('2026-10-18', 3500),
      expense('2026-09-30', 900),
      expense('2026-11-01', 800),
      income('2026-11-02', 7000),
    ]
    const data = makeData({
      settings: { savingsGoal: 10000 },
      recurring: [salary, parents, rent, netflix, insurance, quarterly],
      transactions,
    })
    const summary = computeMonthSummary(data, '2026-10', '2026-10-18')

    it('adds up income, fixed costs, savings and daily spending of the period', () => {
      expect(summary).toMatchObject({
        incomeRecurring: 170000,
        incomeOneOff: 5000,
        income: 175000,
        fixed: 65899,
        daily: 5500,
        savings: 10000,
        spent: 71399,
        available: 99101,
        left: 93601,
        todaySpent: 3500,
      })
    })

    it('spreads what is left over the days left, today included', () => {
      // floor((93601 + 3500) / 14) = 6935
      expect(summary).toMatchObject({ daysLeft: 14, perDay: 6935, todayLeft: 3435 })
    })

    it('lists the lines of each kind, referencing the stored items', () => {
      expect(summary.incomeLines.map((line) => line.recurring.id)).toEqual(['parents', 'salary'])
      expect(summary.fixedLines.map((line) => line.recurring.id)).toEqual(['rent', 'netflix', 'insurance'])
      expect(summary.fixedLines[0]?.recurring).toBe(rent)
      expect(summary.incomeLines[1]?.recurring).toBe(salary)
    })

    it('counts a skipped line as 0 and an overridden line at its amount', () => {
      const months: AppData['months'] = {
        '2026-10': { overrides: { netflix: { skipped: true }, rent: { amount: 60000 }, salary: { amount: 140000 } } },
      }
      const adjusted = computeMonthSummary({ ...data, months }, '2026-10', '2026-10-18')
      expect(adjusted).toMatchObject({ fixed: 60500, incomeRecurring: 160000 })
    })
  })

  describe('period and timing', () => {
    const data = makeData()

    it('describes the current period', () => {
      expect(computeMonthSummary(data, '2026-10', '2026-10-18')).toMatchObject({
        month: '2026-10',
        range: { start: '2026-10-01', end: '2026-10-31' },
        timing: 'current',
        days: 31,
        dayIndex: 18,
        daysLeft: 14,
      })
    })

    it('describes past and future periods', () => {
      expect(computeMonthSummary(data, '2026-09', '2026-10-18')).toMatchObject({
        timing: 'past',
        days: 30,
        dayIndex: null,
        daysLeft: 0,
      })
      expect(computeMonthSummary(data, '2026-11', '2026-10-18')).toMatchObject({
        timing: 'future',
        days: 30,
        dayIndex: null,
        daysLeft: 30,
      })
    })

    it('uses budget periods across New Year when months start on the 25th', () => {
      const inside = [expense('2026-12-25', 100), expense('2027-01-01', 200), expense('2027-01-24', 400)]
      const outside = [expense('2026-12-24', 1000), expense('2027-01-25', 2000)]
      const summary = computeMonthSummary(
        makeData({ settings: { monthStartDay: 25 }, transactions: [...outside, ...inside] }),
        '2026-12',
        '2027-01-10',
      )
      expect(summary).toMatchObject({
        range: { start: '2026-12-25', end: '2027-01-24' },
        timing: 'current',
        days: 31,
        dayIndex: 17,
        daysLeft: 15,
        daily: 700,
      })
      expect(summary.transactions).toHaveLength(3)
    })

    it('counts calendar days on the DST change days and in leap years', () => {
      expect(computeMonthSummary(data, '2026-03', '2026-03-29')).toMatchObject({ dayIndex: 29, daysLeft: 3 })
      expect(computeMonthSummary(data, '2026-10', '2026-10-25')).toMatchObject({ dayIndex: 25, daysLeft: 7 })
      expect(computeMonthSummary(data, '2028-02', '2028-02-29')).toMatchObject({ days: 29, daysLeft: 1 })
    })

    it('throws a RangeError for an invalid start day', () => {
      expect(() => computeMonthSummary(makeData({ settings: { monthStartDay: 31 } }), '2026-10', '2026-10-18')).toThrow(
        RangeError,
      )
    })
  })

  describe('per day and today (§4.5 tests)', () => {
    const salary = makeRecurring({ kind: 'income', amount: 100000 })
    const before = expense('2026-11-03', 20000)
    const today = expense('2026-11-10', 1000)
    const day20 = expense('2026-11-20', 30000)

    it('available 100000, day 10 of 30, 20000 before today, 1000 today, 30000 on day 20', () => {
      const data = makeData({ recurring: [salary], transactions: [before, today, day20] })
      expect(computeMonthSummary(data, '2026-11', '2026-11-10')).toMatchObject({
        available: 100000,
        days: 30,
        dayIndex: 10,
        left: 49000,
        todaySpent: 1000,
        perDay: 2380,
        todayLeft: 1380,
      })
    })

    it('the same without the expense on day 20', () => {
      const data = makeData({ recurring: [salary], transactions: [before, today] })
      expect(computeMonthSummary(data, '2026-11', '2026-11-10')).toMatchObject({ perDay: 3809, todayLeft: 2809 })
    })

    it('future: available 90000, 30000 already entered, 30 days', () => {
      const data = makeData({
        recurring: [makeRecurring({ kind: 'income', amount: 90000 })],
        transactions: [expense('2026-11-15', 30000)],
      })
      expect(computeMonthSummary(data, '2026-11', '2026-10-18')).toMatchObject({
        available: 90000,
        left: 60000,
        perDay: 2000,
        todaySpent: 0,
        todayLeft: null,
      })
    })

    it('last day: left 1234, 500 spent today', () => {
      const data = makeData({ transactions: [income('2026-11-01', 1734), expense('2026-11-30', 500)] })
      expect(computeMonthSummary(data, '2026-11', '2026-11-30')).toMatchObject({
        daysLeft: 1,
        left: 1234,
        todaySpent: 500,
        perDay: 1734,
        todayLeft: 1234,
      })
    })

    it('has no per-day amount for past periods and counts nothing as spent today', () => {
      const data = makeData({ recurring: [salary], transactions: [before, today] })
      expect(computeMonthSummary(data, '2026-11', '2026-12-05')).toMatchObject({
        perDay: null,
        todaySpent: 0,
        todayLeft: null,
      })
    })

    it('rounds per day down, also below zero', () => {
      const data = makeData({ transactions: [expense('2026-10-02', 100)] })
      // left −100 over the last 3 days of October.
      expect(computeMonthSummary(data, '2026-10', '2026-10-29')).toMatchObject({
        left: -100,
        perDay: -34,
        todayLeft: -34,
      })
    })
  })

  describe('pace', () => {
    const salary = makeRecurring({ kind: 'income', amount: 100000 })

    it('is ahead only beyond 10 points ahead of time (day 21 of 30)', () => {
      expect(paceOnDay21(80000)).toEqual({ timeRatio: 0.7, spendRatio: 0.8, status: 'ok' })
      expect(paceOnDay21(80001).status).toBe('ahead')
    })

    it('§4.5 test: income 90000, fixed 100000, daily 5000 → spendRatio 1, over', () => {
      const data = makeData({
        recurring: [makeRecurring({ kind: 'income', amount: 90000 }), makeRecurring({ amount: 100000 })],
        transactions: [expense('2026-10-02', 5000)],
      })
      expect(computeMonthSummary(data, '2026-10', '2026-10-18').pace).toMatchObject({ spendRatio: 1, status: 'over' })
    })

    it('has no time ratio and is never ahead outside the current period', () => {
      const data = makeData({ recurring: [salary], transactions: [expense('2026-09-02', 99000)] })
      expect(computeMonthSummary(data, '2026-09', '2026-10-18').pace).toEqual({
        timeRatio: null,
        spendRatio: 0.99,
        status: 'ok',
      })
      const short = makeData({ recurring: [makeRecurring({ amount: 1000 })] })
      expect(computeMonthSummary(short, '2026-11', '2026-10-18').pace).toEqual({
        timeRatio: null,
        spendRatio: 0,
        status: 'over',
      })
    })
  })

  describe('savings', () => {
    it("uses the period's own goal, even 0, before the general one", () => {
      const data = makeData({
        settings: { savingsGoal: 20000 },
        months: { '2026-08': { savingsGoal: 0 }, '2026-09': { savingsGoal: 5000 } },
      })
      expect(computeMonthSummary(data, '2026-08', '2026-10-18').savings).toBe(0)
      expect(computeMonthSummary(data, '2026-09', '2026-10-18').savings).toBe(5000)
      expect(computeMonthSummary(data, '2026-10', '2026-10-18').savings).toBe(20000)
    })

    it('ignores goals inherited from the prototype of `months`', () => {
      const months: AppData['months'] = Object.create({ '2026-10': { savingsGoal: 1 } })
      const data = makeData({ settings: { savingsGoal: 20000 }, months })
      expect(computeMonthSummary(data, '2026-10', '2026-10-18').savings).toBe(20000)
    })
  })

  describe('byCategory', () => {
    const categories = [
      makeCategory('rent', { order: 0, kind: 'fixed' }),
      makeCategory('subs', { order: 1, kind: 'fixed', budget: 2000 }),
      makeCategory('coffee', { order: 2, kind: 'daily', budget: 5000 }),
      makeCategory('groceries', { order: 3, kind: 'daily', budget: 20000 }),
      makeCategory('old', { order: 4, archived: true, budget: 1000 }),
      makeCategory('clothes', { order: 5, archived: true }),
      makeCategory('gym', { order: 6 }),
      makeCategory('zero', { order: 7, budget: 0 }),
      makeCategory('phone', { order: 8, kind: 'fixed' }),
    ]
    const recurring = [
      makeRecurring({ id: 'rent', amount: 64000, categoryId: 'rent' }),
      makeRecurring({ id: 'netflix', amount: 1399, categoryId: 'subs' }),
      makeRecurring({ id: 'spotify', amount: 1199, categoryId: 'subs' }),
      makeRecurring({ id: 'phone', amount: 1500, categoryId: 'phone' }),
      makeRecurring({ id: 'deleted', amount: 700, categoryId: 'cat-deleted' }),
    ]
    const transactions = [
      expense('2026-10-03', 2000, { categoryId: 'coffee' }),
      expense('2026-10-09', 2300, { categoryId: 'coffee' }),
      expense('2026-10-04', 1500, { categoryId: 'clothes' }),
      expense('2026-10-05', 500, { categoryId: 'cat-x' }),
      expense('2026-10-06', 300, { categoryId: 'cat-y' }),
      expense('2026-10-07', 200, { categoryId: UNCATEGORIZED_ID }),
      expense('2026-09-07', 9900, { categoryId: 'gym' }),
      income('2026-10-01', 50000),
    ]
    const months: AppData['months'] = { '2026-10': { overrides: { phone: { skipped: true } } } }
    const data = makeData({ categories, recurring, transactions, months })
    const { byCategory } = computeMonthSummary(data, '2026-10', '2026-10-18')

    it('has a row per category with fixed costs, expenses or a limit, sorted by total', () => {
      expect(byCategory).toEqual([
        row('rent', { fixed: 64000 }),
        row('coffee', { daily: 4300, budget: 5000, count: 2, status: 'warning' }),
        row('subs', { fixed: 2598, budget: 2000, status: 'over' }),
        row(UNCATEGORIZED_ID, { fixed: 700, daily: 1000, count: 3 }),
        row('clothes', { daily: 1500, count: 1 }),
        row('groceries', { budget: 20000, status: 'ok' }),
      ])
    })

    it('leaves out archived categories with a limit and no spending, and categories with nothing', () => {
      const ids = byCategory.map((r) => r.categoryId)
      expect(ids).not.toContain('old')
      expect(ids).not.toContain('gym')
      expect(ids).not.toContain('zero')
      // A skipped fixed cost counts 0, so it does not add a row.
      expect(ids).not.toContain('phone')
    })

    it('files every fixed cost and expense of the period under its categoryKeyOf', () => {
      const known = new Set(categories.map(({ id }) => id))
      const summary = computeMonthSummary(data, '2026-10', '2026-10-18')
      const fixed = new Map<string, number>()
      const daily = new Map<string, number>()
      for (const line of summary.fixedLines) {
        const key = categoryKeyOf(line.recurring.categoryId, known)
        fixed.set(key, (fixed.get(key) ?? 0) + line.amount)
      }
      for (const tx of summary.transactions) {
        if (tx.kind !== 'expense') continue
        const key = categoryKeyOf(tx.categoryId, known)
        daily.set(key, (daily.get(key) ?? 0) + tx.amount)
      }
      for (const r of byCategory) {
        expect([r.categoryId, r.fixed, r.daily]).toEqual([r.categoryId, fixed.get(r.categoryId) ?? 0, daily.get(r.categoryId) ?? 0])
      }
    })

    it('§4.5 test: expenses on two unknown categories merge into one Uncategorized row', () => {
      const unknown = makeData({
        transactions: [
          expense('2026-10-05', 500, { categoryId: 'cat-x' }),
          expense('2026-10-06', 300, { categoryId: 'cat-y' }),
        ],
      })
      expect(computeMonthSummary(unknown, '2026-10', '2026-10-18').byCategory).toEqual([
        { categoryId: UNCATEGORIZED_ID, fixed: 0, daily: 800, total: 800, budget: null, count: 2, status: 'none' },
      ])
    })

    it('breaks ties by category order, then id, with Uncategorized last', () => {
      const tied = makeData({
        categories: [
          makeCategory('a', { order: 2 }),
          makeCategory('b2', { order: 1 }),
          makeCategory('b1', { order: 1 }),
        ],
        transactions: [
          expense('2026-10-01', 1000, { categoryId: 'unknown' }),
          expense('2026-10-01', 1000, { categoryId: 'a' }),
          expense('2026-10-01', 1000, { categoryId: 'b2' }),
          expense('2026-10-01', 1000, { categoryId: 'b1' }),
        ],
      })
      expect(computeMonthSummary(tied, '2026-10', '2026-10-18').byCategory.map((r) => r.categoryId)).toEqual([
        'b1',
        'b2',
        'a',
        UNCATEGORIZED_ID,
      ])
    })

    it('counts spread fixed costs at their share and income not at all', () => {
      const spread = makeData({
        categories: [makeCategory('insurance', { budget: 600 })],
        recurring: [
          makeRecurring({
            amount: 6000,
            categoryId: 'insurance',
            startMonth: '2026-03',
            everyMonths: 12,
            spread: true,
          }),
          makeRecurring({ kind: 'income', amount: 100000 }),
        ],
      })
      expect(computeMonthSummary(spread, '2026-10', '2026-10-18').byCategory).toEqual([
        row('insurance', { fixed: 500, budget: 600, status: 'ok' }),
      ])
    })
  })

  describe('budget amounts (§4.9)', () => {
    const categories = [
      makeCategory('coffee', { order: 0, budget: 5000 }),
      makeCategory('eating', { order: 1 }),
      makeCategory('furniture', { order: 2 }),
    ]
    const salary = makeRecurring({ kind: 'income', amount: 100000 })
    const coffee = expense('2026-10-03', 2000, { categoryId: 'coffee' })
    // Anna still owes 3000 and Ben paid his 2000 back: your share is 4000. Carla's forgiven 1000 stays yours.
    const dinner = expense('2026-10-10', 9000, {
      categoryId: 'eating',
      splits: [
        makeSplit('Anna', 3000),
        makeSplit('Ben', 2000, { status: 'paid' }),
        makeSplit('Carla', 1000, { status: 'forgiven' }),
      ],
    })
    // Today, your share 1000.
    const lunch = expense('2026-10-18', 1500, { categoryId: 'eating', splits: [makeSplit('Anna', 500)] })
    // Paid from the wallet: today, earlier this month, and in a category that no longer exists.
    const sofa = walletExpense('2026-10-18', 50000, { categoryId: 'furniture' })
    const lamp = walletExpense('2026-10-05', 8000, { categoryId: 'furniture' })
    const tv = walletExpense('2026-10-07', 30000, { categoryId: 'cat-gone' })
    const data = makeData({ categories, recurring: [salary], transactions: [coffee, dinner, lunch, sofa, lamp, tv] })
    const summary = computeMonthSummary(data, '2026-10', '2026-10-18')

    it('counts your share of each expense, and nothing of the wallet-paid ones', () => {
      expect(summary).toMatchObject({
        income: 100000,
        daily: 7000,
        spent: 7000,
        available: 100000,
        left: 93000,
        todaySpent: 1000,
        // floor((93000 + 1000) / 14)
        perDay: 6714,
        todayLeft: 5714,
      })
      expect(summary.pace).toEqual({ timeRatio: 18 / 31, spendRatio: 0.07, status: 'ok' })
    })

    it('gives the categories of wallet-paid expenses a row, without amount or count (§4.5, §4.9)', () => {
      expect(summary.byCategory).toEqual([
        row('eating', { daily: 5000, count: 2 }),
        row('coffee', { daily: 2000, budget: 5000, count: 1, status: 'ok' }),
        // Only wallet-paid expenses this period: the sofa and the lamp, and the TV of a deleted category.
        row('furniture', {}),
        row(UNCATEGORIZED_ID, {}),
      ])
    })

    it('lists a category whose only expense was paid from the wallet, and adds the payment to no row', () => {
      const books = walletExpense('2026-10-05', 4500, { categoryId: 'books' })
      const coffeeShop = expense('2026-10-06', 350, { categoryId: 'coffee' })
      const beans = walletExpense('2026-10-07', 9000, { categoryId: 'coffee' })
      const s = computeMonthSummary(
        makeData({ categories: [makeCategory('books'), makeCategory('coffee')], transactions: [books, coffeeShop, beans] }),
        '2026-10',
        '2026-10-19',
      )
      expect(s.byCategory).toEqual([row('coffee', { daily: 350, count: 1 }), row('books', {})])
      expect(s.daily).toBe(350)
    })

    it('gives an archived category with only a wallet-paid expense its row, as any expense would', () => {
      const archived = makeCategory('hobby', { archived: true, budget: 3000 })
      const s = computeMonthSummary(
        makeData({ categories: [archived], transactions: [walletExpense('2026-10-05', 4500, { categoryId: 'hobby' })] }),
        '2026-10',
        '2026-10-19',
      )
      expect(s.byCategory).toEqual([row('hobby', { budget: 3000, status: 'ok' })])
    })

    it('still lists the wallet-paid expenses among the period’s transactions', () => {
      expect(summary.transactions).toEqual([sofa, lunch, dinner, tv, lamp, coffee])
      expect(summary.transactions[0]).toBe(sofa)
    })

    it('§3.13: gives every figure the data without its wallet-paid expenses gives, plus empty rows', () => {
      const budgetOnly = { ...data, transactions: data.transactions.filter((tx) => !tx.fromWallet) }
      for (const [month, today] of [
        ['2026-10', '2026-10-18'],
        ['2026-10', '2026-11-03'],
        ['2026-10', '2026-09-30'],
      ] as const) {
        const withPayments = computeMonthSummary(data, month, today)
        const without = computeMonthSummary(budgetOnly, month, today)
        const isShared = (r: CategorySpend): boolean => without.byCategory.some((w) => w.categoryId === r.categoryId)
        expect({ ...figuresOf(withPayments), byCategory: withPayments.byCategory.filter(isShared) }).toEqual(figuresOf(without))
        // The only difference: a row for each category that has nothing but wallet-paid expenses.
        expect(withPayments.byCategory.filter((r) => !isShared(r))).toEqual([row('furniture', {}), row(UNCATEGORIZED_ID, {})])
      }
    })

    it.each([
      ['open', 2000],
      ['paid', 2000],
      ['forgiven', 3000],
    ] as const)('counts an expense of 3000 with a %s split of 1000 as %i', (status: SplitStatus, daily) => {
      const split = makeData({ transactions: [expense('2026-10-04', 3000, { splits: [makeSplit('Anna', 1000, { status })] })] })
      expect(computeMonthSummary(split, '2026-10', '2026-10-18')).toMatchObject({ daily, left: -daily })
    })

    it('counts an expense once in byCategory even when others owe all of it', () => {
      const covered = expense('2026-10-04', 3000, { categoryId: 'eating', splits: [makeSplit('Anna', 3000)] })
      const s = computeMonthSummary(makeData({ categories, transactions: [covered] }), '2026-10', '2026-10-18')
      expect(s.daily).toBe(0)
      expect(s.byCategory).toEqual([
        row('coffee', { budget: 5000, status: 'ok' }),
        row('eating', { count: 1 }),
      ])
    })

    it('runs the pace on your share', () => {
      // Day 21 of 30 with 100000 income: 80000 is still on time, 80001 is ahead (see paceOnDay21).
      const shared = expense('2026-11-02', 80001, { splits: [makeSplit('Anna', 1)] })
      const s = computeMonthSummary(makeData({ recurring: [salary], transactions: [shared] }), '2026-11', '2026-11-21')
      expect(s.pace).toEqual({ timeRatio: 0.7, spendRatio: 0.8, status: 'ok' })
      expect(paceOnDay21(80001).status).toBe('ahead')
    })

    it('limits only see your share, so a split can keep a category under its limit', () => {
      const split = expense('2026-10-04', 6000, { categoryId: 'coffee', splits: [makeSplit('Anna', 2000)] })
      const whole = expense('2026-10-04', 6000, { categoryId: 'coffee' })
      const statusOf = (tx: typeof split): string | undefined =>
        computeMonthSummary(makeData({ categories, transactions: [tx] }), '2026-10', '2026-10-18').byCategory.find(
          (r) => r.categoryId === 'coffee',
        )?.status
      expect(statusOf(split)).toBe('ok')
      expect(statusOf(whole)).toBe('over')
      expect(statusOf({ ...whole, fromWallet: true })).toBe('ok')
    })
  })

  describe('transactions', () => {
    it('lists every transaction of the period, newest date first, then newest entry first', () => {
      const older = makeTransaction({ date: '2026-10-05', amount: 100, createdAt: 2000 })
      const newer = makeTransaction({ date: '2026-10-05', amount: 200, createdAt: 3000 })
      const latest = makeTransaction({ date: '2026-10-17', amount: 300, createdAt: 1000 })
      const gift = income('2026-10-10', 5000)
      const outside = expense('2026-11-01', 400)
      const data = makeData({ transactions: [older, outside, latest, gift, newer] })
      const { transactions } = computeMonthSummary(data, '2026-10', '2026-10-18')
      expect(transactions).toEqual([latest, gift, newer, older])
      expect(transactions[0]).toBe(latest)
      expect(transactions[3]).toBe(older)
    })
  })

  it('never changes the data it reads', () => {
    const data = deepFreeze(
      makeData({
        categories: [makeCategory('coffee', { budget: 5000 })],
        recurring: [
          makeRecurring({ id: 'rent', amount: 64000, dueDay: 1 }),
          makeRecurring({ kind: 'income', amount: 9000 }),
        ],
        transactions: [expense('2026-10-03', 350, { categoryId: 'coffee' }), expense('2026-10-01', 250)],
        months: { '2026-10': { overrides: { rent: { paid: true } }, savingsGoal: 100 } },
      }),
    )
    expect(() => computeMonthSummary(data, '2026-10', '2026-10-18')).not.toThrow()
    expect(computeMonthSummary(data, '2026-10', '2026-10-18').fixedLines[0]?.paid).toBe(true)
  })
})
