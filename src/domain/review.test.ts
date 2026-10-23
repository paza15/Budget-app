import { describe, expect, it } from 'vitest'
import { BEFORE_APP_NOTE } from '@/domain/constants'
import { monthReview, unreviewedClosedMonth, type MonthReview } from '@/domain/review'
import { computeMonthSummary, UNCATEGORIZED_ID } from '@/domain/summary'
import {
  deposit,
  expense,
  income,
  makeCategory,
  makeData,
  makeRecurring,
  makeSplit,
  monthsBetween,
  walletExpense,
  withdrawal,
} from '@/domain/test-helpers/budgetFixtures'
import type { AppData, ISODate } from '@/domain/types'
import { monthResult, walletSummary } from '@/domain/wallet'

const TODAY: ISODate = '2026-10-19'

/** Freezes a value and everything reachable from it, so any mutation throws (modules are strict). */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

describe('monthReview', () => {
  const categories = [
    makeCategory('coffee', { order: 0 }),
    makeCategory('eating', { order: 1 }),
    makeCategory('groceries', { order: 2 }),
    makeCategory('transport', { order: 3 }),
    makeCategory('fun', { order: 4 }),
    makeCategory('books', { order: 5 }),
    makeCategory('rent', { order: 6, kind: 'fixed' }),
  ]
  const salary = makeRecurring({ kind: 'income', amount: 150000 })
  const rent = makeRecurring({ amount: 64000, categoryId: 'rent', dueDay: 1 })
  const phone = makeRecurring({ amount: 1500, categoryId: 'rent', dueDay: 5 })
  const netflix = makeRecurring({ amount: 1399, categoryId: 'rent', dueDay: 15 })

  // September, the period under review.
  const groceries = expense('2026-09-05', 10000, { categoryId: 'groceries', note: 'Big shop' })
  // 12000, of which Anna still owes 3000 and Ben paid back 5000: your share is 4000.
  const dinner = expense('2026-09-12', 12000, {
    categoryId: 'eating',
    note: 'Dinner',
    splits: [makeSplit('Anna', 3000), makeSplit('Ben', 5000, { status: 'paid' })],
  })
  // The largest purchase, but paid from the wallet: not part of September.
  const tv = walletExpense('2026-09-15', 25000, { categoryId: 'fun', note: 'TV', splits: [makeSplit('Carla', 500)] })
  // All of it owed by Ben: your share is 0, so 18 September counts as a day without spending.
  const lunch = expense('2026-09-18', 1000, { categoryId: 'eating', splits: [makeSplit('Ben', 1000)] })
  const september = [
    expense('2026-09-03', 1120, { categoryId: 'coffee' }),
    expense('2026-09-05', 1120, { categoryId: 'coffee' }),
    groceries,
    dinner,
    tv,
    lunch,
    expense('2026-09-20', 1800, { categoryId: 'transport' }),
    expense('2026-09-25', 1500, { categoryId: 'books' }),
    expense('2026-09-28', 900, { categoryId: 'fun', splits: [makeSplit('Eve', 300, { status: 'forgiven' })] }),
  ]
  // August, the period before.
  const august = [
    expense('2026-08-04', 2000, { categoryId: 'coffee' }),
    expense('2026-08-06', 5000, { categoryId: 'eating' }),
    expense('2026-08-08', 10000, { categoryId: 'groceries' }),
    expense('2026-08-10', 3000, { categoryId: 'transport' }),
    expense('2026-08-12', 1400, { categoryId: 'fun', splits: [makeSplit('Dora', 700)] }),
  ]
  const data = makeData({
    categories,
    recurring: [salary, rent, phone, netflix],
    months: {
      '2026-08': { overrides: { [rent.id]: { paid: true } } },
      '2026-09': { overrides: { [rent.id]: { paid: true }, [phone.id]: { paid: true } }, savingsGoal: 10000 },
    },
    transactions: [...august, ...september, expense('2026-10-02', 700, { categoryId: 'coffee' })],
    wallet: {
      opening: 10000,
      startMonth: '2026-08',
      entries: [withdrawal('2026-09-30', 1000), deposit('2026-10-02', 5000)],
    },
  })

  it('states the period: totals, top categories against the period before, and the details', () => {
    const review: MonthReview = {
      month: '2026-09',
      previousMonth: '2026-08',
      // 150000 − 66899 fixed − 20440 daily
      result: 62661,
      // The result is the 10000 set aside plus the 52661 left over.
      savings: 10000,
      left: 52661,
      income: 150000,
      fixed: 66899,
      daily: 20440,
      categories: [
        { categoryId: 'groceries', daily: 10000, previous: 10000, change: 0 },
        { categoryId: 'eating', daily: 4000, previous: 5000, change: -0.2 },
        { categoryId: 'coffee', daily: 2240, previous: 2000, change: 0.12 },
        { categoryId: 'transport', daily: 1800, previous: 3000, change: -0.4 },
        // New this month.
        { categoryId: 'books', daily: 1500, previous: 0, change: null },
      ],
      // Fun had spending too, but is not among the top 5: the 900 of September (Eve's part is
      // forgiven) against the 700 of August (Dora still owes the rest), 2/7 more.
      rest: [{ categoryId: 'fun', daily: 900, previous: 700, change: 2 / 7 }],
      moreCategories: 1,
      biggestExpense: groceries,
      // Spending on the 3rd, 5th, 12th, 20th, 25th and 28th.
      noSpendDays: 24,
      entries: 8,
      fixedPaid: 2,
      // Rent, phone and Netflix.
      fixedCount: 3,
      // Anna's 3000, Ben's 1000 and Carla's 500 on the wallet-paid TV.
      owedOpen: 4500,
      // 10000 opening + 62401 August − 24500 TV − 1000 withdrawal + 62661 September.
      walletAfter: 109562,
    }
    expect(monthReview(data, '2026-09', TODAY)).toEqual(review)
  })

  it('has exactly the fields of the §5.3 contract', () => {
    expect(Object.keys(monthReview(data, '2026-09', TODAY)).toSorted()).toEqual(
      [
        'month',
        'previousMonth',
        'result',
        'savings',
        'left',
        'income',
        'fixed',
        'daily',
        'categories',
        'rest',
        'moreCategories',
        'biggestExpense',
        'noSpendDays',
        'entries',
        'fixedPaid',
        'fixedCount',
        'owedOpen',
        'walletAfter',
      ].toSorted(),
    )
  })

  it('agrees with the month summary and the wallet', () => {
    const review = monthReview(data, '2026-09', TODAY)
    const summary = computeMonthSummary(data, '2026-09', TODAY)
    expect(review.result).toBe(monthResult(summary))
    expect(review).toMatchObject({ savings: summary.savings, left: summary.left })
    expect(review.entries).toBe(summary.byCategory.reduce((sum, row) => sum + row.count, 0))
    expect(review.categories.length + review.moreCategories).toBe(summary.byCategory.filter((row) => row.daily > 0).length)
    // Together the top five and the fold are exactly the categories with spending, each once.
    const listed = [...review.categories, ...review.rest].map((c) => c.categoryId)
    expect(listed.toSorted()).toEqual(
      summary.byCategory
        .filter((row) => row.daily > 0)
        .map((row) => row.categoryId)
        .toSorted(),
    )
    const closing = walletSummary(data, TODAY).movements.find((m) => m.key === 'month:2026-09')
    expect(review.walletAfter).toBe(closing?.balance)
  })

  it('splits every result into savings and what was left over', () => {
    for (const month of monthsBetween('2026-07', '2026-11')) {
      const { result, savings, left } = monthReview(data, month, TODAY)
      expect([month, savings + left]).toEqual([month, result])
    }
  })

  it('gives the savings of the period and what was left, negative after an overspend', () => {
    const overspent = makeData({
      settings: { savingsGoal: 20000 },
      recurring: [makeRecurring({ kind: 'income', amount: 100000 }), makeRecurring({ amount: 30000 })],
      transactions: [expense('2026-09-10', 60000)],
      months: { '2026-08': { savingsGoal: 0 } },
    })
    // 100000 − 30000 − 60000 = 10000 into the wallet: the 20000 set aside, less 10000 over budget.
    expect(monthReview(overspent, '2026-09', TODAY)).toMatchObject({ result: 10000, savings: 20000, left: -10000 })
    // August's own savings goal is 0, so all of its result is what was left.
    expect(monthReview(overspent, '2026-08', TODAY)).toMatchObject({ result: 70000, savings: 0, left: 70000 })
  })

  it('returns the stored expense as the biggest one, judged by your share', () => {
    const review = monthReview(data, '2026-09', TODAY)
    expect(review.biggestExpense).toBe(groceries)
    // The TV (25000, wallet) and the dinner (12000, your share 4000) are larger in full.
    expect(review.biggestExpense).not.toBe(tv)
    expect(review.biggestExpense).not.toBe(dinner)
  })

  it('compares the first period with an empty one: every category is new', () => {
    const review = monthReview(data, '2026-08', TODAY)
    expect(review.categories).toEqual([
      { categoryId: 'groceries', daily: 10000, previous: 0, change: null },
      { categoryId: 'eating', daily: 5000, previous: 0, change: null },
      { categoryId: 'transport', daily: 3000, previous: 0, change: null },
      { categoryId: 'coffee', daily: 2000, previous: 0, change: null },
      { categoryId: 'fun', daily: 700, previous: 0, change: null },
    ])
    expect(review).toMatchObject({
      previousMonth: '2026-07',
      rest: [],
      moreCategories: 0,
      owedOpen: 700,
      fixedPaid: 1,
      fixedCount: 3,
      entries: 5,
      walletAfter: 72401,
    })
  })

  it('gives every closed period the balance after its closing', () => {
    for (const movement of walletSummary(data, TODAY).movements) {
      if (movement.kind !== 'month' || movement.month === null) continue
      expect([movement.month, monthReview(data, movement.month, TODAY).walletAfter]).toEqual([
        movement.month,
        movement.balance,
      ])
    }
  })

  it('lists at most 5 categories with spending, ties by category order with Uncategorized last', () => {
    const tied = makeData({
      categories: [makeCategory('b', { order: 1 }), makeCategory('a', { order: 2 }), makeCategory('rent', { budget: 9000 })],
      recurring: [makeRecurring({ amount: 50000, categoryId: 'rent' })],
      transactions: [
        expense('2026-09-01', 500, { categoryId: 'cat-gone' }),
        expense('2026-09-01', 500, { categoryId: 'a' }),
        expense('2026-09-01', 500, { categoryId: 'b' }),
        expense('2026-09-02', 100, { categoryId: 'b' }),
        walletExpense('2026-09-03', 99999, { categoryId: 'rent' }),
      ],
    })
    // b has 600; a and the unknown category tie at 500; rent has fixed costs and a limit, but no daily spending.
    const tiedReview = monthReview(tied, '2026-09', TODAY)
    expect(tiedReview.categories.map((c) => c.categoryId)).toEqual(['b', 'a', UNCATEGORIZED_ID])
    expect(tiedReview.rest).toEqual([])
    expect(tiedReview.moreCategories).toBe(0)

    const many = makeData({
      categories: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id, order) => makeCategory(id, { order })),
      transactions: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((categoryId, i) => expense('2026-09-10', 100 * (i + 1), { categoryId })),
    })
    const manyReview = monthReview(many, '2026-09', TODAY)
    expect(manyReview.categories.map((c) => c.categoryId)).toEqual(['c6', 'c5', 'c4', 'c3', 'c2'])
    expect(manyReview.rest).toEqual([{ categoryId: 'c1', daily: 100, previous: 0, change: null }])
    expect(manyReview.moreCategories).toBe(1)
  })

  it('counts the categories with spending beyond the top 5, and only those', () => {
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']
    const folded = makeData({
      categories: [
        ...ids.map((id, order) => makeCategory(id, { order })),
        makeCategory('shared', { order: 7 }),
        makeCategory('wallet', { order: 8 }),
        makeCategory('limit', { order: 9, budget: 5000 }),
        makeCategory('rent', { order: 10 }),
      ],
      recurring: [makeRecurring({ amount: 64000, categoryId: 'rent' })],
      transactions: [
        ...ids.map((categoryId, i) => expense('2026-09-10', 100 * (i + 1), { categoryId })),
        // Rows without daily spending: others owe all of it, paid from the wallet, a limit only, fixed costs only.
        expense('2026-09-11', 900, { categoryId: 'shared', splits: [makeSplit('Anna', 900)] }),
        walletExpense('2026-09-12', 9000, { categoryId: 'wallet' }),
      ],
    })
    const review = monthReview(folded, '2026-09', TODAY)
    expect(review.categories.map((c) => c.categoryId)).toEqual(['c7', 'c6', 'c5', 'c4', 'c3'])
    // c2 and c1: "2 more".
    expect(review.rest.map((c) => c.categoryId)).toEqual(['c2', 'c1'])
    expect(review.moreCategories).toBe(2)
    const idle = computeMonthSummary(folded, '2026-09', TODAY).byCategory.filter((row) => row.daily === 0)
    expect(idle.map((row) => row.categoryId)).toEqual(['rent', 'shared', 'wallet', 'limit'])
  })

  describe('the categories behind the fold (EXTRAS.md §1.4)', () => {
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']
    const sevenCategories = ids.map((id, order) => makeCategory(id, { order }))

    it('lists every category after the top five with its amount and its change', () => {
      const seven = makeData({
        categories: sevenCategories,
        transactions: [
          ...ids.map((categoryId, i) => expense('2026-09-10', 100 * (i + 1), { categoryId })),
          // August: c2 had 400, c1 had nothing.
          expense('2026-08-10', 400, { categoryId: 'c2' }),
        ],
      })
      const review = monthReview(seven, '2026-09', TODAY)
      expect(review.categories).toHaveLength(5)
      expect(review.rest).toEqual([
        // Half of August's 400.
        { categoryId: 'c2', daily: 200, previous: 400, change: -0.5 },
        // None in August: new.
        { categoryId: 'c1', daily: 100, previous: 0, change: null },
      ])
      expect(review.moreCategories).toBe(review.rest.length)
    })

    it('continues the order of the top five: a tie across the fifth place goes by category order, then id', () => {
      const tiedAtFifth = makeData({
        // c7 shares c5's place in the category order (4); c6 comes after both, the unknown id
        // (Uncategorized) last.
        categories: [...sevenCategories.filter((c) => c.id !== 'c7'), makeCategory('c7', { order: 4 })],
        transactions: [
          ...['c1', 'c2', 'c3', 'c4'].map((categoryId) => expense('2026-09-10', 900, { categoryId })),
          // Four categories tie at 500 for the fifth place.
          ...['c6', 'cat-gone', 'c7', 'c5'].map((categoryId) => expense('2026-09-11', 500, { categoryId })),
        ],
      })
      const review = monthReview(tiedAtFifth, '2026-09', TODAY)
      expect(review.categories.map((c) => c.categoryId)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
      expect(review.rest.map((c) => c.categoryId)).toEqual(['c7', 'c6', UNCATEGORIZED_ID])
      expect(review.moreCategories).toBe(3)
    })

    it('is empty with five categories or fewer', () => {
      const five = makeData({
        categories: sevenCategories,
        transactions: ids.slice(0, 5).map((categoryId) => expense('2026-09-10', 300, { categoryId })),
      })
      expect(monthReview(five, '2026-09', TODAY)).toMatchObject({ rest: [], moreCategories: 0 })
      expect(monthReview(makeData(), '2026-09', TODAY)).toMatchObject({ categories: [], rest: [], moreCategories: 0 })
    })
  })

  it('counts the fixed costs charged in the period and those ticked off as paid', () => {
    const flat = makeRecurring({ amount: 64000 })
    const mobile = makeRecurring({ amount: 1500 })
    // Charged every March, set aside monthly: September holds a share, but no charge.
    const insurance = makeRecurring({ amount: 12000, everyMonths: 12, spread: true, startMonth: '2026-03' })
    // Charged in March, June, September and December.
    const broadcast = makeRecurring({ amount: 5508, everyMonths: 3, startMonth: '2026-03' })
    const ended = makeRecurring({ amount: 999, endMonth: '2026-08' })
    const wage = makeRecurring({ kind: 'income', amount: 150000 })
    const fixedCosts = makeData({
      recurring: [flat, mobile, insurance, broadcast, ended, wage],
      months: {
        '2026-03': { overrides: { [insurance.id]: { paid: true } } },
        '2026-09': {
          overrides: {
            [flat.id]: { paid: true },
            // Skipped this period, so never paid, whatever is stored.
            [mobile.id]: { skipped: true, paid: true },
            [broadcast.id]: { paid: true },
            // Spread items are ticked off in their charge period only.
            [insurance.id]: { paid: true },
            [wage.id]: { paid: true },
          },
        },
      },
    })
    // The flat and the broadcast fee: the skipped mobile is not due, the insurance share is no charge,
    // and income is no fixed cost. So September ends with everything paid.
    expect(monthReview(fixedCosts, '2026-09', TODAY)).toMatchObject({ fixedCount: 2, fixedPaid: 2 })
    expect(computeMonthSummary(fixedCosts, '2026-09', TODAY).fixedLines).toHaveLength(4)
    // March: all five are charged (the ended item ran until August); only the insurance is ticked off.
    expect(monthReview(fixedCosts, '2026-03', TODAY)).toMatchObject({ fixedCount: 5, fixedPaid: 1 })
    // August: the flat, the mobile and the ended item's last charge; nothing is paid.
    expect(monthReview(fixedCosts, '2026-08', TODAY)).toMatchObject({ fixedCount: 3, fixedPaid: 0 })
  })

  it('compares with the period before under the current start day, across New Year', () => {
    const late = makeData({
      settings: { monthStartDay: 25 },
      categories: [makeCategory('coffee')],
      transactions: [
        expense('2026-12-24', 9999, { categoryId: 'coffee' }),
        expense('2026-12-30', 1000, { categoryId: 'coffee' }),
        expense('2027-01-24', 500, { categoryId: 'coffee' }),
        expense('2027-01-25', 1800, { categoryId: 'coffee' }),
        expense('2027-02-24', 300, { categoryId: 'coffee' }),
      ],
    })
    // 2027-01 runs from 25 January to 24 February; 2026-12 from 25 December to 24 January.
    const review = monthReview(late, '2027-01', '2027-03-01')
    expect(review.previousMonth).toBe('2026-12')
    expect(review.categories).toEqual([{ categoryId: 'coffee', daily: 2100, previous: 1500, change: 0.4 }])
    expect(monthReview(late, '2026-01', '2027-03-01').previousMonth).toBe('2025-12')
  })

  it('takes the newest of equally big expenses', () => {
    const early = expense('2026-09-03', 5000)
    const later = expense('2026-09-10', 5000, { createdAt: 1 })
    const sameDayLater = expense('2026-09-10', 5000, { createdAt: 2 })
    expect(monthReview(makeData({ transactions: [early, later] }), '2026-09', TODAY).biggestExpense).toBe(later)
    expect(monthReview(makeData({ transactions: [sameDayLater, early, later] }), '2026-09', TODAY).biggestExpense).toBe(
      sameDayLater,
    )
  })

  it('has no biggest expense when nothing counts against the period', () => {
    const nothingCounts = makeData({
      transactions: [
        walletExpense('2026-09-10', 5000),
        expense('2026-09-11', 2000, { splits: [makeSplit('Anna', 2000)] }),
        income('2026-09-12', 9000),
      ],
    })
    expect(monthReview(nothingCounts, '2026-09', TODAY)).toMatchObject({
      biggestExpense: null,
      daily: 0,
      categories: [],
      noSpendDays: 30,
      entries: 1,
      owedOpen: 2000,
    })
  })

  it('reviews an empty period', () => {
    expect(monthReview(makeData({ wallet: { startMonth: '2026-08' } }), '2026-08', TODAY)).toEqual({
      month: '2026-08',
      previousMonth: '2026-07',
      result: 0,
      savings: 0,
      left: 0,
      income: 0,
      fixed: 0,
      daily: 0,
      categories: [],
      rest: [],
      moreCategories: 0,
      biggestExpense: null,
      noSpendDays: 31,
      entries: 0,
      fixedPaid: 0,
      fixedCount: 0,
      owedOpen: 0,
      walletAfter: 0,
    })
  })

  it('counts the days without spending only up to today', () => {
    const october = makeData({ transactions: [expense('2026-10-02', 500), expense('2026-10-25', 700)] })
    // 19 days so far, spending on one of them.
    expect(monthReview(october, '2026-10', TODAY).noSpendDays).toBe(18)
    expect(monthReview(october, '2026-11', TODAY).noSpendDays).toBe(0)
  })

  it('counts the days without spending only from the local day of the install', () => {
    // 23:30 UTC on 19 October is 01:30 on 20 October in Berlin: 20 to 31 October.
    const lateNight = makeData({ settings: { createdAt: Date.UTC(2026, 9, 19, 23, 30) } })
    expect(monthReview(lateNight, '2026-10', '2026-11-02').noSpendDays).toBe(12)
    // A period that ended before the install: none of its days was tracked.
    expect(monthReview(lateNight, '2026-09', '2026-11-02').noSpendDays).toBe(0)
    // Installed on the period's first day: every day counts.
    const firstDay = makeData({ settings: { createdAt: Date.UTC(2026, 9, 1, 8) } })
    expect(monthReview(firstDay, '2026-10', '2026-11-02').noSpendDays).toBe(31)
    // Start day 25: 2026-10 runs from 25 October to 24 November; installed on 3 November.
    const late = makeData({
      settings: { createdAt: Date.UTC(2026, 10, 3, 8), monthStartDay: 25 },
      transactions: [expense('2026-10-26', 900), expense('2026-11-10', 500)],
    })
    // 3 to 24 November: 22 days, spending on the 10th.
    expect(monthReview(late, '2026-10', '2026-12-01').noSpendDays).toBe(21)
  })

  describe('the install period (§3.9 step 5)', () => {
    // Installed on 20 October 2026 at 11:00 in Berlin; onboarding booked what was spent since 1 October.
    const before = expense('2026-10-01', 45000, { note: BEFORE_APP_NOTE })
    const coffee = expense('2026-10-21', 350, { categoryId: 'coffee' })
    const weeklyShop = expense('2026-10-27', 2400, { categoryId: 'groceries', note: 'Groceries' })
    const firstMonth = makeData({
      settings: { createdAt: Date.UTC(2026, 9, 20, 9) },
      categories: [makeCategory('cat-other'), makeCategory('coffee'), makeCategory('groceries')],
      transactions: [before, coffee, weeklyShop],
    })
    const AFTER: ISODate = '2026-11-02'

    it('is the first period a new user is offered to review', () => {
      expect(unreviewedClosedMonth(firstMonth, AFTER)).toBe('2026-10')
    })

    it('never takes the onboarding entry as the biggest expense', () => {
      expect(monthReview(firstMonth, '2026-10', AFTER).biggestExpense).toBe(weeklyShop)
    })

    it('counts the days without spending from the install day, not over the onboarding entry’s days', () => {
      // 20 to 31 October: 12 days, spending on the 21st and the 27th.
      expect(monthReview(firstMonth, '2026-10', AFTER).noSpendDays).toBe(10)
      // While October runs: 20 to 25 October, spending on the 21st.
      expect(monthReview(firstMonth, '2026-10', '2026-10-25').noSpendDays).toBe(5)
    })

    it('still counts the onboarding entry as the period’s spending', () => {
      const review = monthReview(firstMonth, '2026-10', AFTER)
      expect(review).toMatchObject({ daily: 47750, result: -47750, entries: 3, moreCategories: 0 })
      expect(review.categories.map((c) => c.categoryId)).toEqual(['cat-other', 'groceries', 'coffee'])
    })

    it('has no biggest expense when the onboarding entry is the only one', () => {
      expect(monthReview({ ...firstMonth, transactions: [before] }, '2026-10', AFTER)).toMatchObject({
        biggestExpense: null,
        daily: 45000,
        noSpendDays: 12,
      })
    })

    it('takes an expense whose note only resembles the onboarding entry’s as a real one', () => {
      const lookalike = expense('2026-10-01', 45000, { note: `${BEFORE_APP_NOTE} 2` })
      const withLookalike = { ...firstMonth, transactions: [lookalike, coffee, weeklyShop] }
      expect(monthReview(withLookalike, '2026-10', AFTER).biggestExpense).toBe(lookalike)
    })
  })

  it('for a period before the wallet started, gives what the wallet held at its end', () => {
    const early = makeData({
      wallet: { opening: 10000, startMonth: '2026-08', entries: [deposit('2026-06-10', 3000)] },
      transactions: [walletExpense('2026-06-20', 500), expense('2026-06-21', 2000)],
    })
    expect(monthReview(early, '2026-06', TODAY)).toMatchObject({ result: -2000, walletAfter: 2500 })
    expect(monthReview(early, '2026-05', TODAY).walletAfter).toBe(0)
  })

  it('never changes the data it reads', () => {
    const frozen: AppData = deepFreeze(
      makeData({
        categories: [makeCategory('coffee')],
        recurring: [makeRecurring({ amount: 300 })],
        transactions: [expense('2026-09-03', 350, { categoryId: 'coffee', splits: [makeSplit('Anna', 100)] })],
        wallet: { opening: 1000, startMonth: '2026-08', entries: [deposit('2026-09-01', 50)] },
      }),
    )
    expect(monthReview(frozen, '2026-09', TODAY)).toMatchObject({ daily: 250, owedOpen: 100 })
  })
})

