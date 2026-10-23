import { describe, expect, it } from 'vitest'
import { budgetAmount, myShare, owedSummary, personSuggestions, type OwedSummary } from '@/domain/splits'
import { expense, income, makeData, makeSplit, walletExpense } from '@/domain/test-helpers/budgetFixtures'
import type { SplitStatus, Transaction } from '@/domain/types'

/** Freezes a value and everything reachable from it, so any mutation throws (modules are strict). */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/** An expense of 4000 with one split of 1500 in `status`. */
function withOneSplit(status: SplitStatus): Transaction {
  return expense('2026-10-10', 4000, { splits: [makeSplit('Anna', 1500, { status })] })
}

describe('myShare', () => {
  it('is the whole amount of an expense without splits', () => {
    expect(myShare(expense('2026-10-10', 4500))).toBe(4500)
  })

  it.each([
    ['open', 2500],
    ['paid', 2500],
    ['forgiven', 4000],
  ] as const)('takes off a %s split of 1500 from 4000, leaving %i', (status, share) => {
    expect(myShare(withOneSplit(status))).toBe(share)
  })

  it('takes off every open and paid split and none of the forgiven ones', () => {
    const tx = expense('2026-10-10', 6000, {
      splits: [
        makeSplit('Anna', 2000),
        makeSplit('Ben', 1000, { status: 'paid' }),
        makeSplit('Carla', 1500, { status: 'forgiven' }),
      ],
    })
    expect(myShare(tx)).toBe(3000)
  })

  it('is 0 when the splits cover the whole amount', () => {
    const tx = expense('2026-10-10', 3000, { splits: [makeSplit('Anna', 1000), makeSplit('Ben', 2000, { status: 'paid' })] })
    expect(myShare(tx)).toBe(0)
  })

  it('never goes below 0, even when stored splits add up to more than the amount', () => {
    const tx = expense('2026-10-10', 1000, { splits: [makeSplit('Anna', 800), makeSplit('Ben', 700)] })
    expect(myShare(tx)).toBe(0)
  })

  it('is the same for an expense paid from the wallet', () => {
    const tx = walletExpense('2026-10-10', 4000, { splits: [makeSplit('Anna', 1500)] })
    expect(myShare(tx)).toBe(2500)
  })

  it('is the whole amount of income, which has no splits', () => {
    expect(myShare(income('2026-10-10', 5000))).toBe(5000)
    // Only expenses have splits (§4.9), so stray ones on income change nothing.
    expect(myShare(income('2026-10-10', 5000, { splits: [makeSplit('Anna', 1000)] }))).toBe(5000)
  })
})

describe('budgetAmount', () => {
  it('is myShare for an expense paid from the budget', () => {
    expect(budgetAmount(expense('2026-10-10', 4500))).toBe(4500)
    expect(budgetAmount(withOneSplit('open'))).toBe(2500)
    expect(budgetAmount(withOneSplit('paid'))).toBe(2500)
    expect(budgetAmount(withOneSplit('forgiven'))).toBe(4000)
  })

  it('is 0 for an expense paid from the wallet, split or not', () => {
    expect(budgetAmount(walletExpense('2026-10-10', 4500))).toBe(0)
    expect(budgetAmount(walletExpense('2026-10-10', 4000, { splits: [makeSplit('Anna', 1500)] }))).toBe(0)
  })

  it('is 0 for income, also when it is wrongly marked as paid from the wallet', () => {
    expect(budgetAmount(income('2026-10-10', 5000))).toBe(0)
    expect(budgetAmount(income('2026-10-10', 5000, { fromWallet: true }))).toBe(0)
  })
})

