import { ACCENTS, CATEGORY_COLORS, HOME_CARDS, NUMBER_LOCALES } from '@/domain/catalog'
import { BEFORE_APP_NOTE, MAX_CENTS, MAX_LENGTHS, MAX_MONTH_START_DAY } from '@/domain/constants'
import { compareISO, isValidISODate, isValidMonthKey } from '@/domain/dates'
import { createInitialData, CURRENT_SCHEMA_VERSION, DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { ID_PATTERN } from '@/domain/ids'
import { isEmoji, isIconRef, splitGraphemes } from '@/domain/queries'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import type { AppData, Category, ISODate, QuickAdd, Recurring, SavingsGoal, Split, Transaction } from '@/domain/types'

/**
 * Test data for the data layer (normalize, backup, queries): fixed clock values, builders that
 * return complete valid rows, a realistic data set in normalised form, and a checker for every
 * invariant normalizeAppData promises. Tests run with TZ=Europe/Berlin.
 */

/** 2026-10-14 10:00 in Berlin (UTC+2): the clock the e2e specs freeze (§9). */
export const NOW = Date.UTC(2026, 9, 14, 8)

/** The local date of NOW. */
export const TODAY: ISODate = '2026-10-14'

/** Install time of the fixture data: 2026-08-03 09:00 in Berlin. */
export const INSTALLED_AT = Date.UTC(2026, 7, 3, 7)

const MS_PER_DAY = 86_400_000

/** Epoch ms `days` days after the install (fractions allowed), for createdAt values. */
export function daysAfterInstall(days: number): number {
  return INSTALLED_AT + Math.round(days * MS_PER_DAY)
}

/** A category of kind 'both' without a limit, named after its id. */
export function makeCategory(id: string, patch: Partial<Omit<Category, 'id'>> = {}): Category {
  return { id, name: id, icon: 'circle', color: 'slate', kind: 'both', budget: null, order: 0, archived: false, ...patch }
}

/**
 * An expense of 3,50 in Coffee & snacks on TODAY, created at NOW, paid from the month's budget
 * and not split, unless `patch` says otherwise.
 */
export function makeTransaction(patch: Partial<Transaction> = {}): Transaction {
  const kind = patch.kind ?? 'expense'
  return {
    id: 'tx-1',
    kind,
    amount: 350,
    categoryId: kind === 'income' ? null : DEFAULT_CATEGORY_IDS.coffee,
    date: TODAY,
    note: '',
    fromWallet: false,
    splits: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  }
}

/** An open split: Mia owes 1,00, unless `patch` says otherwise. */
export function makeSplit(patch: Partial<Split> = {}): Split {
  return { id: 'split-1', person: 'Mia', amount: 100, status: 'open', settledAt: null, ...patch }
}

/** An active savings goal of 1.200,00 for a laptop, created at the install, unless `patch` says otherwise. */
export function makeGoal(patch: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: 'goal-1',
    name: 'New laptop',
    icon: 'laptop',
    target: 120000,
    order: 0,
    createdAt: INSTALLED_AT,
    doneAt: null,
    ...patch,
  }
}

/** A monthly fixed cost of 650,00 in Rent from 2026-08, unless `patch` says otherwise. */
export function makeRecurring(patch: Partial<Recurring> = {}): Recurring {
  const kind = patch.kind ?? 'expense'
  const startMonth = patch.startMonth ?? '2026-08'
  return {
    id: 'rec-1',
    kind,
    name: kind === 'income' ? 'Salary' : 'Rent',
    categoryId: kind === 'income' ? null : DEFAULT_CATEGORY_IDS.rent,
    amounts: [{ from: startMonth, amount: 65000 }],
    everyMonths: 1,
    spread: false,
    startMonth,
    endMonth: null,
    dueDay: 1,
    note: '',
    order: 0,
    createdAt: INSTALLED_AT,
    ...patch,
  }
}

/** A quick add of 3,50 in Coffee & snacks, unless `patch` says otherwise. */
export function makeQuickAdd(patch: Partial<QuickAdd> = {}): QuickAdd {
  return { id: 'qa-1', label: 'Coffee', icon: 'coffee', amount: 350, categoryId: DEFAULT_CATEGORY_IDS.coffee, order: 0, ...patch }
}

