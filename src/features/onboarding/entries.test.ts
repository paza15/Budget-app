import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECURRING_SUGGESTIONS } from '@/domain/catalog'
import { BEFORE_APP_NOTE } from '@/domain/constants'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, makeRecurring, makeTransaction, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData, MonthKey, Recurring } from '@/domain/types'
import {
  beforeAppEntry,
  fixedRows,
  incomeRows,
  newIncomeRow,
  openingSavings,
  openSuggestions,
  saveFixedRows,
  saveIncomeRows,
  saveOpeningSavings,
  saveSpentSoFar,
  suggestionRow,
  type FixedRow,
} from '@/features/onboarding/entries'
import { getData, useAppStore } from '@/store/appStore'

// docs/SPEC.md §3.9: idempotent steps. Rows show what the data holds for the current period;
// editing updates, clearing deletes, only added rows create items starting this period.

const OCTOBER: MonthKey = '2026-10'

function seed(patch: Partial<AppData> = {}): void {
  useAppStore.setState({ data: makeData(patch), status: 'ready' })
}

function recurring(kind: Recurring['kind']): Recurring[] {
  return getData().recurring.filter((item) => item.kind === kind)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  seed()
})

afterEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('incomeRows', () => {
  it('offers one row named "Income" when this period has no recurring income', () => {
    const rows = incomeRows(getData().recurring, OCTOBER)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: null, name: 'Income', amount: null })
  })

  it('lists the recurring income of the period with the amount in effect, in order', () => {
    seed({
      recurring: [
        makeRecurring({ id: 'rec-parents', kind: 'income', name: 'Parents', order: 2, amounts: [{ from: '2026-08', amount: 35000 }] }),
        makeRecurring({
          id: 'rec-job',
          kind: 'income',
          name: 'Job',
          order: 1,
          amounts: [
            { from: '2026-08', amount: 100000 },
            { from: '2026-10', amount: 110000 },
          ],
        }),
        makeRecurring({ id: 'rec-ended', kind: 'income', name: 'Ended', order: 0, endMonth: '2026-09' }),
        makeRecurring({ id: 'rec-rent' }),
      ],
    })
    expect(incomeRows(getData().recurring, OCTOBER).map((row) => [row.id, row.name, row.amount])).toEqual([
      ['rec-job', 'Job', 110000],
      ['rec-parents', 'Parents', 35000],
    ])
  })
})

describe('saveIncomeRows', () => {
  it('creates the rows with an amount from this period on and leaves out empty ones', () => {
    const rows = [
      { ...newIncomeRow('Income'), amount: 110000 },
      { ...newIncomeRow('  Parents  '), amount: 35000 },
      { ...newIncomeRow('BAföG'), amount: null },
    ]
    saveIncomeRows(rows, OCTOBER, getData().recurring)
    expect(recurring('income').map((item) => [item.name, item.amounts, item.startMonth, item.categoryId])).toEqual([
      ['Income', [{ from: OCTOBER, amount: 110000 }], OCTOBER, null],
      ['Parents', [{ from: OCTOBER, amount: 35000 }], OCTOBER, null],
    ])
  })

  it('names income without a name "Income"', () => {
    saveIncomeRows([{ ...newIncomeRow('   '), amount: 5000 }], OCTOBER, getData().recurring)
    expect(recurring('income')[0]?.name).toBe('Income')
  })

  it('updates the items it lists, deletes the cleared ones and keeps untouched ones as they were', () => {
    seed({
      recurring: [
        makeRecurring({ id: 'rec-job', kind: 'income', name: 'Job', amounts: [{ from: '2026-08', amount: 100000 }] }),
        makeRecurring({ id: 'rec-parents', kind: 'income', name: 'Parents', amounts: [{ from: '2026-08', amount: 35000 }] }),
        makeRecurring({
          id: 'rec-bafoeg',
          kind: 'income',
          name: 'BAföG',
          amounts: [
            { from: '2026-08', amount: 40000 },
            { from: '2026-10', amount: 45000 },
          ],
        }),
      ],
    })
    const before = getData()
    const rows = incomeRows(before.recurring, OCTOBER).map((row) => {
      if (row.id === 'rec-job') return { ...row, name: 'Werkstudent', amount: 120000 }
      if (row.id === 'rec-parents') return { ...row, amount: null }
      return row
    })
    saveIncomeRows(rows, OCTOBER, before.recurring)
    const items = recurring('income')
    expect(items.map((item) => item.id)).toEqual(['rec-job', 'rec-bafoeg'])
    // A changed amount applies to every period ('all').
    expect(items[0]).toMatchObject({ name: 'Werkstudent', amounts: [{ from: '2026-08', amount: 120000 }] })
    // Untouched: its history stays.
    expect(items[1]).toBe(before.recurring[2])
  })

  it('writes nothing when nothing changed', () => {
    seed({ recurring: [makeRecurring({ id: 'rec-job', kind: 'income', name: 'Job' })] })
    const before = getData()
    saveIncomeRows(incomeRows(before.recurring, OCTOBER), OCTOBER, before.recurring)
    expect(getData()).toBe(before)
  })
})

