import { afterEach, describe, expect, it, vi } from 'vitest'
import { monthDiff } from '@/domain/dates'
import { computeMonthSummary } from '@/domain/summary'
import {
  deposit,
  expense,
  FIXTURE_EPOCH,
  income,
  makeCategory,
  makeData,
  makeGoal,
  makeRecurring,
  makeSplit,
  monthsBetween,
  walletExpense,
  withdrawal,
} from '@/domain/test-helpers/budgetFixtures'
import type { AppData, ISODate, MonthKey } from '@/domain/types'
import { fillGoals, goalsInFillOrder, monthResult, walletStart, walletSummary, type WalletMovement } from '@/domain/wallet'

const TODAY: ISODate = '2026-10-19'

/** Freezes a value and everything reachable from it, so any mutation throws (modules are strict). */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/** The movements as [key, date, amount, balance] rows, oldest first. */
function rows(movements: readonly WalletMovement[]): [string, ISODate, number, number][] {
  return movements.map((m) => [m.key, m.date, m.amount, m.balance])
}

/** A 'month' movement as walletSummary builds it. */
function closing(month: MonthKey, date: ISODate, amount: number, balance: number): WalletMovement {
  return { key: `month:${month}`, kind: 'month', date, month, amount, balance, note: '', entryId: null, transactionId: null }
}

describe('monthResult', () => {
  const data = makeData({
    settings: { savingsGoal: 20000 },
    recurring: [makeRecurring({ kind: 'income', amount: 200000 }), makeRecurring({ amount: 64000 })],
    transactions: [
      income('2026-10-02', 5000),
      expense('2026-10-03', 30000),
      walletExpense('2026-10-04', 90000),
      expense('2026-10-05', 6000, { splits: [makeSplit('Anna', 2000)] }),
    ],
  })

  it('is income − fixed − daily, which is the savings plus what was left', () => {
    const summary = computeMonthSummary(data, '2026-10', TODAY)
    // Daily is 30000 plus your 4000 of the split expense; the wallet-paid one is not in it.
    expect(summary).toMatchObject({ income: 205000, fixed: 64000, daily: 34000, savings: 20000, left: 87000 })
    expect(monthResult(summary)).toBe(107000)
    expect(monthResult(summary)).toBe(summary.savings + summary.left)
  })

  it('is negative when a period spends more than its income', () => {
    const over = makeData({ transactions: [income('2026-09-01', 1000), expense('2026-09-02', 4128)] })
    expect(monthResult(computeMonthSummary(over, '2026-09', TODAY))).toBe(-3128)
  })

  it('equals savings plus left in past, current and future periods', () => {
    for (const month of ['2026-09', '2026-10', '2026-11'] as const) {
      const summary = computeMonthSummary(data, month, TODAY)
      expect(monthResult(summary)).toBe(summary.savings + summary.left)
    }
  })
})

describe('walletStart', () => {
  it('is the wallet’s own first period when it has one', () => {
    expect(walletStart(makeData({ wallet: { startMonth: '2026-03' } }))).toBe('2026-03')
  })

  it('else the period of the local install date, under the current start day', () => {
    expect(walletStart(makeData())).toBe('2026-01')
    // 22:30 UTC on 24 October is 00:30 on 25 October in Berlin (CEST).
    const createdAt = Date.UTC(2026, 9, 24, 22, 30)
    expect(walletStart(makeData({ settings: { createdAt } }))).toBe('2026-10')
    expect(walletStart(makeData({ settings: { createdAt, monthStartDay: 25 } }))).toBe('2026-10')
    // An hour earlier it is still 24 October, the last day of the period that started on 25 September.
    expect(walletStart(makeData({ settings: { createdAt: createdAt - 3_600_000, monthStartDay: 25 } }))).toBe('2026-09')
  })
})