/** First-run data (installed at INSTALLED_AT in Berlin with a German phone) with `patch` applied. */
export function makeData(patch: Partial<AppData> = {}): AppData {
  return { ...createInitialData(INSTALLED_AT, 'de-DE', 'Europe/Berlin'), ...patch }
}

/**
 * Two and a half months of realistic use, already in normalised form: personalised settings with
 * September reviewed, the default categories plus an emoji one and an archived one with a limit,
 * monthly, yearly (spread), quarterly, ended and income items with amount changes, expenses with
 * notes that need CSV escaping, an onboarding entry, uncategorized and orphaned expenses, split
 * expenses (a paid split; an open and a forgiven one on the same expense), an expense paid from
 * the wallet, one-off income, quick adds, per-period overrides and savings, and a wallet with an
 * opening balance, entries and savings goals (two active, one done). Still nine transactions,
 * which store tests count. A new object every call.
 */
export function sampleData(): AppData {
  const base = makeData()
  return {
    ...base,
    settings: {
      ...base.settings,
      name: 'Alex',
      avatar: '🦊',
      savingsGoal: 20000,
      theme: 'dark',
      accent: 'bottle',
      showCents: false,
      hideAmounts: true,
      homeCards: ['whereItWent', 'equation', 'wallet', 'owed', 'comingUp', 'recent'],
      onboarded: true,
      lastBackupAt: daysAfterInstall(40),
      lastReviewedMonth: '2026-09',
    },
    categories: [
      ...base.categories,
      makeCategory('cat-books', { name: 'Books', icon: '📚', color: 'violet', kind: 'daily', budget: 5000, order: 12 }),
      makeCategory('cat-gym', { name: 'Gym', icon: 'barbell', color: 'green', kind: 'fixed', budget: 3000, order: 13, archived: true }),
    ],
    recurring: [
      makeRecurring({ id: 'rec-rent', dueDay: 1 }),
      makeRecurring({
        id: 'rec-netflix',
        name: 'Netflix',
        categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
        amounts: [
          { from: '2026-08', amount: 1399 },
          { from: '2026-11', amount: 1499 },
        ],
        dueDay: 12,
        order: 1,
        createdAt: daysAfterInstall(0.1),
      }),
      makeRecurring({
        id: 'rec-insurance',
        name: 'Liability insurance',
        categoryId: DEFAULT_CATEGORY_IDS.insurance,
        amounts: [{ from: '2026-03', amount: 12000 }],
        everyMonths: 12,
        spread: true,
        startMonth: '2026-03',
        dueDay: 15,
        note: 'Paid by direct debit',
        order: 2,
        createdAt: daysAfterInstall(0.2),
      }),
      makeRecurring({
        id: 'rec-rundfunk',
        name: 'Rundfunkbeitrag',
        categoryId: DEFAULT_CATEGORY_IDS.other,
        amounts: [{ from: '2026-08', amount: 5508 }],
        everyMonths: 3,
        dueDay: 15,
        order: 3,
        createdAt: daysAfterInstall(0.3),
      }),
      makeRecurring({
        id: 'rec-gym',
        name: 'Gym',
        categoryId: 'cat-gym',
        amounts: [{ from: '2026-08', amount: 2990 }],
        endMonth: '2026-09',
        dueDay: null,
        order: 4,
        createdAt: daysAfterInstall(0.4),
      }),
      makeRecurring({
        id: 'rec-salary',
        kind: 'income',
        name: 'Working student job',
        amounts: [
          { from: '2026-08', amount: 120000 },
          { from: '2026-10', amount: 125000 },
        ],
        dueDay: 28,
        order: 5,
        createdAt: daysAfterInstall(0.5),
      }),
    ],
    transactions: [
      makeTransaction({
        id: 'tx-before',
        amount: 4200,
        categoryId: DEFAULT_CATEGORY_IDS.other,
        date: '2026-08-01',
        note: BEFORE_APP_NOTE,
        createdAt: daysAfterInstall(0.6),
        updatedAt: daysAfterInstall(0.6),
      }),
      makeTransaction({
        id: 'tx-mensa',
        amount: 450,
        categoryId: DEFAULT_CATEGORY_IDS.eating,
        date: '2026-08-04',
        note: 'Mensa',
        createdAt: daysAfterInstall(1),
        updatedAt: daysAfterInstall(1),
      }),
      // Shared with a flatmate, split evenly (the odd cent stays with Alex), and paid back.
      makeTransaction({
        id: 'tx-groceries',
        amount: 3287,
        categoryId: DEFAULT_CATEGORY_IDS.groceries,
        date: '2026-09-12',
        note: 'Weekly shop, "big" one',
        splits: [
          makeSplit({ id: 'split-mia', person: 'Mia', amount: 1643, status: 'paid', settledAt: daysAfterInstall(42) }),
        ],
        createdAt: daysAfterInstall(40),
        updatedAt: daysAfterInstall(42),
      }),
      // Shoes bought with money from the wallet, outside the month's budget.
      makeTransaction({
        id: 'tx-sale',
        amount: 5999,
        categoryId: DEFAULT_CATEGORY_IDS.shopping,
        date: '2026-10-02',
        note: '-20% sale, shoes',
        fromWallet: true,
        createdAt: daysAfterInstall(60),
        updatedAt: daysAfterInstall(60),
      }),
      // A textbook bought for three: Jonas still owes his part, Lena's was forgiven. My share 16,00.
      makeTransaction({
        id: 'tx-book',
        amount: 2400,
        categoryId: 'cat-books',
        date: '2026-10-10',
        note: 'Analysis 1 📘',
        splits: [
          makeSplit({ id: 'split-jonas', person: 'Jonas', amount: 800 }),
          makeSplit({ id: 'split-lena', person: 'Lena', amount: 800, status: 'forgiven', settledAt: daysAfterInstall(70) }),
        ],
        createdAt: daysAfterInstall(68),
        updatedAt: daysAfterInstall(70),
      }),
      makeTransaction({
        id: 'tx-uncategorized',
        amount: 990,
        categoryId: UNCATEGORIZED_ID,
        date: '2026-10-11',
        createdAt: daysAfterInstall(69),
        updatedAt: daysAfterInstall(69),
      }),
      makeTransaction({
        id: 'tx-orphan',
        amount: 1500,
        categoryId: 'cat-deleted',
        date: '2026-10-12',
        note: '=SUM(A1:A2)',
        createdAt: daysAfterInstall(70),
        updatedAt: daysAfterInstall(70),
      }),
      makeTransaction({
        id: 'tx-gift',
        kind: 'income',
        amount: 5000,
        date: '2026-10-13',
        note: 'Grandma',
        createdAt: daysAfterInstall(71),
        updatedAt: daysAfterInstall(71),
      }),
      makeTransaction({ id: 'tx-coffee', note: 'Coffee', createdAt: NOW - 3_600_000, updatedAt: NOW - 3_600_000 }),
    ],
    quickAdds: [
      ...base.quickAdds,
      makeQuickAdd({ id: 'qa-doener', label: 'Döner', icon: '🥙', amount: 650, categoryId: DEFAULT_CATEGORY_IDS.eating, order: 3 }),
    ],
    months: {
      '2026-09': { savingsGoal: 0 },
      '2026-10': { overrides: { 'rec-rent': { paid: true }, 'rec-netflix': { amount: 1599, paid: true } } },
      '2026-11': { overrides: { 'rec-rundfunk': { skipped: true } }, savingsGoal: 30000 },
    },
    wallet: {
      opening: 50000,
      startMonth: null,
      entries: [
        {
          id: 'wal-savings',
          kind: 'withdrawal',
          amount: 20000,
          date: '2026-10-05',
          note: 'Moved to my savings account',
          createdAt: daysAfterInstall(63),
        },
        {
          id: 'wal-gift',
          kind: 'deposit',
          amount: 5000,
          date: '2026-09-12',
          note: '',
          createdAt: daysAfterInstall(40),
        },
      ],
      // The targets of the §4.9 waterfall test, filled in this order, and one goal already done.
      goals: [
        makeGoal({ id: 'goal-laptop', createdAt: daysAfterInstall(10) }),
        makeGoal({ id: 'goal-trip', name: 'Trip home', icon: 'airplane', target: 30000, order: 1, createdAt: daysAfterInstall(21) }),
        makeGoal({
          id: 'goal-bike',
          name: 'Bike repair',
          icon: '🚲',
          target: 8000,
          order: 2,
          createdAt: daysAfterInstall(2),
          doneAt: daysAfterInstall(30),
        }),
      ],
    },
  }
}