describe('owedSummary', () => {
  const dinner = expense('2026-10-10', 9000, {
    note: 'Dinner',
    splits: [makeSplit('Anna', 3000), makeSplit('Ben', 3000)],
  })
  const cinema = expense('2026-10-12', 2400, { note: 'Cinema', splits: [makeSplit('anna', 1200)] })
  const taxi = expense('2026-10-05', 1800, {
    splits: [makeSplit('ANNA', 900, { status: 'paid' }), makeSplit('Ben', 600, { status: 'forgiven' })],
  })
  const groceries = walletExpense('2026-10-08', 5000, { note: 'Groceries', splits: [makeSplit('Carla', 2500)] })
  const gift = income('2026-10-09', 1000, { splits: [makeSplit('Dora', 500)] })
  const coffee = expense('2026-10-11', 350)
  const data = makeData({ transactions: [dinner, taxi, coffee, groceries, gift, cinema] })

  it('is empty without open splits', () => {
    expect(owedSummary(makeData())).toEqual({ total: 0, people: [] })
    expect(owedSummary(makeData({ transactions: [taxi, coffee] }))).toEqual({ total: 0, people: [] })
  })

  it('groups the open splits by person, with totals, the biggest debt first', () => {
    const owed: OwedSummary = {
      total: 9700,
      people: [
        {
          person: 'anna',
          total: 4200,
          items: [
            { transactionId: cinema.id, splitId: cinema.splits[0]?.id ?? '', date: '2026-10-12', note: 'Cinema', amount: 1200 },
            { transactionId: dinner.id, splitId: dinner.splits[0]?.id ?? '', date: '2026-10-10', note: 'Dinner', amount: 3000 },
          ],
        },
        {
          person: 'Ben',
          total: 3000,
          items: [{ transactionId: dinner.id, splitId: dinner.splits[1]?.id ?? '', date: '2026-10-10', note: 'Dinner', amount: 3000 }],
        },
        {
          person: 'Carla',
          total: 2500,
          items: [
            { transactionId: groceries.id, splitId: groceries.splits[0]?.id ?? '', date: '2026-10-08', note: 'Groceries', amount: 2500 },
          ],
        },
      ],
    }
    expect(owedSummary(data)).toEqual(owed)
  })

  it('leaves out paid and forgiven splits and the splits of income', () => {
    const people = owedSummary(data).people.map((p) => p.person.toLowerCase())
    expect(people).not.toContain('dora')
    // Anna's paid taxi split and Ben's forgiven one are settled.
    expect(owedSummary(data).people.flatMap((p) => p.items).map((item) => item.transactionId)).not.toContain(taxi.id)
  })

  it('shows the latest spelling: of the newest expense by date, then by createdAt', () => {
    const older = expense('2026-10-01', 1000, { createdAt: 5, splits: [makeSplit('BEN', 100)] })
    const sameDayEarlier = expense('2026-10-02', 1000, { createdAt: 1, splits: [makeSplit('Ben', 100)] })
    const sameDayLater = expense('2026-10-02', 1000, { createdAt: 2, splits: [makeSplit('ben', 100)] })
    const owed = owedSummary(makeData({ transactions: [sameDayLater, older, sameDayEarlier] }))
    expect(owed.people).toHaveLength(1)
    expect(owed.people[0]?.person).toBe('ben')
    expect(owed.people[0]?.items.map((item) => item.transactionId)).toEqual([sameDayLater.id, sameDayEarlier.id, older.id])
  })

  it('matches names ignoring case and extra whitespace, and shows them trimmed', () => {
    const owed = owedSummary(
      makeData({
        transactions: [
          expense('2026-10-01', 1000, { splits: [makeSplit('Anna Maria', 300)] }),
          expense('2026-10-02', 1000, { splits: [makeSplit(' anna  maria ', 200)] }),
        ],
      }),
    )
    expect(owed.people.map(({ person, total }) => [person, total])).toEqual([['anna  maria', 500]])
  })

  it('keeps the person with the most recent open split first when totals are equal', () => {
    const owed = owedSummary(
      makeData({
        transactions: [
          expense('2026-10-01', 1000, { splits: [makeSplit('Anna', 500)] }),
          expense('2026-10-03', 1000, { splits: [makeSplit('Ben', 500)] }),
          expense('2026-10-02', 1000, { splits: [makeSplit('Carla', 400), makeSplit('Carla', 100)] }),
        ],
      }),
    )
    expect(owed.people.map((p) => p.person)).toEqual(['Ben', 'Carla', 'Anna'])
    expect(owed.people[1]?.items.map((item) => item.amount)).toEqual([400, 100])
  })

  it('never changes the data it reads', () => {
    const frozen = deepFreeze(makeData({ transactions: [dinner, taxi, groceries, cinema] }))
    expect(owedSummary(frozen).total).toBe(9700)
  })
})

describe('personSuggestions', () => {
  const data = makeData({
    transactions: [
      expense('2026-10-01', 4000, { splits: [makeSplit('Anna', 1000), makeSplit('Ben', 1000, { status: 'paid' })] }),
      expense('2026-10-05', 4000, {
        splits: [makeSplit('ben', 1000, { status: 'forgiven' }), makeSplit('Carla', 1000)],
      }),
      expense('2026-10-03', 4000, { splits: [makeSplit('Anna Maria', 1000)] }),
      expense('2026-10-04', 4000),
      income('2026-10-07', 4000, { splits: [makeSplit('Dora', 1000)] }),
    ],
  })

  it('lists every name used in a split, the most recent first, each once in its latest spelling', () => {
    expect(personSuggestions(data)).toEqual(['ben', 'Carla', 'Anna Maria', 'Anna'])
  })

  it('is empty without splits', () => {
    expect(personSuggestions(makeData())).toEqual([])
    expect(personSuggestions(makeData({ transactions: [expense('2026-10-01', 100)] }))).toEqual([])
  })

  it.each([
    ['an', ['Anna Maria', 'Anna']],
    ['AN', ['Anna Maria', 'Anna']],
    ['  an', ['Anna Maria', 'Anna']],
    ['anna ', ['Anna Maria']],
    ['anna  m', ['Anna Maria']],
    ['b', ['ben']],
    ['x', []],
    ['', ['ben', 'Carla', 'Anna Maria', 'Anna']],
    ['   ', ['ben', 'Carla', 'Anna Maria', 'Anna']],
  ] as const)('with the prefix %j gives %j', (prefix, expected) => {
    expect(personSuggestions(data, prefix)).toEqual(expected)
  })

  it('orders expenses of one date by createdAt, newest first', () => {
    const suggestions = personSuggestions(
      makeData({
        transactions: [
          expense('2026-10-02', 1000, { createdAt: 1, splits: [makeSplit('Early', 100)] }),
          expense('2026-10-02', 1000, { createdAt: 2, splits: [makeSplit('Late', 100)] }),
        ],
      }),
    )
    expect(suggestions).toEqual(['Late', 'Early'])
  })
})