describe('walletSummary', () => {
  describe('§4.8 test: opening 50000, results +15882 and −4128, a withdrawal of 20000', () => {
    const toSavings = withdrawal('2026-10-05', 20000, { note: 'Moved to my savings account' })
    const data = makeData({
      wallet: { opening: 50000, startMonth: '2026-08', entries: [toSavings] },
      transactions: [income('2026-08-03', 15882), expense('2026-09-14', 4128), expense('2026-10-02', 1500)],
    })
    const wallet = walletSummary(data, TODAY)

    it('has a balance of 41754', () => {
      expect(wallet).toMatchObject({ start: '2026-08', balance: 41754, free: 41754, pending: -1500 })
    })

    it('lists the passbook oldest first, each movement with the running balance after it', () => {
      expect(wallet.movements).toEqual([
        {
          key: 'opening',
          kind: 'opening',
          date: '2026-08-01',
          month: null,
          amount: 50000,
          balance: 50000,
          note: '',
          entryId: null,
          transactionId: null,
        },
        closing('2026-08', '2026-08-31', 15882, 65882),
        closing('2026-09', '2026-09-30', -4128, 61754),
        {
          key: `entry:${toSavings.id}`,
          kind: 'withdrawal',
          date: '2026-10-05',
          month: null,
          amount: -20000,
          balance: 41754,
          note: 'Moved to my savings account',
          entryId: toSavings.id,
          transactionId: null,
        },
      ])
    })
  })

  it('moves in each closed period’s savings plus what was left', () => {
    const data = makeData({
      settings: { savingsGoal: 20000 },
      wallet: { startMonth: '2026-09' },
      recurring: [makeRecurring({ kind: 'income', amount: 200000 }), makeRecurring({ amount: 64000 })],
      transactions: [expense('2026-09-10', 30000)],
    })
    const september = computeMonthSummary(data, '2026-09', TODAY)
    expect(september.savings + september.left).toBe(106000)
    const wallet = walletSummary(data, TODAY)
    expect(wallet.movements).toEqual([closing('2026-09', '2026-09-30', 106000, 106000)])
    expect(wallet.pending).toBe(136000)
  })

  it('lists every closed period, also those with a result of 0', () => {
    const data = makeData({
      wallet: { startMonth: '2026-07' },
      transactions: [income('2026-08-01', 5000), expense('2026-08-31', 5000)],
    })
    expect(rows(walletSummary(data, TODAY).movements)).toEqual([
      ['month:2026-07', '2026-07-31', 0, 0],
      ['month:2026-08', '2026-08-31', 0, 0],
      ['month:2026-09', '2026-09-30', 0, 0],
    ])
  })

  it('closes each period on its last day, across New Year with start day 25', () => {
    const data = makeData({
      settings: { monthStartDay: 25 },
      wallet: { startMonth: '2026-11' },
      transactions: [
        expense('2026-12-24', 100),
        expense('2026-12-25', 200),
        expense('2027-01-24', 400),
        expense('2027-01-25', 800),
      ],
    })
    // 2027-02-10 lies in the period 2027-01 (25 Jan – 24 Feb).
    const wallet = walletSummary(data, '2027-02-10')
    expect(rows(wallet.movements)).toEqual([
      ['month:2026-11', '2026-12-24', -100, -100],
      ['month:2026-12', '2027-01-24', -600, -700],
    ])
    expect(wallet.pending).toBe(-800)
  })

  describe('the first period', () => {
    // Set up on 3 August 2026, so without wallet.startMonth the wallet starts with 2026-08.
    const base = makeData({
      settings: { createdAt: Date.UTC(2026, 7, 3, 10) },
      transactions: [income('2026-08-03', 100000)],
    })

    it('§4.8 test: a fixed cost backdated before the start changes nothing', () => {
      const backdated = { ...base, recurring: [makeRecurring({ amount: 64000, startMonth: '2026-01', endMonth: '2026-07' })] }
      expect(walletSummary(backdated, TODAY)).toEqual(walletSummary(base, TODAY))
    })

    it('counts a backdated fixed cost that is still running from the start on only', () => {
      const rent = makeRecurring({ amount: 64000, startMonth: '2026-01' })
      const wallet = walletSummary({ ...base, recurring: [rent] }, TODAY)
      expect(wallet.start).toBe('2026-08')
      expect(rows(wallet.movements)).toEqual([
        ['month:2026-08', '2026-08-31', 36000, 36000],
        ['month:2026-09', '2026-09-30', -64000, -28000],
      ])
      expect(wallet.pending).toBe(-64000)
    })

    it('leaves the income and expenses of earlier periods out', () => {
      const earlier = { ...base, transactions: [...base.transactions, expense('2026-07-31', 5000), income('2026-06-01', 999)] }
      expect(walletSummary(earlier, TODAY)).toEqual(walletSummary(base, TODAY))
    })
  })

  it('§4.8 test: editing a past expense changes the balance', () => {
    const lunch = expense('2026-09-14', 4128)
    const data = makeData({ wallet: { startMonth: '2026-08' }, transactions: [lunch] })
    expect(walletSummary(data, TODAY).balance).toBe(-4128)
    expect(walletSummary({ ...data, transactions: [{ ...lunch, amount: 5128 }] }, TODAY).balance).toBe(-5128)
    expect(walletSummary({ ...data, transactions: [{ ...lunch, date: '2026-07-14' }] }, TODAY).balance).toBe(0)
    // Paid from the wallet instead: the same money, now a payment rather than part of September.
    const paid = walletSummary({ ...data, transactions: [{ ...lunch, fromWallet: true }] }, TODAY)
    expect(paid.balance).toBe(-4128)
    expect(rows(paid.movements)).toEqual([
      ['month:2026-08', '2026-08-31', 0, 0],
      [`payment:${lunch.id}`, '2026-09-14', -4128, -4128],
      ['month:2026-09', '2026-09-30', 0, -4128],
    ])
  })

  describe('pending', () => {
    const data = makeData({
      wallet: { opening: 1000 },
      recurring: [makeRecurring({ kind: 'income', amount: 3000 })],
      transactions: [expense('2026-10-25', 500), expense('2026-11-02', 700)],
    })

    it('is the current period’s result, also when the wallet starts with it', () => {
      const wallet = walletSummary({ ...data, wallet: { ...data.wallet, startMonth: '2026-10' } }, TODAY)
      // Expenses later in the period count too: it is what the period adds when it closes.
      expect(wallet.pending).toBe(2500)
      expect(rows(wallet.movements)).toEqual([['opening', '2026-10-01', 1000, 1000]])
      expect(wallet.balance).toBe(1000)
    })

    it('§4.8 test: is null for a start in the future', () => {
      const wallet = walletSummary({ ...data, wallet: { ...data.wallet, startMonth: '2026-11' } }, TODAY)
      expect(wallet.pending).toBeNull()
      // The opening still counts; it is dated on the first day of the start.
      expect(rows(wallet.movements)).toEqual([['opening', '2026-11-01', 1000, 1000]])
      expect(wallet.balance).toBe(1000)
    })

    it('§4.8 test: is null before the start, also when the install date lies after today', () => {
      const wallet = walletSummary({ ...data, settings: { ...data.settings, createdAt: Date.UTC(2026, 10, 3, 11) } }, TODAY)
      expect(wallet.start).toBe('2026-11')
      expect(wallet.pending).toBeNull()
      expect(wallet.movements.filter((m) => m.kind === 'month')).toEqual([])
    })
  })

  describe('entries', () => {
    it('counts deposits and withdrawals dated up to today, today included, and none after it', () => {
      const today = deposit(TODAY, 300)
      const tomorrow = deposit('2026-10-20', 5000)
      const later = withdrawal('2026-12-01', 7000)
      const data = makeData({ wallet: { startMonth: '2026-10', entries: [tomorrow, today, later] } })
      const wallet = walletSummary(data, TODAY)
      expect(rows(wallet.movements)).toEqual([[`entry:${today.id}`, TODAY, 300, 300]])
      expect(wallet.balance).toBe(300)
      expect(walletSummary(data, '2026-10-20').balance).toBe(5300)
    })

    it('counts entries dated before the start, ahead of the opening', () => {
      const early = deposit('2026-07-10', 500, { note: 'Birthday money' })
      const data = makeData({ wallet: { opening: 1000, startMonth: '2026-08', entries: [early] } })
      const wallet = walletSummary(data, TODAY)
      expect(rows(wallet.movements)).toEqual([
        [`entry:${early.id}`, '2026-07-10', 500, 500],
        ['opening', '2026-08-01', 1000, 1500],
        ['month:2026-08', '2026-08-31', 0, 1500],
        ['month:2026-09', '2026-09-30', 0, 1500],
      ])
      expect(wallet.movements[0]).toMatchObject({ kind: 'deposit', note: 'Birthday money', entryId: early.id, transactionId: null })
    })

    it('has no opening movement for an opening balance of 0', () => {
      const data = makeData({ wallet: { opening: 0, startMonth: '2026-10' } })
      expect(walletSummary(data, TODAY)).toMatchObject({ balance: 0, movements: [] })
    })
  })

  describe('order of the passbook', () => {
    it('on one date: the opening, then entries and payments by createdAt, then the closing', () => {
      const data = makeData({
        wallet: {
          opening: 1000,
          startMonth: '2026-08',
          entries: [
            withdrawal('2026-08-31', 100, { id: 'late', createdAt: 30 }),
            deposit('2026-08-01', 50, { id: 'first-day', createdAt: 99 }),
            deposit('2026-08-31', 200, { id: 'early', createdAt: 10 }),
          ],
        },
        transactions: [walletExpense('2026-08-31', 300, { id: 'shoes', createdAt: 20 }), income('2026-08-02', 700)],
      })
      expect(rows(walletSummary(data, TODAY).movements)).toEqual([
        ['opening', '2026-08-01', 1000, 1000],
        ['entry:first-day', '2026-08-01', 50, 1050],
        ['entry:early', '2026-08-31', 200, 1250],
        ['payment:shoes', '2026-08-31', -300, 950],
        ['entry:late', '2026-08-31', -100, 850],
        ['month:2026-08', '2026-08-31', 700, 1550],
        ['month:2026-09', '2026-09-30', 0, 1550],
      ])
    })

    it('orders entries and payments of the same date and createdAt by key, whatever the storage order', () => {
      const data = makeData({
        wallet: {
          startMonth: '2026-10',
          entries: [deposit('2026-10-02', 100, { id: 'b', createdAt: 5 }), deposit('2026-10-02', 200, { id: 'a', createdAt: 5 })],
        },
        transactions: [walletExpense('2026-10-02', 50, { id: 'a', createdAt: 5 })],
      })
      const keys = walletSummary(data, TODAY).movements.map((m) => m.key)
      expect(keys).toEqual(['entry:a', 'entry:b', 'payment:a'])
      const reversed = { ...data, wallet: { ...data.wallet, entries: data.wallet.entries.toReversed() } }
      expect(walletSummary(reversed, TODAY).movements.map((m) => m.key)).toEqual(keys)
    })
  })

  describe('payments from the wallet', () => {
    const categories = [
      makeCategory('cat-home', { name: 'Home' }),
      makeCategory('cat-old', { name: 'Old things', archived: true }),
    ]

    it('takes out each wallet-paid expense on its date as "Paid: {note or category name}"', () => {
      const sofa = walletExpense('2026-09-20', 80000, { note: 'Sofa', categoryId: 'cat-home' })
      const lamp = walletExpense('2026-09-21', 4000, { categoryId: 'cat-home' })
      const vase = walletExpense('2026-09-22', 2000, { categoryId: 'cat-old' })
      const tv = walletExpense('2026-09-23', 30000, { categoryId: 'cat-gone' })
      const ikea = walletExpense('2026-09-24', 1000, { note: '  IKEA  ', categoryId: 'cat-home' })
      const data = makeData({ categories, wallet: { startMonth: '2026-10' }, transactions: [ikea, tv, vase, lamp, sofa] })
      const wallet = walletSummary(data, TODAY)
      expect(wallet.movements[0]).toEqual({
        key: `payment:${sofa.id}`,
        kind: 'payment',
        date: '2026-09-20',
        month: null,
        amount: -80000,
        balance: -80000,
        note: 'Paid: Sofa',
        entryId: null,
        transactionId: sofa.id,
      })
      expect(wallet.movements.map((m) => m.note)).toEqual([
        'Paid: Sofa',
        'Paid: Home',
        'Paid: Old things',
        'Paid: Uncategorized',
        'Paid: IKEA',
      ])
      expect(wallet.balance).toBe(-117000)
    })

    it('takes out only your share of a split expense', () => {
      const shared = walletExpense('2026-10-02', 9000, { splits: [makeSplit('Anna', 3000)] })
      const forgiven = walletExpense('2026-10-03', 9000, { splits: [makeSplit('Anna', 3000, { status: 'forgiven' })] })
      const covered = walletExpense('2026-10-04', 2000, { splits: [makeSplit('Anna', 2000, { status: 'paid' })] })
      const data = makeData({ wallet: { startMonth: '2026-10' }, transactions: [shared, forgiven, covered] })
      const amounts = walletSummary(data, TODAY).movements.map((m) => m.amount)
      expect(amounts).toEqual([-6000, -9000, 0])
      // A payment of nothing is +0, never −0.
      expect(Object.is(amounts[2], 0)).toBe(true)
    })

    it('§3.13: leaves its month alone and comes out of the wallet instead', () => {
      const base = makeData({
        wallet: { startMonth: '2026-09' },
        recurring: [makeRecurring({ kind: 'income', amount: 150000 })],
        transactions: [expense('2026-09-03', 20000), expense('2026-10-03', 1000)],
      })
      const sofa = walletExpense('2026-09-20', 80000)
      const shoes = walletExpense('2026-10-10', 9000)
      const without = walletSummary(base, TODAY)
      const withPayments = walletSummary({ ...base, transactions: [...base.transactions, sofa, shoes] }, TODAY)
      expect(without.movements.find((m) => m.kind === 'month')?.amount).toBe(130000)
      expect(withPayments.movements.find((m) => m.kind === 'month')?.amount).toBe(130000)
      expect(withPayments.pending).toBe(without.pending)
      expect(withPayments.balance).toBe(without.balance - 89000)
    })

    it('waits for a wallet-paid expense dated after today until its date', () => {
      const trip = walletExpense('2026-10-25', 5000)
      const data = makeData({ wallet: { opening: 10000, startMonth: '2026-10' }, transactions: [trip] })
      expect(walletSummary(data, TODAY).balance).toBe(10000)
      expect(walletSummary(data, '2026-10-25').balance).toBe(5000)
      // It is not part of October either.
      expect(walletSummary(data, TODAY).pending).toBe(0)
    })

    it('ignores income wrongly marked as paid from the wallet', () => {
      const data = makeData({ wallet: { startMonth: '2026-10' }, transactions: [income('2026-10-02', 5000, { fromWallet: true })] })
      expect(walletSummary(data, TODAY)).toMatchObject({ balance: 0, movements: [], pending: 5000 })
    })
  })

  describe('goals', () => {
    it('§4.9 test: fills the goals from the balance', () => {
      const holiday = makeGoal(120000)
      const bike = makeGoal(30000)
      const data = makeData({ wallet: { opening: 63122, startMonth: '2026-10', goals: [holiday, bike] } })
      const wallet = walletSummary(data, TODAY)
      expect(wallet.goals).toEqual([
        { goal: holiday, filled: 63122, reached: false },
        { goal: bike, filled: 0, reached: false },
      ])
      expect(wallet.goals[0]?.goal).toBe(holiday)
      expect(wallet).toMatchObject({ balance: 63122, free: 0, doneGoals: [] })
    })

    it('empties the lowest goal first when the wallet shrinks', () => {
      const holiday = makeGoal(120000)
      const bike = makeGoal(30000)
      const data = makeData({
        wallet: { opening: 200000, startMonth: '2026-10', goals: [holiday, bike] },
        transactions: [walletExpense('2026-10-05', 60000)],
      })
      const wallet = walletSummary(data, TODAY)
      expect(wallet.goals.map((g) => g.filled)).toEqual([120000, 20000])
      expect(wallet.free).toBe(0)
    })

    it('§4.9 test: a balance of 200000 fills both goals, one of −5000 fills nothing', () => {
      const goals = [makeGoal(120000), makeGoal(30000)]
      const rich = walletSummary(makeData({ wallet: { opening: 200000, startMonth: '2026-10', goals } }), TODAY)
      expect(rich.goals.map((g) => [g.filled, g.reached])).toEqual([
        [120000, true],
        [30000, true],
      ])
      expect(rich.free).toBe(50000)
      const short = walletSummary(
        makeData({ wallet: { startMonth: '2026-10', entries: [withdrawal('2026-10-02', 5000)], goals } }),
        TODAY,
      )
      expect(short.balance).toBe(-5000)
      expect(short.goals.map((g) => [g.filled, g.reached])).toEqual([
        [0, false],
        [0, false],
      ])
      expect(short.free).toBe(-5000)
    })

    it('keeps the whole balance free without goals, and lists done goals apart', () => {
      const done = makeGoal(5000, { doneAt: FIXTURE_EPOCH })
      const wallet = walletSummary(makeData({ wallet: { opening: 7000, startMonth: '2026-10', goals: [done] } }), TODAY)
      expect(wallet).toMatchObject({ balance: 7000, free: 7000, goals: [], doneGoals: [done] })
      expect(wallet.doneGoals[0]).toBe(done)
    })
  })

  describe('consistency', () => {
    // Start day 25, savings, a spread yearly cost with an override, a skipped quarterly charge,
    // expenses on period boundaries, splits and wallet-paid expenses.
    const insurance = makeRecurring({ amount: 12000, startMonth: '2026-03', everyMonths: 12, spread: true })
    const quarterly = makeRecurring({ amount: 3000, startMonth: '2026-04', everyMonths: 3, dueDay: 10 })
    const data = makeData({
      settings: { monthStartDay: 25, savingsGoal: 10000 },
      wallet: {
        opening: 2500,
        startMonth: '2026-03',
        entries: [deposit('2026-05-24', 4000), withdrawal('2026-06-25', 1000), deposit('2026-10-19', 77)],
      },
      categories: [makeCategory('cat-other')],
      recurring: [makeRecurring({ kind: 'income', amount: 180000 }), makeRecurring({ amount: 70000 }), insurance, quarterly],
      months: {
        '2026-03': { overrides: { [insurance.id]: { amount: 13200 } } },
        '2026-05': { savingsGoal: 0 },
        '2026-07': { overrides: { [quarterly.id]: { skipped: true } } },
      },
      transactions: [
        expense('2026-03-24', 999),
        expense('2026-03-25', 1100),
        expense('2026-04-24', 2200, { splits: [makeSplit('Anna', 700)] }),
        walletExpense('2026-04-25', 15000),
        income('2026-05-30', 2500),
        expense('2026-06-24', 3300, { splits: [makeSplit('Ben', 300, { status: 'forgiven' })] }),
        expense('2026-08-01', 4400, { fromWallet: true, splits: [makeSplit('Carla', 400)] }),
        expense('2026-09-24', 5500),
        expense('2026-10-30', 6600),
      ],
    })
    const wallet = walletSummary(data, TODAY)

    it('moves in exactly what each month summary gives, and has the current one pending', () => {
      const months = wallet.movements.filter((m) => m.kind === 'month')
      // 19 October lies in the period 2026-09 (25 Sep – 24 Oct).
      expect(months.map((m) => m.month)).toEqual(monthsBetween('2026-03', '2026-08'))
      for (const movement of months) {
        const summary = computeMonthSummary(data, movement.month ?? '2026-01', TODAY)
        expect([movement.month, movement.amount]).toEqual([movement.month, monthResult(summary)])
        expect(movement.date).toBe(summary.range.end)
      }
      expect(wallet.pending).toBe(monthResult(computeMonthSummary(data, '2026-09', TODAY)))
    })

    it('adds up: each running balance is the sum so far, and the last one is the balance', () => {
      let sum = 0
      for (const movement of wallet.movements) {
        sum += movement.amount
        expect(movement.balance).toBe(sum)
      }
      expect(wallet.balance).toBe(sum)
      const payments = wallet.movements.filter((m) => m.kind === 'payment').map((m) => m.amount)
      expect(payments).toEqual([-15000, -4000])
    })

    it('gives every movement its own key', () => {
      expect(new Set(wallet.movements.map((m) => m.key)).size).toBe(wallet.movements.length)
    })

    it('handles a start decades back', () => {
      const old = makeData({ wallet: { startMonth: '1990-01' }, transactions: [expense('1999-12-31', 100)] })
      const result = walletSummary(old, TODAY)
      expect(result.movements).toHaveLength(monthDiff('1990-01', '2026-10'))
      expect(result.balance).toBe(-100)
    })
  })

  describe('purity', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('depends on the data and today only, never on the clock', () => {
      const data = makeData({
        wallet: { opening: 1000, entries: [deposit('2026-10-01', 100)], goals: [makeGoal(500)] },
        transactions: [walletExpense('2026-10-02', 200), expense('2026-03-02', 300)],
      })
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2020, 0, 1))
      const before = walletSummary(data, TODAY)
      vi.setSystemTime(new Date(2031, 5, 1))
      expect(walletSummary(data, TODAY)).toEqual(before)
    })

    it('never changes the data it reads', () => {
      const data: AppData = deepFreeze(
        makeData({
          wallet: { opening: 1000, startMonth: '2026-08', entries: [withdrawal('2026-09-01', 100)], goals: [makeGoal(500), makeGoal(800)] },
          recurring: [makeRecurring({ amount: 300 })],
          transactions: [walletExpense('2026-10-02', 200, { splits: [makeSplit('Anna', 50)] }), expense('2026-09-02', 300)],
        }),
      )
      expect(() => walletSummary(data, TODAY)).not.toThrow()
      // Opening, August (fixed 300), September (fixed 300 + 300), the withdrawal, your 150 of the payment.
      expect(walletSummary(data, TODAY).balance).toBe(1000 - 300 - 600 - 100 - 150)
    })
  })
})