/** A JSON round trip: a plain copy with no shared references, as storage or a file returns it. */
export function toRaw(data: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown>
}

// ---------------------------------------------------------------------------------------------
// Invariants

const APP_DATA_KEYS = ['schemaVersion', 'settings', 'categories', 'recurring', 'transactions', 'quickAdds', 'months', 'wallet']
const WALLET_KEYS = ['opening', 'startMonth', 'entries', 'goals']
const WALLET_ENTRY_KEYS = ['id', 'kind', 'amount', 'date', 'note', 'createdAt']
const GOAL_KEYS = ['id', 'name', 'icon', 'target', 'order', 'createdAt', 'doneAt']
const SETTINGS_KEYS = [
  'name',
  'avatar',
  'currency',
  'locale',
  'monthStartDay',
  'savingsGoal',
  'theme',
  'accent',
  'showCents',
  'hideAmounts',
  'homeCards',
  'onboarded',
  'lastBackupAt',
  'lastReviewedMonth',
  'createdAt',
]
const CATEGORY_KEYS = ['id', 'name', 'icon', 'color', 'kind', 'budget', 'order', 'archived']
const RECURRING_KEYS = [
  'id',
  'kind',
  'name',
  'categoryId',
  'amounts',
  'everyMonths',
  'spread',
  'startMonth',
  'endMonth',
  'dueDay',
  'note',
  'order',
  'createdAt',
]
const TRANSACTION_KEYS = [
  'id',
  'kind',
  'amount',
  'categoryId',
  'date',
  'note',
  'fromWallet',
  'splits',
  'createdAt',
  'updatedAt',
]
const SPLIT_KEYS = ['id', 'person', 'amount', 'status', 'settledAt']
const QUICK_ADD_KEYS = ['id', 'label', 'icon', 'amount', 'categoryId', 'order']
const MONTH_KEYS = ['overrides', 'savingsGoal']
const OVERRIDE_KEYS = ['amount', 'skipped', 'paid']