/** Data whose wallet starts in August, with the given month reviewed last. */
function reviewed(lastReviewedMonth: AppData['settings']['lastReviewedMonth'], monthStartDay = 1): AppData {
  return makeData({ settings: { lastReviewedMonth, monthStartDay }, wallet: { startMonth: '2026-08' } })
}

describe('unreviewedClosedMonth', () => {
  it('offers the latest closed period while none was reviewed', () => {
    expect(unreviewedClosedMonth(reviewed(null), TODAY)).toBe('2026-09')
  })

  it('offers it once until it is reviewed, then waits for the next period to close', () => {
    expect(unreviewedClosedMonth(reviewed('2026-08'), TODAY)).toBe('2026-09')
    expect(unreviewedClosedMonth(reviewed('2026-09'), TODAY)).toBeNull()
    expect(unreviewedClosedMonth(reviewed('2026-09'), '2026-10-31')).toBeNull()
    expect(unreviewedClosedMonth(reviewed('2026-09'), '2026-11-01')).toBe('2026-10')
  })

  it('offers only the latest closed period, even when several were never reviewed', () => {
    expect(unreviewedClosedMonth(reviewed('2026-05'), '2026-12-03')).toBe('2026-11')
  })

  it('never offers a period whose key is not newer than the one reviewed', () => {
    expect(unreviewedClosedMonth(reviewed('2026-10'), TODAY)).toBeNull()
  })

  it('has nothing to offer on a new install: the wallet starts with the current period', () => {
    const fresh = makeData({ settings: { createdAt: Date.UTC(2026, 9, 3, 10) } })
    expect(unreviewedClosedMonth(fresh, TODAY)).toBeNull()
    // Once October has closed it is offered.
    expect(unreviewedClosedMonth(fresh, '2026-11-01')).toBe('2026-10')
  })

  it('offers nothing before the wallet’s start', () => {
    const data = makeData({ wallet: { startMonth: '2026-10' } })
    expect(unreviewedClosedMonth(data, TODAY)).toBeNull()
    expect(unreviewedClosedMonth({ ...data, wallet: { ...data.wallet, startMonth: '2026-09' } }, TODAY)).toBe('2026-09')
    expect(unreviewedClosedMonth({ ...data, wallet: { ...data.wallet, startMonth: '2027-01' } }, '2026-12-15')).toBeNull()
  })

  it('uses budget periods across New Year with start day 25', () => {
    // 10 January lies in the period 2026-12 (25 Dec – 24 Jan), so 2026-11 is the latest closed one.
    expect(unreviewedClosedMonth(reviewed(null, 25), '2027-01-10')).toBe('2026-11')
    expect(unreviewedClosedMonth(reviewed('2026-11', 25), '2027-01-24')).toBeNull()
    expect(unreviewedClosedMonth(reviewed('2026-11', 25), '2027-01-25')).toBe('2026-12')
  })

  describe('across start-day changes', () => {
    // The store moves keys without a date by periodShiftForStartDayChange: 1 → 25 moves them one
    // period back, 25 → 1 one period on (§4.3), the wallet's start included.

    it('1 → 25: the period reviewed under the 1st is not offered again, the next one is', () => {
      // September (1–30 Sep) was reviewed; under the 25th its days mostly belong to 2026-08.
      const after = makeData({ settings: { monthStartDay: 25, lastReviewedMonth: '2026-08' }, wallet: { startMonth: '2026-07' } })
      // 19 October lies in 2026-09 (25 Sep – 24 Oct), which is still running.
      expect(unreviewedClosedMonth(after, TODAY)).toBeNull()
      expect(unreviewedClosedMonth(after, '2026-10-24')).toBeNull()
      // It closes on 24 October and is offered from the 25th.
      expect(unreviewedClosedMonth(after, '2026-10-25')).toBe('2026-09')
    })

    it('25 → 1: the period reviewed under the 25th is not offered again', () => {
      // 2026-08 (25 Aug – 24 Sep) was reviewed; under the 1st its days mostly belong to 2026-09.
      const after = makeData({ settings: { monthStartDay: 1, lastReviewedMonth: '2026-09' }, wallet: { startMonth: '2026-09' } })
      expect(unreviewedClosedMonth(after, TODAY)).toBeNull()
      expect(unreviewedClosedMonth(after, '2026-11-01')).toBe('2026-10')
    })

    it('finds the wallet’s start from the install date under the current start day', () => {
      // Set up on 3 October: the period 2026-10 under the 1st, 2026-09 (25 Sep – 24 Oct) under the 25th.
      const settings = { createdAt: Date.UTC(2026, 9, 3, 10) }
      const first = makeData({ settings: { ...settings, monthStartDay: 1 } })
      const late = makeData({ settings: { ...settings, monthStartDay: 25 } })
      expect(unreviewedClosedMonth(first, '2026-10-26')).toBeNull()
      expect(unreviewedClosedMonth(late, '2026-10-26')).toBe('2026-09')
    })
  })
})