describe('fillGoals', () => {
  const holiday = makeGoal(120000)
  const bike = makeGoal(30000)

  it.each([
    [63122, [63122, 0], 0],
    [200000, [120000, 30000], 50000],
    [-5000, [0, 0], -5000],
    [0, [0, 0], 0],
  ])('§4.9 test: a balance of %i fills %j and leaves %i free', (balance, filled, free) => {
    const fill = fillGoals(balance, [holiday, bike])
    expect(fill.goals.map((g) => g.filled)).toEqual(filled)
    expect(fill.free).toBe(free)
  })

  it('marks a goal reached once it holds its whole target', () => {
    expect(fillGoals(150000, [holiday, bike]).goals.map((g) => g.reached)).toEqual([true, true])
    expect(fillGoals(149999, [holiday, bike]).goals.map((g) => g.reached)).toEqual([true, false])
    expect(fillGoals(119999, [holiday, bike]).goals.map((g) => g.reached)).toEqual([false, false])
  })

  it('fills by `order`, not storage order, then by createdAt and id', () => {
    const first = makeGoal(100, { id: 'z', order: 0, createdAt: 9 })
    const second = makeGoal(100, { id: 'b', order: 1, createdAt: 5 })
    const third = makeGoal(100, { id: 'c', order: 1, createdAt: 5 })
    const fourth = makeGoal(100, { id: 'a', order: 1, createdAt: 7 })
    const fill = fillGoals(250, [fourth, third, second, first])
    expect(fill.goals.map((g) => [g.goal.id, g.filled])).toEqual([
      ['z', 100],
      ['b', 100],
      ['c', 50],
      ['a', 0],
    ])
  })

  it('leaves done goals out of the fill and lists them most recently done first', () => {
    const doneEarly = makeGoal(1000, { doneAt: 100 })
    const doneLate = makeGoal(1000, { doneAt: 200 })
    const fill = fillGoals(1500, [doneEarly, holiday, doneLate, bike])
    expect(fill.goals.map((g) => g.goal)).toEqual([holiday, bike])
    expect(fill.goals.map((g) => g.filled)).toEqual([1500, 0])
    expect(fill.doneGoals).toEqual([doneLate, doneEarly])
    expect(fill.doneGoals[0]).toBe(doneLate)
    expect(fill.free).toBe(0)
  })

  it('returns the stored goal objects and changes none of them', () => {
    const goals = deepFreeze([makeGoal(100), makeGoal(200)])
    const fill = fillGoals(1000, goals)
    expect(fill.goals[0]?.goal).toBe(goals[0])
    expect(fill.goals[1]?.goal).toBe(goals[1])
    expect(fill.free).toBe(700)
  })
})

