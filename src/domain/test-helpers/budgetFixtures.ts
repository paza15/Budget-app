import { addMonths, compareISO } from '@/domain/dates'
import type {
  AmountChange,
  AppData,
  Category,
  Cents,
  ISODate,
  MonthKey,
  Recurring,
  SavingsGoal,
  Settings,
  Split,
  Transaction,
  Wallet,
  WalletEntry,
} from '@/domain/types'

/**
 * Test data builders for the budget maths (recurring, summary, insights, splits, wallet, review).
 * Each builder returns a complete, valid object with neutral defaults, so a test spells out only
 * what it is about. Pure TypeScript, and independent of defaults.ts and catalog.ts on purpose: the
 * maths is tested on data the test controls.
 */

/** Install time of the fixtures, 2026-01-01 12:00 in Berlin. createdAt values count up from it. */
export const FIXTURE_EPOCH = Date.UTC(2026, 0, 1, 11)

let sequence = 0

/**
 * The next number of this test file's sequence. Builders use it for ids ('tx-7', valid under the
 * §4.7 id pattern) and for createdAt, so later-built records count as created later.
 */
function nextSequence(): number {
  sequence += 1
  return sequence
}

/**
 * Settings as after onboarding: EUR, de-DE, months starting on the 1st, no savings goal, no month
 * reviewed yet, installed on FIXTURE_EPOCH (so the wallet starts with 2026-01).
 */
export function makeSettings(patch: Partial<Settings> = {}): Settings {
  return {
    name: '',
    avatar: '',
    currency: 'EUR',
    locale: 'de-DE',
    monthStartDay: 1,
    savingsGoal: 0,
    theme: 'system',
    accent: 'royal',
    showCents: true,
    hideAmounts: false,
    homeCards: ['equation', 'whereItWent', 'budgets', 'comingUp', 'trend', 'recent'],
    onboarded: true,
    lastBackupAt: null,
    lastReviewedMonth: null,
    createdAt: FIXTURE_EPOCH,
    ...patch,
  }
}

/** An active category of kind 'both' without a budget, named after its id. */
export function makeCategory(id: string, patch: Partial<Omit<Category, 'id'>> = {}): Category {
  return {
    id,
    name: id,
    icon: 'circle',
    color: 'slate',
    kind: 'both',
    budget: null,
    order: 0,
    archived: false,
    ...patch,
  }
}

/** makeRecurring input: any Recurring field, plus `amount` as shorthand for one amount from startMonth. */
export type RecurringInput = Partial<Recurring> & { amount?: Cents }

/**
 * A recurring item, by default a monthly fixed cost of 10,00 € in 'cat-rent' from 2026-01 with no
 * end and no due day. Income items default to no category. `amounts` wins over `amount`.
 */
export function makeRecurring(input: RecurringInput = {}): Recurring {
  const { amount = 1000, amounts, ...fields } = input
  const n = nextSequence()
  const kind = fields.kind ?? 'expense'
  const startMonth = fields.startMonth ?? '2026-01'
  const history: AmountChange[] = amounts ?? [{ from: startMonth, amount }]
  return {
    id: `rec-${n}`,
    kind,
    name: kind === 'income' ? 'Income' : 'Fixed cost',
    categoryId: kind === 'income' ? null : 'cat-rent',
    everyMonths: 1,
    spread: false,
    endMonth: null,
    dueDay: null,
    note: '',
    order: 0,
    createdAt: FIXTURE_EPOCH + n,
    ...fields,
    startMonth,
    amounts: history,
  }
}

/**
 * A transaction: an expense in 'cat-other' without a note, paid from the budget and not split,
 * unless the input says otherwise.
 */
export function makeTransaction(input: Partial<Transaction> & Pick<Transaction, 'amount' | 'date'>): Transaction {
  const n = nextSequence()
  const kind = input.kind ?? 'expense'
  return {
    id: `tx-${n}`,
    kind,
    categoryId: kind === 'income' ? null : 'cat-other',
    note: '',
    fromWallet: false,
    splits: [],
    createdAt: FIXTURE_EPOCH + n,
    updatedAt: FIXTURE_EPOCH + n,
    ...input,
  }
}