describe('fixedRows', () => {
  it('starts with an empty Rent row, never a price', () => {
    const rows = fixedRows(getData().recurring, OCTOBER)
    expect(rows).toEqual([
      { key: 'rent', id: null, name: 'Rent', categoryId: DEFAULT_CATEGORY_IDS.rent, everyMonths: 1, amount: null },
    ])
  })

  it('binds Rent to the first fixed cost in Rent and lists the other costs of the period after it', () => {
    seed({
      recurring: [
        makeRecurring({ id: 'rec-gym', name: 'Gym', categoryId: DEFAULT_CATEGORY_IDS.subscriptions, order: 0, amounts: [{ from: '2026-08', amount: 2990 }] }),
        makeRecurring({ id: 'rec-miete', name: 'Miete', order: 1, amounts: [{ from: '2026-08', amount: 64000 }] }),
        makeRecurring({ id: 'rec-garage', name: 'Garage', order: 2 }),
        makeRecurring({ id: 'rec-future', name: 'Later', startMonth: '2026-12' }),
        makeRecurring({ id: 'rec-job', kind: 'income', name: 'Job' }),
      ],
    })
    expect(fixedRows(getData().recurring, OCTOBER).map((row) => [row.id, row.name, row.amount])).toEqual([
      ['rec-miete', 'Miete', 64000],
      ['rec-gym', 'Gym', 2990],
      ['rec-garage', 'Garage', 65000],
    ])
  })
})

describe('openSuggestions and suggestionRow', () => {
  it('offers the suggestions not on the list yet, whatever their case', () => {
    const rows: FixedRow[] = [...fixedRows(getData().recurring, OCTOBER), { ...suggestionRow(RECURRING_SUGGESTIONS[0]!), name: 'NETFLIX' }]
    const names = openSuggestions(rows).map((suggestion) => suggestion.name)
    expect(names).not.toContain('Netflix')
    expect(names).toEqual(RECURRING_SUGGESTIONS.slice(1).map((suggestion) => suggestion.name))
  })

  it('makes a named row with the suggestion\'s category and interval and no price', () => {
    const insurance = RECURRING_SUGGESTIONS.find((suggestion) => suggestion.name === 'Insurance')!
    expect(suggestionRow(insurance)).toMatchObject({
      id: null,
      name: 'Insurance',
      categoryId: DEFAULT_CATEGORY_IDS.insurance,
      everyMonths: 12,
      amount: null,
    })
  })
})