describe('goalsInFillOrder', () => {
  it('lists every goal, done ones at the place their order gives them', () => {
    const laptop = makeGoal(120000, { id: 'laptop', order: 0 })
    const trip = makeGoal(30000, { id: 'trip', order: 1, doneAt: 500 })
    const bike = makeGoal(50000, { id: 'bike', order: 2 })
    const piano = makeGoal(90000, { id: 'piano', order: 3, doneAt: 900 })
    expect(goalsInFillOrder([piano, bike, laptop, trip])).toEqual([laptop, trip, bike, piano])
  })

  it('breaks ties of order by createdAt, then by id in code-unit order', () => {
    const first = makeGoal(100, { id: 'z', order: 0, createdAt: 9 })
    const upper = makeGoal(100, { id: 'B', order: 1, createdAt: 5 })
    const lower = makeGoal(100, { id: 'b', order: 1, createdAt: 5, doneAt: 50 })
    const later = makeGoal(100, { id: 'a', order: 1, createdAt: 7 })
    // 'B' (U+0042) comes before 'b' (U+0062), whatever the locale says.
    expect(goalsInFillOrder([later, lower, upper, first]).map((g) => g.id)).toEqual(['z', 'B', 'b', 'a'])
  })

  it('agrees with the fill: the active goals in it are the goals fillGoals fills, in that order', () => {
    const goals = [
      makeGoal(100, { order: 2, doneAt: 1 }),
      makeGoal(100, { order: 1, createdAt: 8 }),
      makeGoal(100, { order: 1, createdAt: 3 }),
      makeGoal(100, { order: 0, doneAt: 2 }),
      makeGoal(100, { order: 5 }),
    ]
    expect(goalsInFillOrder(goals).filter((goal) => goal.doneAt === null)).toEqual(
      fillGoals(0, goals).goals.map((state) => state.goal),
    )
  })

  it('returns a new array of the stored goals and leaves its input alone', () => {
    const goals = deepFreeze([makeGoal(100, { order: 1 }), makeGoal(200, { order: 0 })])
    const ordered = goalsInFillOrder(goals)
    expect(ordered).not.toBe(goals)
    expect(ordered[0]).toBe(goals[1])
    expect(ordered[1]).toBe(goals[0])
    expect(goalsInFillOrder([])).toEqual([])
  })
})
