import { daysAfterInstall, makeData, makeGoal, makeRecurring, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import type { AppData, SavingsGoal, WalletEntry } from '@/domain/types'

/**
 * Test data for the Wallet feature: installed 3 Aug 2026 (the wallet counts from August), today
 * 14 Oct 2026 (NOW in dataFixtures). 1.450,00 € comes in and Rent takes 650,00 € every month;
 * August's expenses are 300,00 €, September's 200,00 €, October's so far 100,00 €. So August
 * closed +500,00 €, September +600,00 €, and October adds 700,00 € when it closes.
 *
 * Passbook: opening 500,00 € (1 Aug) → 500,00; August closed +500,00 → 1.000,00; birthday money
 * +50,00 (12 Sep) → 1.050,00; September closed +600,00 → 1.650,00; moved to savings −200,00
 * (5 Oct) → 1.450,00 €, the balance.
 *
 * Goals: Winter jacket is done; Japan trip (2.000,00 €) holds all 1.450,00 € (550,00 € to go) and
 * New bike (300,00 €) waits for it.
 */

export const GRANDMA: WalletEntry = {
  id: 'entry-grandma',
  kind: 'deposit',
  amount: 5000,
  date: '2026-09-12',
  note: 'Birthday money from grandma',
  createdAt: daysAfterInstall(40),
}

export const SAVINGS: WalletEntry = {
  id: 'entry-savings',
  kind: 'withdrawal',
  amount: 20000,
  date: '2026-10-05',
  note: 'Moved to my savings account',
  createdAt: daysAfterInstall(63),
}

export const JACKET: SavingsGoal = makeGoal({
  id: 'goal-jacket',
  name: 'Winter jacket',
  icon: 't-shirt',
  target: 12000,
  order: 0,
  doneAt: daysAfterInstall(61),
})

export const JAPAN: SavingsGoal = makeGoal({ id: 'goal-japan', name: 'Japan trip', icon: 'airplane', target: 200000, order: 1 })

export const BIKE: SavingsGoal = makeGoal({
  id: 'goal-bike',
  name: 'New bike',
  icon: 'bicycle',
  target: 30000,
  order: 2,
  createdAt: daysAfterInstall(10),
})

export function walletData(wallet: Partial<AppData['wallet']> = {}): AppData {
  const base = makeData()
  return {
    ...base,
    settings: { ...base.settings, onboarded: true },
    recurring: [
      makeRecurring({ id: 'rec-salary', kind: 'income', amounts: [{ from: '2026-08', amount: 145000 }] }),
      makeRecurring({ id: 'rec-rent' }),
    ],
    transactions: [
      makeTransaction({ id: 'tx-aug', amount: 30000, date: '2026-08-10', createdAt: daysAfterInstall(7) }),
      makeTransaction({ id: 'tx-sep', amount: 20000, date: '2026-09-10', createdAt: daysAfterInstall(38) }),
      makeTransaction({ id: 'tx-oct', amount: 10000, date: '2026-10-10', createdAt: daysAfterInstall(68) }),
    ],
    wallet: {
      opening: 50000,
      startMonth: null,
      entries: [GRANDMA, SAVINGS],
      goals: [JACKET, JAPAN, BIKE],
      ...wallet,
    },
  }
}

/** First-run data: nothing has closed, no opening, no entries, no goals. */
export function emptyWalletData(): AppData {
  const base = makeData()
  return { ...base, settings: { ...base.settings, onboarded: true, createdAt: Date.UTC(2026, 9, 1, 8) } }
}