describe('saveFixedRows', () => {
  it('creates Rent and the suggestions with an amount, spreading costs that are not monthly', () => {
    const ticket = RECURRING_SUGGESTIONS.find((suggestion) => suggestion.name === 'Deutschlandticket')!
    const insurance = RECURRING_SUGGESTIONS.find((suggestion) => suggestion.name === 'Insurance')!
    const netflix = RECURRING_SUGGESTIONS.find((suggestion) => suggestion.name === 'Netflix')!
    const [rent] = fixedRows(getData().recurring, OCTOBER)
    const rows = [
      { ...rent!, amount: 64000 },
      { ...suggestionRow(ticket), amount: 6300 },
      { ...suggestionRow(insurance), amount: 12000 },
      suggestionRow(netflix),
    ]
    saveFixedRows(rows, OCTOBER, getData().recurring)
    expect(
      recurring('expense').map((item) => [item.name, item.categoryId, item.everyMonths, item.spread, item.amounts, item.startMonth]),
    ).toEqual([
      ['Rent', DEFAULT_CATEGORY_IDS.rent, 1, false, [{ from: OCTOBER, amount: 64000 }], OCTOBER],
      ['Deutschlandticket', DEFAULT_CATEGORY_IDS.transport, 1, false, [{ from: OCTOBER, amount: 6300 }], OCTOBER],
      ['Insurance', DEFAULT_CATEGORY_IDS.insurance, 12, true, [{ from: OCTOBER, amount: 12000 }], OCTOBER],
    ])
  })

  it('updates and deletes the costs it lists', () => {
    seed({
      recurring: [
        makeRecurring({ id: 'rec-rent' }),
        makeRecurring({ id: 'rec-gym', name: 'Gym', categoryId: DEFAULT_CATEGORY_IDS.subscriptions, order: 1 }),
      ],
    })
    const before = getData()
    const rows = fixedRows(before.recurring, OCTOBER).map((row) =>
      row.id === 'rec-rent' ? { ...row, amount: 70000 } : { ...row, amount: null },
    )
    saveFixedRows(rows, OCTOBER, before.recurring)
    expect(recurring('expense').map((item) => [item.id, item.amounts])).toEqual([['rec-rent', [{ from: '2026-08', amount: 70000 }]]])
  })
})

describe('Spent so far', () => {
  it('adds one expense in Other on the first day of the period, noted "Before On a Budget"', () => {
    saveSpentSoFar(12000, OCTOBER, 1, getData().transactions)
    expect(getData().transactions).toEqual([
      expect.objectContaining({
        kind: 'expense',
        amount: 12000,
        categoryId: DEFAULT_CATEGORY_IDS.other,
        date: '2026-10-01',
        note: BEFORE_APP_NOTE,
      }),
    ])
    expect(beforeAppEntry(getData().transactions, OCTOBER, 1)?.amount).toBe(12000)
  })

  it('dates it on the custom start day of the period', () => {
    saveSpentSoFar(5000, '2026-09', 25, getData().transactions)
    expect(getData().transactions[0]?.date).toBe('2026-09-25')
    expect(beforeAppEntry(getData().transactions, '2026-09', 25)).not.toBeNull()
    expect(beforeAppEntry(getData().transactions, '2026-09', 1)).toBeNull()
  })

  it('changes the same expense on a second visit and removes it when emptied', () => {
    saveSpentSoFar(12000, OCTOBER, 1, getData().transactions)
    saveSpentSoFar(15000, OCTOBER, 1, getData().transactions)
    expect(getData().transactions).toHaveLength(1)
    expect(getData().transactions[0]?.amount).toBe(15000)
    saveSpentSoFar(null, OCTOBER, 1, getData().transactions)
    expect(getData().transactions).toHaveLength(0)
  })

  it('leaves other expenses alone', () => {
    seed({ transactions: [makeTransaction({ id: 'tx-coffee', date: '2026-10-01' })] })
    saveSpentSoFar(null, OCTOBER, 1, getData().transactions)
    expect(getData().transactions.map((tx) => tx.id)).toEqual(['tx-coffee'])
    expect(beforeAppEntry(getData().transactions, OCTOBER, 1)).toBeNull()
  })
})

describe('Savings you already have (§3.12)', () => {
  it("shows the wallet's opening balance, and nothing while it is 0", () => {
    expect(openingSavings(0)).toBeNull()
    expect(openingSavings(50000)).toBe(50000)
  })

  it("sets the wallet's opening balance, an emptied field to 0", () => {
    saveOpeningSavings(50000, getData().wallet.opening)
    expect(getData().wallet.opening).toBe(50000)
    saveOpeningSavings(null, getData().wallet.opening)
    expect(getData().wallet.opening).toBe(0)
  })

  it('writes nothing when nothing changed', () => {
    const before = getData()
    saveOpeningSavings(null, before.wallet.opening)
    expect(getData()).toBe(before)
    seed({ wallet: { ...makeData().wallet, opening: 80000 } })
    const restored = getData()
    saveOpeningSavings(80000, restored.wallet.opening)
    expect(getData()).toBe(restored)
  })
})