const RESERVED_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype))
const LAST_TIMESTAMP = Date.UTC(2999, 11, 31, 23, 59, 59, 999)

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function isAmount(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_CENTS
}

function isSavings(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_CENTS
}

function isTimestamp(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= LAST_TIMESTAMP
}

function isId(value: unknown): boolean {
  return typeof value === 'string' && ID_PATTERN.test(value) && !RESERVED_NAMES.has(value)
}

function isCategoryRef(value: unknown): boolean {
  return value === UNCATEGORIZED_ID || isId(value)
}

/**
 * Trimmed text of at most `max` graphemes. Only text longer than `max` UTF-16 units is segmented:
 * a string never has more graphemes than units, and segmenting every text made the fuzz tests slow.
 */
function isCleanText(value: unknown, max: number): boolean {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    (value.length <= max || splitGraphemes(value).length <= max)
  )
}

/** Trimmed text of 1..`max` graphemes: a name that cannot be empty (split people, goals). */
function isName(value: unknown, max: number): boolean {
  return isCleanText(value, max) && value !== ''
}

const SPLIT_STATUSES: readonly unknown[] = ['open', 'paid', 'forgiven']

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Every rule normalizeAppData guarantees for its output (§4.4, §4.7, §4.8, §4.9, §5.4), as a list
 * of violations: an empty list means `data` is valid. Exact key sets prove that output objects are
 * built field by field, and plain prototypes that nothing hostile was passed through.
 */