/** An expense of `amount` on `date`. */
export function expense(date: ISODate, amount: Cents, patch: Partial<Transaction> = {}): Transaction {
  return makeTransaction({ ...patch, kind: 'expense', date, amount })
}

/** An expense of `amount` on `date` paid from the wallet (§3.13). */
export function walletExpense(date: ISODate, amount: Cents, patch: Partial<Transaction> = {}): Transaction {
  return expense(date, amount, { ...patch, fromWallet: true })
}

/** One-off income of `amount` on `date`. */
export function income(date: ISODate, amount: Cents, patch: Partial<Transaction> = {}): Transaction {
  return makeTransaction({ ...patch, kind: 'income', date, amount, categoryId: null })
}

/**
 * `person`'s part of an expense (§3.16), open unless the patch says otherwise. A paid or forgiven
 * split gets a settledAt, as the store sets it, unless the patch gives one.
 */
export function makeSplit(person: string, amount: Cents, patch: Partial<Omit<Split, 'person' | 'amount'>> = {}): Split {
  const n = nextSequence()
  const status = patch.status ?? 'open'
  return {
    id: `split-${n}`,
    person,
    amount,
    status,
    settledAt: status === 'open' ? null : FIXTURE_EPOCH + n,
    ...patch,
  }
}

/**
 * An active savings goal (§3.14) with `target`. Its `order` is its sequence number, so goals built
 * later fill later unless the patch says otherwise.
 */
export function makeGoal(target: Cents, patch: Partial<Omit<SavingsGoal, 'target'>> = {}): SavingsGoal {
  const n = nextSequence()
  return {
    id: `goal-${n}`,
    name: `Goal ${n}`,
    icon: 'circle',
    target,
    order: n,
    createdAt: FIXTURE_EPOCH + n,
    doneAt: null,
    ...patch,
  }
}

/** Money moved into (`deposit`) or out of (`withdrawal`) the wallet by hand, without a note. */
export function makeWalletEntry(
  kind: WalletEntry['kind'],
  date: ISODate,
  amount: Cents,
  patch: Partial<Omit<WalletEntry, 'kind' | 'date' | 'amount'>> = {},
): WalletEntry {
  const n = nextSequence()
  return { id: `entry-${n}`, kind, amount, date, note: '', createdAt: FIXTURE_EPOCH + n, ...patch }
}

/** A deposit of `amount` on `date`. */
export function deposit(date: ISODate, amount: Cents, patch: Partial<Omit<WalletEntry, 'kind' | 'date' | 'amount'>> = {}): WalletEntry {
  return makeWalletEntry('deposit', date, amount, patch)
}

/** A withdrawal of `amount` on `date`. */
export function withdrawal(
  date: ISODate,
  amount: Cents,
  patch: Partial<Omit<WalletEntry, 'kind' | 'date' | 'amount'>> = {},
): WalletEntry {
  return makeWalletEntry('withdrawal', date, amount, patch)
}

/** A wallet without an opening balance, entries or goals that starts with the set-up period. */
export function makeWallet(patch: Partial<Wallet> = {}): Wallet {
  return { opening: 0, startMonth: null, entries: [], goals: [], ...patch }
}

/** makeData input: the AppData parts a test cares about; settings and wallet are patches. */
export interface DataInput {
  settings?: Partial<Settings>
  categories?: Category[]
  recurring?: Recurring[]
  transactions?: Transaction[]
  months?: AppData['months']
  wallet?: Partial<Wallet>
}

/** AppData of schema 1 with no quick adds; everything else as given or empty. */
export function makeData(input: DataInput = {}): AppData {
  return {
    schemaVersion: 1,
    settings: makeSettings(input.settings),
    categories: input.categories ?? [],
    recurring: input.recurring ?? [],
    transactions: input.transactions ?? [],
    quickAdds: [],
    months: input.months ?? {},
    wallet: makeWallet(input.wallet),
  }
}

/** Every period key from `first` to `last`, inclusive. */
export function monthsBetween(first: MonthKey, last: MonthKey): MonthKey[] {
  const months: MonthKey[] = []
  for (let month = first; compareISO(month, last) <= 0; month = addMonths(month, 1)) months.push(month)
  return months
}
