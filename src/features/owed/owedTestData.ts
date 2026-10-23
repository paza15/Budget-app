import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, makeSplit, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import type { AppData, Split, Transaction } from '@/domain/types'

/**
 * Test data for the owed feature (tests only): the split bills of docs/design/EXTRAS.md's sample.
 * Saturday 17 October: "Bar with friends", Going out, 18,00 € (Max owes 9,00 €) and "Pizza night",
 * Eating, 32,00 € (Lea and Max owe 8,00 € each); settled in September: "Bowling", Going out,
 * 24,00 €, Jonas paid back 12,00 € on Thu 1 Oct. So Max owes 17,00 €, Lea 8,00 €, 25,00 € in all.
 */

/** Thu 1 Oct 2026, 12:00 in Berlin: when Jonas paid back. */
export const PAID_BACK_AT = Date.UTC(2026, 9, 1, 10)

export function bill(id: string, amount: number, note: string, patch: Partial<Transaction>, splits: Split[]): Transaction {
  return makeTransaction({ id, amount, note, splits, ...patch })
}

export function owedData(transactions?: (sample: Transaction[]) => Transaction[]): AppData {
  const base = makeData()
  const sample = [
    bill(
      'tx-bar',
      1800,
      'Bar with friends',
      { categoryId: DEFAULT_CATEGORY_IDS.goingOut, date: '2026-10-17', createdAt: Date.UTC(2026, 9, 17, 20) },
      [makeSplit({ id: 's-bar-max', person: 'Max', amount: 900 })],
    ),
    bill(
      'tx-pizza',
      3200,
      'Pizza night',
      { categoryId: DEFAULT_CATEGORY_IDS.eating, date: '2026-10-17', createdAt: Date.UTC(2026, 9, 17, 18) },
      [makeSplit({ id: 's-pizza-lea', person: 'Lea', amount: 800 }), makeSplit({ id: 's-pizza-max', person: 'Max', amount: 800 })],
    ),
    bill('tx-bowling', 2400, 'Bowling', { categoryId: DEFAULT_CATEGORY_IDS.goingOut, date: '2026-09-19' }, [
      makeSplit({ id: 's-bowling-jonas', person: 'Jonas', amount: 1200, status: 'paid', settledAt: PAID_BACK_AT }),
    ]),
  ]
  return {
    ...base,
    settings: { ...base.settings, name: 'Alex', onboarded: true, lastReviewedMonth: '2026-09' },
    transactions: transactions === undefined ? sample : transactions(sample),
  }
}