export function appDataProblems(data: AppData): string[] {
  const problems: string[] = []
  const check = (ok: boolean, path: string, value?: unknown): void => {
    if (!ok) problems.push(`${path}: ${JSON.stringify(value) ?? String(value)}`)
  }
  const keys = (value: unknown, expected: readonly string[], path: string): boolean => {
    const ok =
      isPlainRecord(value) && JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify(expected.toSorted())
    check(ok, `${path} keys`, isPlainRecord(value) ? Object.keys(value) : value)
    return ok
  }
  const uniqueIds = (rows: readonly { id: string }[], path: string): void => {
    const ids = rows.map(({ id }) => id)
    check(new Set(ids).size === ids.length, `${path} ids are unique`, ids)
  }

  if (!keys(data, APP_DATA_KEYS, 'data')) return problems
  check(data.schemaVersion === CURRENT_SCHEMA_VERSION, 'schemaVersion', data.schemaVersion)

  const s = data.settings
  if (keys(s, SETTINGS_KEYS, 'settings')) {
    check(isCleanText(s.name, MAX_LENGTHS.name), 'settings.name', s.name)
    check(s.avatar === '' || isEmoji(s.avatar), 'settings.avatar', s.avatar)
    check(/^[A-Z]{3}$/.test(s.currency), 'settings.currency', s.currency)
    // An offered format as listed (even where the engine lacks its data), or a canonical one Intl supports.
    check(
      NUMBER_LOCALES.some(({ locale }) => locale === s.locale) ||
        Intl.NumberFormat.supportedLocalesOf([s.locale])[0] === s.locale,
      'settings.locale',
      s.locale,
    )
    check(
      Number.isInteger(s.monthStartDay) && s.monthStartDay >= 1 && s.monthStartDay <= MAX_MONTH_START_DAY,
      'settings.monthStartDay',
      s.monthStartDay,
    )
    check(isSavings(s.savingsGoal), 'settings.savingsGoal', s.savingsGoal)
    check(['system', 'light', 'dark'].includes(s.theme), 'settings.theme', s.theme)
    check(ACCENTS.some(({ key }) => key === s.accent), 'settings.accent', s.accent)
    check(typeof s.showCents === 'boolean', 'settings.showCents', s.showCents)
    check(typeof s.hideAmounts === 'boolean', 'settings.hideAmounts', s.hideAmounts)
    check(
      Array.isArray(s.homeCards) &&
        new Set(s.homeCards).size === s.homeCards.length &&
        s.homeCards.every((card) => HOME_CARDS.some(({ key }) => key === card)),
      'settings.homeCards',
      s.homeCards,
    )
    check(typeof s.onboarded === 'boolean', 'settings.onboarded', s.onboarded)
    check(s.lastBackupAt === null || isTimestamp(s.lastBackupAt), 'settings.lastBackupAt', s.lastBackupAt)
    check(
      s.lastReviewedMonth === null || isValidMonthKey(s.lastReviewedMonth),
      'settings.lastReviewedMonth',
      s.lastReviewedMonth,
    )
    check(isTimestamp(s.createdAt), 'settings.createdAt', s.createdAt)
  }

  data.categories.forEach((c, i) => {
    const path = `categories[${i}]`
    if (!keys(c, CATEGORY_KEYS, path)) return
    check(isId(c.id), `${path}.id`, c.id)
    check(isCleanText(c.name, MAX_LENGTHS.category), `${path}.name`, c.name)
    check(isIconRef(c.icon), `${path}.icon`, c.icon)
    check(CATEGORY_COLORS.some(({ key }) => key === c.color), `${path}.color`, c.color)
    check(['fixed', 'daily', 'both'].includes(c.kind), `${path}.kind`, c.kind)
    check(c.budget === null || isAmount(c.budget), `${path}.budget`, c.budget)
    check(isFiniteNumber(c.order), `${path}.order`, c.order)
    check(typeof c.archived === 'boolean', `${path}.archived`, c.archived)
  })
  uniqueIds(data.categories, 'categories')

  data.recurring.forEach((r, i) => {
    const path = `recurring[${i}]`
    if (!keys(r, RECURRING_KEYS, path)) return
    check(isId(r.id), `${path}.id`, r.id)
    check(r.kind === 'expense' || r.kind === 'income', `${path}.kind`, r.kind)
    check(isCleanText(r.name, MAX_LENGTHS.recurring), `${path}.name`, r.name)
    check(r.kind === 'income' ? r.categoryId === null : isCategoryRef(r.categoryId), `${path}.categoryId`, r.categoryId)
    check(isValidMonthKey(r.startMonth), `${path}.startMonth`, r.startMonth)
    check(
      r.endMonth === null || (isValidMonthKey(r.endMonth) && compareISO(r.endMonth, r.startMonth) >= 0),
      `${path}.endMonth`,
      r.endMonth,
    )
    check([1, 2, 3, 6, 12].includes(r.everyMonths), `${path}.everyMonths`, r.everyMonths)
    check(typeof r.spread === 'boolean' && (!r.spread || r.everyMonths > 1), `${path}.spread`, r.spread)
    check(r.dueDay === null || (Number.isInteger(r.dueDay) && r.dueDay >= 1 && r.dueDay <= 31), `${path}.dueDay`, r.dueDay)
    check(isCleanText(r.note, MAX_LENGTHS.note), `${path}.note`, r.note)
    check(isFiniteNumber(r.order), `${path}.order`, r.order)
    check(isTimestamp(r.createdAt), `${path}.createdAt`, r.createdAt)
    const amounts: readonly unknown[] = Array.isArray(r.amounts) ? r.amounts : []
    check(amounts.length > 0 && r.amounts[0]?.from === r.startMonth, `${path}.amounts start at startMonth`, r.amounts)
    amounts.forEach((entry, j) => {
      if (!keys(entry, ['from', 'amount'], `${path}.amounts[${j}]`)) return
      const { from, amount } = entry as { from: string; amount: number }
      const previous = r.amounts[j - 1]
      check(isValidMonthKey(from) && isAmount(amount), `${path}.amounts[${j}]`, entry)
      check(r.endMonth === null || compareISO(from, r.endMonth) <= 0, `${path}.amounts[${j}] after endMonth`, entry)
      if (previous !== undefined) {
        check(compareISO(previous.from, from) < 0, `${path}.amounts[${j}] in order`, r.amounts)
        check(previous.amount !== amount, `${path}.amounts[${j}] merged`, r.amounts)
      }
    })
  })
  uniqueIds(data.recurring, 'recurring')

  data.transactions.forEach((t, i) => {
    const path = `transactions[${i}]`
    if (!keys(t, TRANSACTION_KEYS, path)) return
    check(isId(t.id), `${path}.id`, t.id)
    check(t.kind === 'expense' || t.kind === 'income', `${path}.kind`, t.kind)
    check(isAmount(t.amount), `${path}.amount`, t.amount)
    check(t.kind === 'income' ? t.categoryId === null : isCategoryRef(t.categoryId), `${path}.categoryId`, t.categoryId)
    check(isValidISODate(t.date), `${path}.date`, t.date)
    check(isCleanText(t.note, MAX_LENGTHS.note), `${path}.note`, t.note)
    // §3.13: only expenses are paid from the wallet. §4.9: only expenses have splits.
    check(typeof t.fromWallet === 'boolean' && (t.kind === 'expense' || !t.fromWallet), `${path}.fromWallet`, t.fromWallet)
    check(Array.isArray(t.splits) && (t.kind === 'expense' || t.splits.length === 0), `${path}.splits`, t.splits)
    const splits: readonly unknown[] = Array.isArray(t.splits) ? t.splits : []
    const splitIds: unknown[] = []
    let owed = 0
    splits.forEach((split, j) => {
      const splitPath = `${path}.splits[${j}]`
      if (!keys(split, SPLIT_KEYS, splitPath)) return
      const { id, person, amount, status, settledAt } = split as Record<string, unknown>
      check(isId(id), `${splitPath}.id`, id)
      check(isName(person, MAX_LENGTHS.name), `${splitPath}.person`, person)
      check(isAmount(amount), `${splitPath}.amount`, amount)
      check(SPLIT_STATUSES.includes(status), `${splitPath}.status`, status)
      // Open splits are not settled; paid and forgiven ones say when they were.
      check(status === 'open' ? settledAt === null : isTimestamp(settledAt), `${splitPath}.settledAt`, settledAt)
      splitIds.push(id)
      if (isAmount(amount)) owed += amount as number
    })
    check(new Set(splitIds).size === splitIds.length, `${path}.splits ids are unique`, splitIds)
    check(owed <= t.amount, `${path}.splits add up to at most the amount`, t.splits)
    check(isTimestamp(t.createdAt), `${path}.createdAt`, t.createdAt)
    check(isTimestamp(t.updatedAt), `${path}.updatedAt`, t.updatedAt)
  })
  uniqueIds(data.transactions, 'transactions')

  data.quickAdds.forEach((q, i) => {
    const path = `quickAdds[${i}]`
    if (!keys(q, QUICK_ADD_KEYS, path)) return
    check(isId(q.id), `${path}.id`, q.id)
    check(isCleanText(q.label, MAX_LENGTHS.quickAdd), `${path}.label`, q.label)
    check(isIconRef(q.icon), `${path}.icon`, q.icon)
    check(isAmount(q.amount), `${path}.amount`, q.amount)
    check(isCategoryRef(q.categoryId), `${path}.categoryId`, q.categoryId)
    check(isFiniteNumber(q.order), `${path}.order`, q.order)
  })
  uniqueIds(data.quickAdds, 'quickAdds')

  const recurringIds = new Set(data.recurring.map(({ id }) => id))
  if (!isPlainRecord(data.months)) {
    check(false, 'months', data.months)
    return problems
  }
  for (const [key, month] of Object.entries(data.months)) {
    const path = `months[${key}]`
    check(isValidMonthKey(key), `${path} key`, key)
    const monthKeys = isPlainRecord(month) ? Object.keys(month) : []
    check(
      isPlainRecord(month) && monthKeys.length > 0 && monthKeys.every((k) => MONTH_KEYS.includes(k)),
      `${path} keys`,
      monthKeys,
    )
    if (month.savingsGoal !== undefined) check(isSavings(month.savingsGoal), `${path}.savingsGoal`, month.savingsGoal)
    if (month.overrides === undefined) continue
    const overrideIds = isPlainRecord(month.overrides) ? Object.keys(month.overrides) : []
    check(overrideIds.length > 0, `${path}.overrides not empty`, month.overrides)
    for (const id of overrideIds) {
      const override: unknown = month.overrides[id]
      const fields = isPlainRecord(override) ? Object.keys(override) : []
      check(recurringIds.has(id), `${path}.overrides[${id}] has an item`, id)
      check(fields.length > 0 && fields.every((k) => OVERRIDE_KEYS.includes(k)), `${path}.overrides[${id}] keys`, fields)
      if (!isPlainRecord(override)) continue
      if (Object.hasOwn(override, 'amount')) check(isAmount(override.amount), `${path}.overrides[${id}].amount`, override.amount)
      if (Object.hasOwn(override, 'skipped')) check(override.skipped === true, `${path}.overrides[${id}].skipped`, override.skipped)
      if (Object.hasOwn(override, 'paid')) check(override.paid === true, `${path}.overrides[${id}].paid`, override.paid)
    }
  }

  const w = data.wallet
  if (keys(w, WALLET_KEYS, 'wallet')) {
    check(isSavings(w.opening), 'wallet.opening', w.opening)
    check(w.startMonth === null || isValidMonthKey(w.startMonth), 'wallet.startMonth', w.startMonth)
    check(Array.isArray(w.entries), 'wallet.entries', w.entries)
    if (Array.isArray(w.entries)) {
      w.entries.forEach((e, i) => {
        const path = `wallet.entries[${i}]`
        if (!keys(e, WALLET_ENTRY_KEYS, path)) return
        check(isId(e.id), `${path}.id`, e.id)
        check(e.kind === 'deposit' || e.kind === 'withdrawal', `${path}.kind`, e.kind)
        check(isAmount(e.amount), `${path}.amount`, e.amount)
        check(isValidISODate(e.date), `${path}.date`, e.date)
        check(isCleanText(e.note, MAX_LENGTHS.note), `${path}.note`, e.note)
        check(isTimestamp(e.createdAt), `${path}.createdAt`, e.createdAt)
      })
      uniqueIds(w.entries, 'wallet.entries')
    }
    check(Array.isArray(w.goals), 'wallet.goals', w.goals)
    if (Array.isArray(w.goals)) {
      w.goals.forEach((g, i) => {
        const path = `wallet.goals[${i}]`
        if (!keys(g, GOAL_KEYS, path)) return
        check(isId(g.id), `${path}.id`, g.id)
        check(isName(g.name, MAX_LENGTHS.name), `${path}.name`, g.name)
        check(isIconRef(g.icon), `${path}.icon`, g.icon)
        check(isAmount(g.target), `${path}.target`, g.target)
        check(isFiniteNumber(g.order), `${path}.order`, g.order)
        check(isTimestamp(g.createdAt), `${path}.createdAt`, g.createdAt)
        check(g.doneAt === null || isTimestamp(g.doneAt), `${path}.doneAt`, g.doneAt)
      })
      uniqueIds(w.goals, 'wallet.goals')
    }
  }
  return problems
}
