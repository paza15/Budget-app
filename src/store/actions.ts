import { ACCENTS, canonicalNumberLocale, CATEGORY_COLORS, EVERY_MONTHS_OPTIONS, HOME_CARDS } from '@/domain/catalog'
import { MAX_CENTS, MAX_LENGTHS, MAX_MONTH_START_DAY, MAX_QUICK_ADDS } from '@/domain/constants'
import { addMonths, compareISO, isValidISODate, isValidMonthKey, maxMonth } from '@/domain/dates'
import { ID_PATTERN, newId } from '@/domain/ids'
import { isRecord } from '@/domain/normalize'
import { periodOf, shiftForStartDayChange } from '@/domain/period'
import { categoryUsage, firstPeriod, isEmoji, isIconRef, nextFreeCategoryColor, splitGraphemes } from '@/domain/queries'
import { lineFor, normalizeRecurring, withAmountFrom } from '@/domain/recurring'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import type {
  AccentKey,
  AppData,
  Category,
  CategoryColor,
  CategoryKind,
  Cents,
  EveryMonths,
  HomeCardKey,
  IconRef,
  ISODate,
  MonthData,
  MonthKey,
  QuickAdd,
  Recurring,
  RecurringOverride,
  SavingsGoal,
  Settings,
  Split,
  SplitStatus,
  ThemeMode,
  Transaction,
  TxKind,
  Wallet,
  WalletEntry,
} from '@/domain/types'
import { getData, useAppStore } from '@/store/appStore'

/**
 * Every change to the user's data (docs/SPEC.md §5.4). Actions are synchronous and end in one
 * setState; branches they do not touch keep their identity, and an action that changes nothing
 * leaves the data object as it is (nothing is saved). Invalid input throws RangeError (never
 * clamped): amounts, dates, months, ids and option values must be valid as given. Text is trimmed
 * and cut to MAX_LENGTHS exactly as loading does, and required names (category, quick-add label,
 * recurring item, savings goal, a person in a split) must not be empty. Results always pass
 * normalizeAppData unchanged. Call actions only from event handlers.
 */

/**
 * One person's part of an expense: what they owe you (§3.16, §4.9). In addTransaction every split
 * is new. In updateTransaction the list replaces the expense's splits: a split given with the
 * `id` of one of them changes that split in place, and one given without an id that equals a
 * split the expense has (same person and amount, and the same status when one is given) is that
 * split, so passing the stored splits back keeps their ids and settled times. Other fields (such
 * as a stored split's settledAt) are ignored; the store sets settledAt from the status.
 */
export interface NewSplit {
  /** One of the expense's splits, to change it in place (updateTransaction only). */
  id?: string
  /** Trimmed and cut to MAX_LENGTHS.name (24); must not be empty. */
  person: string
  /** Integer 1..MAX_CENTS. All splits of an expense together never exceed its amount. */
  amount: Cents
  /** Default 'open' for a new split; a split given by id keeps its status. */
  status?: SplitStatus
}

export interface NewTransaction {
  kind: TxKind
  /** Integer 1..MAX_CENTS. */
  amount: Cents
  /** Required for expenses; ignored (stored as null) for income. */
  categoryId: string | null
  date: ISODate
  /** Trimmed and truncated to MAX_LENGTHS.note. */
  note?: string
  /** Paid from the wallet instead of the month's budget (§3.13). Default false; never true for income. */
  fromWallet?: boolean
  /** What other people owe you for this expense (§3.16). Default none; income has none. */
  splits?: NewSplit[]
}

export interface NewRecurring {
  kind: TxKind
  name: string
  /** Required for expenses; ignored (stored as null) for income. */
  categoryId: string | null
  amount: Cents
  /** Default 1. */
  everyMonths?: EveryMonths
  /** Default false. */
  spread?: boolean
  startMonth: MonthKey
  /** Default null (ongoing). */
  endMonth?: MonthKey | null
  /** Default null. */
  dueDay?: number | null
  /** Default ''. */
  note?: string
}

export type RecurringPatch = Partial<
  Pick<Recurring, 'name' | 'categoryId' | 'everyMonths' | 'spread' | 'startMonth' | 'endMonth' | 'dueDay' | 'note'>
>

/** amount null removes the amount; skipped or paid false removes that flag; skipped true clears paid. */
export interface OverridePatch {
  amount?: Cents | null
  skipped?: boolean
  paid?: boolean
}

export type NewCategory = Pick<Category, 'name' | 'icon' | 'kind'> & { color?: CategoryColor; budget?: Cents | null }

/**
 * Settings changed through dedicated actions (or never by the user) are not patchable here:
 * monthStartDay, savingsGoal, lastBackupAt (markBackupDone), lastReviewedMonth (markReviewed) and
 * createdAt.
 */
export type SettingsPatch = Partial<
  Omit<Settings, 'monthStartDay' | 'savingsGoal' | 'lastBackupAt' | 'lastReviewedMonth' | 'createdAt'>
>

/** A new savings goal (§3.14). */
export interface NewGoal {
  /** Trimmed and cut to MAX_LENGTHS.name (24); must not be empty. */
  name: string
  icon: IconRef
  /** Integer 1..MAX_CENTS. */
  target: Cents
}

export type GoalPatch = Partial<NewGoal>

/** Money moved into (deposit) or out of (withdrawal) the wallet by hand (§3.12, §4.8). */
export interface NewWalletEntry {
  kind: 'deposit' | 'withdrawal'
  /** Integer 1..MAX_CENTS. */
  amount: Cents
  /** A valid date. The wallet counts an entry from its date on; the UI offers dates up to today. */
  date: ISODate
  /** Trimmed and truncated to MAX_LENGTHS.note. Default ''. */
  note?: string
}

export type WalletEntryPatch = Partial<Required<NewWalletEntry>>

export interface Actions {
  updateSettings(patch: SettingsPatch): void
  /**
   * Changes the first day of each period and remaps period keys (§4.3, remapStartDay): due dates
   * stay put, and keys without a due date (the reviewed period among them) stay with most of their
   * days.
   */
  setMonthStartDay(day: number): void
  /** Changes the default savings goal; past periods keep the goal they had (§5.4). */
  setSavingsGoal(amount: Cents, today: ISODate): void
  /** Savings goal for one period only; null returns it to the default. */
  setMonthSavings(month: MonthKey, amount: Cents | null): void
  /** Adds a category at the end; the colour defaults to nextFreeCategoryColor. */
  addCategory(input: NewCategory): Category
  updateCategory(id: string, patch: Partial<Omit<Category, 'id' | 'order'>>): void
  setCategoryArchived(id: string, archived: boolean): void
  /** Listed ids first, unlisted ids after them in their old order; order rewritten 0..n-1. */
  reorderCategories(orderedIds: string[]): void
  /**
   * Deletes a category, moving its transactions, recurring items and quick adds to `moveTo`.
   * Throws when it is used and moveTo is null, when moveTo === id, or when moveTo is unknown.
   */
  deleteCategory(id: string, moveTo: string | null): void
  /**
   * Adds an expense or one-off income. An expense may be paid from the wallet and carry splits
   * whose amounts add up to at most its amount (§4.9); income can have neither (throws).
   */
  addTransaction(input: NewTransaction): Transaction
  /**
   * The kind never changes (§3.4); updatedAt is set to now. `splits` replaces the expense's splits
   * (see NewSplit). The splits must still fit the amount afterwards, also when only the amount
   * changes. Income stays without wallet payment and splits: `fromWallet: true` or any split
   * throws, while `false` and `[]` change nothing.
   */
  updateTransaction(id: string, patch: Partial<Omit<NewTransaction, 'kind'>>): void
  deleteTransaction(id: string): void
  /**
   * Marks one split as paid back or forgiven (settledAt = now, the transaction's updatedAt too) or
   * open again (settledAt = null). The same status changes nothing (§3.16).
   */
  setSplitStatus(transactionId: string, splitId: string, status: SplitStatus): void
  addRecurring(input: NewRecurring): Recurring
  /** Applies the patch, then normalizeRecurring. */
  updateRecurring(id: string, patch: RecurringPatch): void
  /**
   * New amount from period `from` on ('all': every period, including the past), via withAmountFrom.
   * Also clears this item's amount override in `from` ('all': in its startMonth).
   */
  setRecurringAmount(id: string, amount: Cents, from: MonthKey | 'all'): void
  /** Removes the item and all its overrides. */
  deleteRecurring(id: string): void
  /**
   * Changes one period's adjustment of a recurring item; null removes it. Throws when the item has
   * no line in that period, and for spread items outside charge periods.
   */
  setOverride(month: MonthKey, recurringId: string, patch: OverridePatch | null): void
  /**
   * Adds a quick add button at the end. Throws a RangeError, before reading the input, when there
   * are already MAX_QUICK_ADDS (§3.7); data that came with more keeps them, but takes no more.
   */
  addQuickAdd(input: Omit<QuickAdd, 'id' | 'order'>): QuickAdd
  updateQuickAdd(id: string, patch: Partial<Omit<QuickAdd, 'id' | 'order'>>): void
  deleteQuickAdd(id: string): void
  reorderQuickAdds(orderedIds: string[]): void
  /** Records a successful backup export (settings.lastBackupAt = now). */
  markBackupDone(): void
  /**
   * Adds an active savings goal at the end of the fill order (§3.14): its order follows every
   * goal's, done ones included.
   */
  addGoal(input: NewGoal): SavingsGoal
  updateGoal(id: string, patch: GoalPatch): void
  /**
   * The fill order, top first: listed ids first, unlisted ids (done goals, say) after them in their
   * old order; order rewritten 0..n-1.
   */
  reorderGoals(orderedIds: string[]): void
  /**
   * done: doneAt = now, and the goal leaves the fill order. Not done ("Put back"): doneAt = null,
   * and the goal fills again from the place its `order` gives it (§5.4), so a goal marked done by
   * mistake and put back holds what it held before. Only doneAt changes: the order moves only
   * through reorderGoals, which puts done goals after the listed ones. A goal already in that
   * state stays as it is.
   */
  setGoalDone(id: string, done: boolean): void
  deleteGoal(id: string): void
  /**
   * Records that the review of `month` was opened or its banner dismissed (§3.15):
   * settings.lastReviewedMonth becomes `month` unless it already names that period or a later
   * one, so reviewing an older period again never brings a banner back.
   */
  markReviewed(month: MonthKey): void
  /** The money already saved when the wallet started, 0..MAX_CENTS (§3.12). */
  setWalletOpening(amount: Cents): void
  /** The first period whose result flows into the wallet; null for the period the app was set up in. */
  setWalletStart(month: MonthKey | null): void
  addWalletEntry(input: NewWalletEntry): WalletEntry
  updateWalletEntry(id: string, patch: WalletEntryPatch): void
  deleteWalletEntry(id: string): void
  /** Puts back a previous AppData value (undo): the very object getData() returned before. */
  restore(previous: AppData): void
}

/** setSavingsGoal writes the old goal into at most this many past periods (§5.4). */
const MAX_FROZEN_PERIODS = 60

// ---------------------------------------------------------------------------------------------
// Validation

const THEMES: readonly ThemeMode[] = ['system', 'light', 'dark']
const ACCENT_KEYS: readonly AccentKey[] = ACCENTS.map(({ key }) => key)
const CATEGORY_COLOR_KEYS: readonly CategoryColor[] = CATEGORY_COLORS.map(({ key }) => key)
const CATEGORY_KINDS: readonly CategoryKind[] = ['fixed', 'daily', 'both']
const HOME_CARD_KEYS: readonly HomeCardKey[] = HOME_CARDS.map(({ key }) => key)
const EVERY_MONTHS: readonly EveryMonths[] = EVERY_MONTHS_OPTIONS.map(({ value }) => value)
const TX_KINDS: readonly TxKind[] = ['expense', 'income']
const SPLIT_STATUSES: readonly SplitStatus[] = ['open', 'paid', 'forgiven']
const WALLET_ENTRY_KINDS: readonly WalletEntry['kind'][] = ['deposit', 'withdrawal']

/** Object.prototype's members are never ids, as in normalize.ts. */
const RESERVED_IDS: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype))

const CURRENCY_CODE = /^[A-Z]{3}$/

const NO_OVERRIDES: Readonly<Record<string, RecurringOverride>> = Object.freeze({})

function invalid(message: string): never {
  throw new RangeError(message)
}

function isWholeNumberIn(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
}

/** An amount field: a whole number of cents 1..MAX_CENTS (§4.1). */
function amountOf(value: unknown, what = 'Amount'): Cents {
  if (!isWholeNumberIn(value, 1, MAX_CENTS)) invalid(`${what} must be whole cents from 1 to ${MAX_CENTS}: ${String(value)}`)
  return value
}

/** A savings goal: a whole number of cents 0..MAX_CENTS. */
function savingsOf(value: unknown): Cents {
  if (!isWholeNumberIn(value, 0, MAX_CENTS)) invalid(`A savings goal must be whole cents from 0 to ${MAX_CENTS}: ${String(value)}`)
  return value
}

/** The wallet's opening balance: a whole number of cents 0..MAX_CENTS (§4.8). */
function openingOf(value: unknown): Cents {
  if (!isWholeNumberIn(value, 0, MAX_CENTS)) {
    invalid(`An opening balance must be whole cents from 0 to ${MAX_CENTS}: ${String(value)}`)
  }
  return value
}

function dateOf(value: unknown): ISODate {
  if (!isValidISODate(value)) invalid(`Not a date: ${String(value)}`)
  return value
}

function monthOf(value: unknown, what = 'Month'): MonthKey {
  if (!isValidMonthKey(value)) invalid(`${what} is not a month: ${String(value)}`)
  return value
}

function booleanOf(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') invalid(`${what} must be true or false: ${String(value)}`)
  return value
}

function memberOf<T>(value: unknown, members: readonly T[], what: string): T {
  if (!(members as readonly unknown[]).includes(value)) invalid(`Not a valid ${what}: ${String(value)}`)
  return value as T
}

/**
 * Trims `value` and limits it to `maxLength` characters (graphemes), exactly as normalizeAppData
 * does when loading, so text never changes on the next load: whole emoji are kept or cut, and
 * the end is trimmed again after a cut.
 */
function cleanText(value: string, maxLength: number): string {
  const trimmed = value.trim()
  // A string never has more graphemes than UTF-16 code units.
  if (trimmed.length <= maxLength) return trimmed
  const graphemes = splitGraphemes(trimmed)
  if (graphemes.length <= maxLength) return trimmed
  return graphemes.slice(0, maxLength).join('').trimEnd()
}

function textOf(value: unknown, maxLength: number, what: string, required = false): string {
  if (typeof value !== 'string') invalid(`${what} must be text.`)
  const text = cleanText(value, maxLength)
  if (required && text === '') invalid(`${what} can't be empty.`)
  return text
}

/** A category reference: a valid id (§4.7), of a category that may no longer exist, or UNCATEGORIZED_ID. */
function categoryRefOf(value: unknown): string {
  const valid =
    value === UNCATEGORIZED_ID || (typeof value === 'string' && ID_PATTERN.test(value) && !RESERVED_IDS.has(value))
  if (!valid) invalid(`Not a category id: ${String(value)}`)
  return value
}

/** Expenses (transactions and fixed costs) need a category. */
function expenseCategoryOf(value: unknown): string {
  if (value === null || value === undefined) invalid('An expense needs a category.')
  return categoryRefOf(value)
}

/** A Phosphor key from CATEGORY_ICONS or a single emoji. */
function iconOf(value: unknown): IconRef {
  if (!isIconRef(value)) invalid(`Not an icon or a single emoji: ${String(value)}`)
  return value
}

/** A category limit: null (none) or an amount. 0 is not "no limit"; pass null. */
function budgetOf(value: unknown): Cents | null {
  return value === null ? null : amountOf(value, 'A monthly limit')
}

function dueDayOf(value: unknown): number | null {
  if (value !== null && !isWholeNumberIn(value, 1, 31)) invalid(`A due day must be 1 to 31: ${String(value)}`)
  return value
}

/** '' (the monogram) or a single emoji, trimmed. */
function avatarOf(value: unknown): string {
  if (typeof value !== 'string') invalid('The avatar must be text.')
  const avatar = value.trim()
  if (avatar !== '' && !isEmoji(avatar)) invalid(`The avatar must be one emoji, or empty for the initial: ${avatar}`)
  return avatar
}

/** An upper-case ISO 4217 code that Intl can format. */
function currencyOf(value: unknown): string {
  if (typeof value === 'string' && CURRENCY_CODE.test(value)) {
    try {
      const format = new Intl.NumberFormat('en', { style: 'currency', currency: value })
      if (format.resolvedOptions().currency === value) return value
    } catch {
      // Not a currency Intl knows.
    }
  }
  invalid(`Not a currency code: ${String(value)}`)
}

/**
 * A number format as loading keeps it (§4.7, canonicalNumberLocale), given in that form: a
 * NUMBER_LOCALES tag as listed, even where the engine has no data for it (Chromium lacks sq-AL),
 * or a tag Intl supports in canonical form ('de-DE', not 'de-de').
 */
function localeOf(value: unknown): string {
  const locale = canonicalNumberLocale(value)
  if (locale === null || locale !== value) invalid(`Not a supported number format: ${String(value)}`)
  return locale
}

/** Valid Home card keys, each at most once, in the given order. */
function homeCardsOf(value: unknown): HomeCardKey[] {
  if (!Array.isArray(value)) invalid('Home cards must be a list.')
  const cards: HomeCardKey[] = []
  for (const card of value as readonly unknown[]) {
    const key = memberOf(card, HOME_CARD_KEYS, 'Home card')
    if (cards.includes(key)) invalid(`A Home card is listed twice: ${key}`)
    cards.push(key)
  }
  return cards
}

/** Validators of patchable fields: each returns the value to store or throws. */
type Checks<T> = { readonly [K in keyof T]-?: (value: unknown) => Exclude<T[K], undefined> }

const SETTINGS_CHECKS: Checks<SettingsPatch> = {
  name: (value) => textOf(value, MAX_LENGTHS.name, 'The name'),
  avatar: avatarOf,
  currency: currencyOf,
  locale: localeOf,
  theme: (value) => memberOf(value, THEMES, 'theme'),
  accent: (value) => memberOf(value, ACCENT_KEYS, 'accent'),
  showCents: (value) => booleanOf(value, 'showCents'),
  hideAmounts: (value) => booleanOf(value, 'hideAmounts'),
  homeCards: homeCardsOf,
  onboarded: (value) => booleanOf(value, 'onboarded'),
}

const CATEGORY_CHECKS: Checks<Omit<Category, 'id' | 'order'>> = {
  name: (value) => textOf(value, MAX_LENGTHS.category, 'A category name', true),
  icon: iconOf,
  color: (value) => memberOf(value, CATEGORY_COLOR_KEYS, 'colour'),
  kind: (value) => memberOf(value, CATEGORY_KINDS, 'category kind'),
  budget: budgetOf,
  archived: (value) => booleanOf(value, 'archived'),
}

const QUICK_ADD_CHECKS: Checks<Omit<QuickAdd, 'id' | 'order'>> = {
  label: (value) => textOf(value, MAX_LENGTHS.quickAdd, 'A quick add label', true),
  icon: iconOf,
  amount: (value) => amountOf(value),
  categoryId: categoryRefOf,
}

const GOAL_CHECKS: Checks<NewGoal> = {
  name: (value) => textOf(value, MAX_LENGTHS.name, 'A goal name', true),
  icon: iconOf,
  target: (value) => amountOf(value, 'A target'),
}

const WALLET_ENTRY_CHECKS: Checks<Required<NewWalletEntry>> = {
  kind: (value) => memberOf(value, WALLET_ENTRY_KINDS, 'wallet entry kind'),
  amount: (value) => amountOf(value),
  date: dateOf,
  note: (value) => textOf(value, MAX_LENGTHS.note, 'A note'),
}

/**
 * The validated fields of `patch`. Fields set to undefined count as not given. Throws a
 * RangeError for an invalid value and for a field `checks` does not know (such as monthStartDay,
 * which has an action of its own).
 */
function validPatch<T extends object>(patch: object, checks: Checks<T>, what: string): Partial<T> {
  const changes: Partial<T> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (!Object.hasOwn(checks, key)) invalid(`Not a ${what} field: ${key}`)
    Object.assign(changes, { [key]: checks[key as keyof T](value) })
  }
  return changes
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item: unknown, i) => Object.is(item, b[i]))
  }
  return Object.is(a, b)
}

/** `record` with `changes` applied, or `record` itself when no value differs. */
function withChanges<T extends object>(record: T, changes: NoInfer<Partial<T>>): T {
  const keys = Object.keys(changes) as (keyof T)[]
  return keys.some((key) => !sameValue(record[key], changes[key])) ? { ...record, ...changes } : record
}

// ---------------------------------------------------------------------------------------------
// Records and lists

/** Replaces the data in one setState, unless nothing changed. */
function commit(next: AppData): void {
  if (next !== getData()) useAppStore.setState({ data: next })
}

/** The record with `id` and its index; throws a RangeError when there is none. */
function locate<T extends { id: string }>(list: readonly T[], id: string, what: string): { index: number; item: T } {
  const index = list.findIndex((item) => item.id === id)
  const item = list[index]
  if (item === undefined) invalid(`No ${what} has the id ${String(id)}.`)
  return { index, item }
}

/** One more than the highest `order`, so a new record goes last (0 in an empty list). */
function nextOrder(list: readonly { order: number }[]): number {
  return list.reduce((next, { order }) => Math.max(next, Math.floor(order) + 1), 0)
}

/**
 * Listed ids first, in the given order, then the others in their old order; `order` rewritten
 * 0..n-1. Records whose order stays keep their identity, and the list itself does when nothing
 * moves. Throws for an unknown or repeated id.
 */
function reorder<T extends { id: string; order: number }>(items: T[], orderedIds: readonly string[], what: string): T[] {
  if (!Array.isArray(orderedIds)) invalid('The new order must be a list of ids.')
  const byId = new Map(items.map((item) => [item.id, item]))
  const listed = new Set<string>()
  const first: T[] = []
  for (const id of orderedIds) {
    const item = byId.get(id)
    if (item === undefined) invalid(`No ${what} has the id ${String(id)}.`)
    if (listed.has(id)) invalid(`${id} is listed twice.`)
    listed.add(id)
    first.push(item)
  }
  // toSorted is stable: records with equal orders keep their place.
  const rest = items.filter((item) => !listed.has(item.id)).toSorted((a, b) => a.order - b.order)
  const result = [...first, ...rest].map((item, order) => (item.order === order ? item : { ...item, order }))
  return result.every((item, i) => item === items[i]) ? items : result
}

function sameAmounts(a: Recurring['amounts'], b: Recurring['amounts']): boolean {
  return a.length === b.length && a.every((entry, i) => entry.from === b[i]?.from && entry.amount === b[i]?.amount)
}

/** Field-by-field equality of two recurring items. */
function sameRecurring(a: Recurring, b: Recurring): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.name === b.name &&
    a.categoryId === b.categoryId &&
    a.everyMonths === b.everyMonths &&
    a.spread === b.spread &&
    a.startMonth === b.startMonth &&
    a.endMonth === b.endMonth &&
    a.dueDay === b.dueDay &&
    a.note === b.note &&
    a.order === b.order &&
    a.createdAt === b.createdAt &&
    sameAmounts(a.amounts, b.amounts)
  )
}

function isSpread(r: Recurring): boolean {
  return r.spread && r.everyMonths > 1
}

// ---------------------------------------------------------------------------------------------
// Splits (§3.16, §4.9) and the wallet (§3.12 to §3.14)

const NO_SPLITS: readonly Split[] = Object.freeze([])

/** A split as given, validated: the expense's split it changes (or undefined for a new one) and its fields. */
interface SplitInput {
  existing: Split | undefined
  person: string
  amount: Cents
  status: SplitStatus | undefined
}

/** When a split with `status` was settled: null while open, kept while the status stays, else `now`. */
function settledAtFor(split: Split | undefined, status: SplitStatus, now: number): number | null {
  if (status === 'open') return null
  return split !== undefined && split.status === status ? split.settledAt : now
}

/**
 * The splits of an expense from `value`, given the splits it has (`stored`; none for a new
 * expense). Every split is checked: a person of 1..24 characters once trimmed and cut, an amount
 * 1..MAX_CENTS and a known status; an `id` must name one of `stored`, at most once. A split given
 * by id keeps its id and, while its status stays, its settledAt. A split without an id is the first
 * unclaimed stored split with the same person and amount (and status, when given), returned as it
 * is, or else a new split, open unless a status is given. Settled splits get settledAt = `now`.
 * Stored splits that come back unchanged keep their identity. The total is checked by
 * checkSplitsFit.
 */
function splitsOf(value: unknown, stored: readonly Split[], now: number): Split[] {
  if (!Array.isArray(value)) invalid('Splits must be a list.')
  const byId = new Map(stored.map((split) => [split.id, split]))
  const claimed = new Set<Split>()
  const inputs = (value as readonly unknown[]).map((raw): SplitInput => {
    if (!isRecord(raw)) invalid('A split must be an object with a person and an amount.')
    let existing: Split | undefined
    if (raw.id !== undefined) {
      existing = typeof raw.id === 'string' ? byId.get(raw.id) : undefined
      if (existing === undefined) invalid(`This expense has no split with the id ${String(raw.id)}.`)
      if (claimed.has(existing)) invalid(`The split ${existing.id} is listed twice.`)
      claimed.add(existing)
    }
    return {
      existing,
      person: textOf(raw.person, MAX_LENGTHS.name, 'The name in a split', true),
      amount: amountOf(raw.amount, 'A split'),
      status: raw.status === undefined ? undefined : memberOf(raw.status, SPLIT_STATUSES, 'split status'),
    }
  })

  const unclaimed = stored.filter((split) => !claimed.has(split))
  return inputs.map(({ existing, person, amount, status }): Split => {
    if (existing !== undefined) {
      const next = status ?? existing.status
      return withChanges(existing, { person, amount, status: next, settledAt: settledAtFor(existing, next, now) })
    }
    const index = unclaimed.findIndex(
      (split) => split.person === person && split.amount === amount && (status === undefined || split.status === status),
    )
    const same = unclaimed[index]
    if (same !== undefined) {
      unclaimed.splice(index, 1)
      return same
    }
    const next = status ?? 'open'
    return { id: newId(), person, amount, status: next, settledAt: settledAtFor(undefined, next, now) }
  })
}

/** Throws unless what others owe for an expense fits its amount (§4.9: Σ splits ≤ amount). */
function checkSplitsFit(splits: readonly Split[], amount: Cents): void {
  let owed = 0
  for (const split of splits) owed += split.amount
  if (owed > amount) invalid(`Others can't owe more than the whole expense: ${owed} of ${amount}.`)
}

/** `data` with `changes` to the wallet; the wallet's other fields keep their identity. */
function withWallet(data: AppData, changes: Partial<Wallet>): AppData {
  return { ...data, wallet: { ...data.wallet, ...changes } }
}

// ---------------------------------------------------------------------------------------------
// Periods and overrides

/** A period's data, read with Object.hasOwn (§4.7). */
function monthAt(months: AppData['months'], key: MonthKey): MonthData | undefined {
  return Object.hasOwn(months, key) ? months[key] : undefined
}

function overrideAt(months: AppData['months'], key: MonthKey, id: string): RecurringOverride | undefined {
  const overrides = monthAt(months, key)?.overrides
  return overrides !== undefined && Object.hasOwn(overrides, id) ? overrides[id] : undefined
}

/** A copy of `record` without `key`. */
function without<V>(record: Readonly<Record<string, V>>, key: string): Record<string, V> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))
}

/** `months` with period `key` set to `monthData`; a period with neither overrides nor savingsGoal is removed. */
function withMonth(months: AppData['months'], key: MonthKey, monthData: MonthData): AppData['months'] {
  if (monthData.overrides === undefined && monthData.savingsGoal === undefined) {
    return Object.hasOwn(months, key) ? (without(months, key) as AppData['months']) : months
  }
  return { ...months, [key]: monthData }
}

/** An override in its stored form (§5.4): only amount, skipped: true and paid: true; undefined when empty. */
function storedOverride(amount: Cents | undefined, skipped: boolean, paid: boolean): RecurringOverride | undefined {
  const override: RecurringOverride = {}
  if (amount !== undefined) override.amount = amount
  if (skipped) override.skipped = true
  if (paid) override.paid = true
  return Object.keys(override).length > 0 ? override : undefined
}

function sameOverride(a: RecurringOverride | undefined, b: RecurringOverride | undefined): boolean {
  return a?.amount === b?.amount && a?.skipped === b?.skipped && a?.paid === b?.paid
}

/** `months` with the override of item `id` in period `key` set to `override`; undefined removes it. */
function withOverride(
  months: AppData['months'],
  key: MonthKey,
  id: string,
  override: RecurringOverride | undefined,
): AppData['months'] {
  const existing = monthAt(months, key)
  const others = without(existing?.overrides ?? NO_OVERRIDES, id)
  const overrides = override === undefined ? others : { ...others, [id]: override }
  const monthData: MonthData = {}
  if (Object.keys(overrides).length > 0) monthData.overrides = overrides
  if (existing?.savingsGoal !== undefined) monthData.savingsGoal = existing.savingsGoal
  return withMonth(months, key, monthData)
}

/** `months` without any override of item `id`; the same object when it had none. */
function withoutOverridesOf(months: AppData['months'], id: string): AppData['months'] {
  let next = months
  for (const key of Object.keys(months)) {
    if (!isValidMonthKey(key)) continue
    if (overrideAt(months, key, id) !== undefined) next = withOverride(next, key, id, undefined)
  }
  return next
}

// ---------------------------------------------------------------------------------------------
// Changing the start day (§4.3)

/**
 * How far the start day must move before a period key without a due date moves. Moving it by k
 * days leaves the old period's days split k to (length − k) between two new periods, so from 16
 * days on the neighbouring period holds most of them in every month length (28 to 31 days).
 */
const MOST_DAYS_MOVE = 16

/**
 * Months to add to a period key that has no due date (a period savings goal, the wallet's first
 * period, a recurring item without a due day) when the start day changes from `from` to `to`, so
 * the key names the new period holding most of the old period's days. That is the key itself
 * unless the start day moves by 16 days or more: then one month back when it moves later, one month
 * on when it moves earlier. (This is exact for periods of 30 and 31 days. When the start day moves
 * by exactly 15 days, a period of 28 or 29 days keeps its key although the neighbouring period
 * holds one or two more of its days.)
 *
 * The reference is the period's days, not its first day, so the rule is stable: small changes
 * leave keys alone, and changing back (a → b → a) puts every key back where it was. Throws a
 * RangeError unless both days are whole numbers 1..28.
 */
export function periodShiftForStartDayChange(from: number, to: number): -1 | 0 | 1 {
  for (const day of [from, to]) {
    if (!isWholeNumberIn(day, 1, MAX_MONTH_START_DAY)) invalid(`The month start day must be 1 to ${MAX_MONTH_START_DAY}: ${day}`)
  }
  if (to - from >= MOST_DAYS_MOVE) return -1
  if (from - to >= MOST_DAYS_MOVE) return 1
  return 0
}

/** addMonths for a remapped key, which must stay within the years the data format accepts. */
function shiftMonth(key: MonthKey, shift: number): MonthKey {
  if (shift === 0) return key
  const shifted = addMonths(key, shift)
  if (!isValidMonthKey(shifted)) invalid(`Changing the start day would move ${key} outside the supported years.`)
  return shifted
}

function shiftRecurring(r: Recurring, shift: number): Recurring {
  return {
    ...r,
    startMonth: shiftMonth(r.startMonth, shift),
    endMonth: r.endMonth === null ? null : shiftMonth(r.endMonth, shift),
    amounts: r.amounts.map(({ from, amount }) => ({ from: shiftMonth(from, shift), amount })),
  }
}

/**
 * Moves every override to its item's remapped period key and every period savings goal by
 * `savingsShift`. Keys of one item all move by the same amount, so nothing collides. Returns
 * `months` itself when no key moves.
 */
function remapMonths(
  months: AppData['months'],
  shifts: ReadonlyMap<string, number>,
  savingsShift: number,
): AppData['months'] {
  const result: Record<string, MonthData> = {}
  let moved = false
  const monthFor = (key: MonthKey, target: MonthKey): MonthData => {
    if (target !== key) moved = true
    const existing = result[target]
    if (existing !== undefined) return existing
    const created: MonthData = {}
    result[target] = created
    return created
  }
  for (const key of Object.keys(months)) {
    if (!isValidMonthKey(key)) continue
    const monthData = monthAt(months, key)
    if (monthData === undefined) continue
    if (monthData.savingsGoal !== undefined) monthFor(key, shiftMonth(key, savingsShift)).savingsGoal = monthData.savingsGoal
    const overrides = monthData.overrides ?? NO_OVERRIDES
    for (const id of Object.keys(overrides)) {
      const override = overrides[id]
      if (override === undefined) continue
      const target = monthFor(key, shiftMonth(key, shifts.get(id) ?? 0))
      target.overrides = { ...target.overrides, [id]: override }
    }
  }
  return moved ? (result as AppData['months']) : months
}

/**
 * `data` with settings.monthStartDay = `day` and its period keys remapped (§4.3). A recurring item
 * with a due day keeps every due date: its startMonth, endMonth, amounts[].from and override keys
 * move by shiftForStartDayChange(dueDay, old, day). Keys without a date stay with most of their
 * days, by periodShiftForStartDayChange(old, day): those of items without a due day, period
 * savings goals, wallet.startMonth and settings.lastReviewedMonth (so the month-end banner neither
 * skips the next period nor offers a reviewed one again, §3.15). Transactions keep their dates.
 * Changing back restores the data exactly. Returns `data` itself for the current day. Throws a
 * RangeError for an invalid day and when a key would leave the years the data format accepts. The
 * pure core of setMonthStartDay.
 */
export function remapStartDay(data: AppData, day: number): AppData {
  if (!isWholeNumberIn(day, 1, MAX_MONTH_START_DAY)) invalid(`The month start day must be 1 to ${MAX_MONTH_START_DAY}: ${day}`)
  const from = data.settings.monthStartDay
  if (day === from) return data

  const undatedShift = periodShiftForStartDayChange(from, day)
  const shifts = new Map<string, number>()
  const recurring = data.recurring.map((item) => {
    const shift = item.dueDay === null ? undatedShift : shiftForStartDayChange(item.dueDay, from, day)
    shifts.set(item.id, shift)
    return shift === 0 ? item : shiftRecurring(item, shift)
  })
  const moves = undatedShift !== 0 || [...shifts.values()].some((shift) => shift !== 0)
  const { settings, wallet } = data
  const reviewed = settings.lastReviewedMonth

  return {
    ...data,
    settings: {
      ...settings,
      monthStartDay: day,
      lastReviewedMonth: reviewed === null ? null : shiftMonth(reviewed, undatedShift),
    },
    recurring: recurring.every((item, i) => item === data.recurring[i]) ? data.recurring : recurring,
    months: moves ? remapMonths(data.months, shifts, undatedShift) : data.months,
    wallet:
      wallet.startMonth === null || undatedShift === 0
        ? wallet
        : { ...wallet, startMonth: shiftMonth(wallet.startMonth, undatedShift) },
  }
}

// ---------------------------------------------------------------------------------------------
// Actions

export const actions: Actions = {
  updateSettings(patch) {
    const data = getData()
    const settings = withChanges(data.settings, validPatch<SettingsPatch>(patch, SETTINGS_CHECKS, 'settings'))
    if (settings !== data.settings) commit({ ...data, settings })
  },

  setMonthStartDay(day) {
    commit(remapStartDay(getData(), day))
  },

  setSavingsGoal(amount, today) {
    const goal = savingsOf(amount)
    const date = dateOf(today)
    const data = getData()
    const previous = data.settings.savingsGoal
    if (goal === previous) return

    // Past periods without a goal of their own followed the old default: keep it for them.
    const current = periodOf(date, data.settings.monthStartDay)
    const first = maxMonth(firstPeriod(data, date), addMonths(current, -MAX_FROZEN_PERIODS))
    const months: Record<string, MonthData> = { ...data.months }
    let frozen = false
    for (let month = first; compareISO(month, current) < 0; month = addMonths(month, 1)) {
      const existing = monthAt(data.months, month)
      if (existing?.savingsGoal !== undefined) continue
      months[month] = { ...existing, savingsGoal: previous }
      frozen = true
    }
    commit({
      ...data,
      settings: { ...data.settings, savingsGoal: goal },
      months: frozen ? (months as AppData['months']) : data.months,
    })
  },

  setMonthSavings(month, amount) {
    const key = monthOf(month)
    const goal = amount === null ? null : savingsOf(amount)
    const data = getData()
    const existing = monthAt(data.months, key)
    if ((existing?.savingsGoal ?? null) === goal) return
    const monthData: MonthData = {}
    if (existing?.overrides !== undefined) monthData.overrides = existing.overrides
    if (goal !== null) monthData.savingsGoal = goal
    commit({ ...data, months: withMonth(data.months, key, monthData) })
  },

  addCategory(input) {
    const data = getData()
    const category: Category = {
      id: newId(),
      name: CATEGORY_CHECKS.name(input.name),
      icon: CATEGORY_CHECKS.icon(input.icon),
      color: input.color === undefined ? nextFreeCategoryColor(data.categories) : CATEGORY_CHECKS.color(input.color),
      kind: CATEGORY_CHECKS.kind(input.kind),
      budget: input.budget === undefined ? null : CATEGORY_CHECKS.budget(input.budget),
      order: nextOrder(data.categories),
      archived: false,
    }
    commit({ ...data, categories: [...data.categories, category] })
    return category
  },

  updateCategory(id, patch) {
    const data = getData()
    const { index, item } = locate(data.categories, id, 'category')
    const category = withChanges(item, validPatch<Omit<Category, 'id' | 'order'>>(patch, CATEGORY_CHECKS, 'category'))
    if (category !== item) commit({ ...data, categories: data.categories.with(index, category) })
  },

  setCategoryArchived(id, archived) {
    actions.updateCategory(id, { archived: booleanOf(archived, 'archived') })
  },

  reorderCategories(orderedIds) {
    const data = getData()
    const categories = reorder(data.categories, orderedIds, 'category')
    if (categories !== data.categories) commit({ ...data, categories })
  },

  deleteCategory(id, moveTo) {
    const data = getData()
    const { index } = locate(data.categories, id, 'category')
    if (moveTo !== null) {
      if (moveTo === id) invalid("A category's entries can't be moved into the category itself.")
      locate(data.categories, moveTo, 'category')
    }
    const usage = categoryUsage(data, id)
    const target = moveTo ?? id
    if (target === id && usage.transactions + usage.recurring + usage.quickAdds > 0) {
      invalid('This category is still used. Choose a category to move its entries to.')
    }

    const now = Date.now()
    commit({
      ...data,
      categories: data.categories.toSpliced(index, 1),
      transactions:
        usage.transactions === 0
          ? data.transactions
          : data.transactions.map((tx) => (tx.categoryId === id ? { ...tx, categoryId: target, updatedAt: now } : tx)),
      recurring:
        usage.recurring === 0
          ? data.recurring
          : data.recurring.map((item) => (item.categoryId === id ? { ...item, categoryId: target } : item)),
      quickAdds:
        usage.quickAdds === 0
          ? data.quickAdds
          : data.quickAdds.map((quickAdd) => (quickAdd.categoryId === id ? { ...quickAdd, categoryId: target } : quickAdd)),
    })
  },

  addTransaction(input) {
    const data = getData()
    const kind = memberOf(input.kind, TX_KINDS, 'transaction kind')
    const amount = amountOf(input.amount)
    const now = Date.now()
    const fromWallet = input.fromWallet === undefined ? false : booleanOf(input.fromWallet, 'fromWallet')
    const splits = input.splits === undefined ? [] : splitsOf(input.splits, NO_SPLITS, now)
    if (kind === 'income') {
      if (fromWallet) invalid('Income is never paid from the wallet.')
      if (splits.length > 0) invalid('Income has no splits.')
    } else {
      checkSplitsFit(splits, amount)
    }
    const tx: Transaction = {
      id: newId(),
      kind,
      amount,
      categoryId: kind === 'income' ? null : expenseCategoryOf(input.categoryId),
      date: dateOf(input.date),
      note: input.note === undefined ? '' : textOf(input.note, MAX_LENGTHS.note, 'A note'),
      fromWallet,
      splits,
      createdAt: now,
      updatedAt: now,
    }
    commit({ ...data, transactions: [...data.transactions, tx] })
    return tx
  },

  updateTransaction(id, patch) {
    const data = getData()
    const { index, item } = locate(data.transactions, id, 'transaction')
    const now = Date.now()
    const changes: Partial<Transaction> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      switch (key) {
        case 'amount':
          changes.amount = amountOf(value)
          break
        case 'date':
          changes.date = dateOf(value)
          break
        case 'note':
          changes.note = textOf(value, MAX_LENGTHS.note, 'A note')
          break
        case 'categoryId':
          // Income never has a category, so a category given for it is ignored.
          if (item.kind === 'expense') changes.categoryId = expenseCategoryOf(value)
          break
        case 'fromWallet':
          changes.fromWallet = booleanOf(value, 'fromWallet')
          if (changes.fromWallet && item.kind === 'income') invalid('Income is never paid from the wallet.')
          break
        case 'splits':
          changes.splits = splitsOf(value, item.splits, now)
          if (changes.splits.length > 0 && item.kind === 'income') invalid('Income has no splits.')
          break
        default:
          invalid(`Not a transaction field that can change: ${key}`)
      }
    }
    const updated = withChanges(item, changes)
    if (updated === item) return
    // A smaller amount must still hold what others owe.
    checkSplitsFit(updated.splits, updated.amount)
    commit({ ...data, transactions: data.transactions.with(index, { ...updated, updatedAt: now }) })
  },

  deleteTransaction(id) {
    const data = getData()
    const { index } = locate(data.transactions, id, 'transaction')
    commit({ ...data, transactions: data.transactions.toSpliced(index, 1) })
  },

  setSplitStatus(transactionId, splitId, status) {
    const next = memberOf(status, SPLIT_STATUSES, 'split status')
    const data = getData()
    const { index, item } = locate(data.transactions, transactionId, 'transaction')
    const { index: splitIndex, item: split } = locate(item.splits, splitId, 'split of this expense')
    if (split.status === next) return
    const now = Date.now()
    const splits = item.splits.with(splitIndex, { ...split, status: next, settledAt: settledAtFor(split, next, now) })
    commit({ ...data, transactions: data.transactions.with(index, { ...item, splits, updatedAt: now }) })
  },

  addRecurring(input) {
    const data = getData()
    const kind = memberOf(input.kind, TX_KINDS, 'kind')
    const startMonth = monthOf(input.startMonth, 'The start month')
    const endMonth = input.endMonth === undefined || input.endMonth === null ? null : monthOf(input.endMonth, 'The end month')
    if (endMonth !== null && compareISO(endMonth, startMonth) < 0) invalid("An item can't end before it starts.")
    const item = normalizeRecurring({
      id: newId(),
      kind,
      name: textOf(input.name, MAX_LENGTHS.recurring, 'A name', true),
      categoryId: kind === 'income' ? null : expenseCategoryOf(input.categoryId),
      amounts: [{ from: startMonth, amount: amountOf(input.amount) }],
      everyMonths: input.everyMonths === undefined ? 1 : memberOf(input.everyMonths, EVERY_MONTHS, 'interval'),
      spread: input.spread === undefined ? false : booleanOf(input.spread, 'spread'),
      startMonth,
      endMonth,
      dueDay: input.dueDay === undefined ? null : dueDayOf(input.dueDay),
      note: input.note === undefined ? '' : textOf(input.note, MAX_LENGTHS.note, 'A note'),
      order: nextOrder(data.recurring),
      createdAt: Date.now(),
    })
    commit({ ...data, recurring: [...data.recurring, item] })
    return item
  },

  updateRecurring(id, patch) {
    const data = getData()
    const { index, item } = locate(data.recurring, id, 'recurring item')
    const changes: Partial<Recurring> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      switch (key) {
        case 'name':
          changes.name = textOf(value, MAX_LENGTHS.recurring, 'A name', true)
          break
        case 'categoryId':
          // Income never has a category, so a category given for it is ignored.
          if (item.kind === 'expense') changes.categoryId = expenseCategoryOf(value)
          break
        case 'everyMonths':
          changes.everyMonths = memberOf(value, EVERY_MONTHS, 'interval')
          break
        case 'spread':
          changes.spread = booleanOf(value, 'spread')
          break
        case 'startMonth':
          changes.startMonth = monthOf(value, 'The start month')
          break
        case 'endMonth':
          changes.endMonth = value === null ? null : monthOf(value, 'The end month')
          break
        case 'dueDay':
          changes.dueDay = dueDayOf(value)
          break
        case 'note':
          changes.note = textOf(value, MAX_LENGTHS.note, 'A note')
          break
        default:
          invalid(`Not a field of a recurring item that can change: ${key}`)
      }
    }
    const patched = withChanges(item, changes)
    if (patched === item) return
    if (patched.endMonth !== null && compareISO(patched.endMonth, patched.startMonth) < 0) {
      invalid("An item can't end before it starts.")
    }
    const updated = normalizeRecurring(patched)
    if (!sameRecurring(updated, item)) commit({ ...data, recurring: data.recurring.with(index, updated) })
  },

  setRecurringAmount(id, amount, from) {
    const data = getData()
    const { index, item } = locate(data.recurring, id, 'recurring item')
    const value = amountOf(amount)
    const month = from === 'all' ? item.startMonth : monthOf(from)
    const updated = withAmountFrom(item, value, month)

    // An amount override in that period would hide the new amount there.
    const override = overrideAt(data.months, month, id)
    const months =
      override?.amount === undefined
        ? data.months
        : withOverride(data.months, month, id, storedOverride(undefined, override.skipped === true, override.paid === true))

    const changed = !sameRecurring(updated, item)
    if (!changed && months === data.months) return
    commit({ ...data, recurring: changed ? data.recurring.with(index, updated) : data.recurring, months })
  },

  deleteRecurring(id) {
    const data = getData()
    const { index } = locate(data.recurring, id, 'recurring item')
    commit({ ...data, recurring: data.recurring.toSpliced(index, 1), months: withoutOverridesOf(data.months, id) })
  },

  setOverride(month, recurringId, patch) {
    const key = monthOf(month)
    const data = getData()
    const { item } = locate(data.recurring, recurringId, 'recurring item')
    const line = lineFor(item, key, data.months, data.settings.monthStartDay)
    if (line === null) invalid(`${item.name} has no line in ${key}.`)
    if (isSpread(item) && !line.isChargeMonth) {
      invalid(`${item.name} is spread over its cycle; change it in the period it is charged in.`)
    }

    const current = overrideAt(data.months, key, recurringId)
    let amount = current?.amount
    let skipped = current?.skipped === true
    let paid = current?.paid === true
    if (patch === null) {
      amount = undefined
      skipped = false
      paid = false
    } else {
      for (const field of Object.keys(patch)) {
        if (field !== 'amount' && field !== 'skipped' && field !== 'paid') invalid(`Not an override field: ${field}`)
      }
      if (patch.amount !== undefined) amount = patch.amount === null ? undefined : amountOf(patch.amount)
      if (patch.paid !== undefined) paid = booleanOf(patch.paid, 'paid')
      if (patch.skipped !== undefined) {
        skipped = booleanOf(patch.skipped, 'skipped')
        // Nothing is paid in a skipped period.
        if (skipped) paid = false
      }
    }

    const next = storedOverride(amount, skipped, paid)
    if (!sameOverride(current, next)) commit({ ...data, months: withOverride(data.months, key, recurringId, next) })
  },

  addQuickAdd(input) {
    const data = getData()
    if (data.quickAdds.length >= MAX_QUICK_ADDS) {
      invalid(`There can be at most ${MAX_QUICK_ADDS} quick adds. Delete one to add another.`)
    }
    const quickAdd: QuickAdd = {
      id: newId(),
      label: QUICK_ADD_CHECKS.label(input.label),
      icon: QUICK_ADD_CHECKS.icon(input.icon),
      amount: QUICK_ADD_CHECKS.amount(input.amount),
      categoryId: QUICK_ADD_CHECKS.categoryId(input.categoryId),
      order: nextOrder(data.quickAdds),
    }
    commit({ ...data, quickAdds: [...data.quickAdds, quickAdd] })
    return quickAdd
  },

  updateQuickAdd(id, patch) {
    const data = getData()
    const { index, item } = locate(data.quickAdds, id, 'quick add')
    const quickAdd = withChanges(item, validPatch<Omit<QuickAdd, 'id' | 'order'>>(patch, QUICK_ADD_CHECKS, 'quick add'))
    if (quickAdd !== item) commit({ ...data, quickAdds: data.quickAdds.with(index, quickAdd) })
  },

  deleteQuickAdd(id) {
    const data = getData()
    const { index } = locate(data.quickAdds, id, 'quick add')
    commit({ ...data, quickAdds: data.quickAdds.toSpliced(index, 1) })
  },

  reorderQuickAdds(orderedIds) {
    const data = getData()
    const quickAdds = reorder(data.quickAdds, orderedIds, 'quick add')
    if (quickAdds !== data.quickAdds) commit({ ...data, quickAdds })
  },

  markBackupDone() {
    const data = getData()
    commit({ ...data, settings: { ...data.settings, lastBackupAt: Date.now() } })
  },

  addGoal(input) {
    const data = getData()
    const { goals } = data.wallet
    const goal: SavingsGoal = {
      id: newId(),
      name: GOAL_CHECKS.name(input.name),
      icon: GOAL_CHECKS.icon(input.icon),
      target: GOAL_CHECKS.target(input.target),
      order: nextOrder(goals),
      createdAt: Date.now(),
      doneAt: null,
    }
    commit(withWallet(data, { goals: [...goals, goal] }))
    return goal
  },

  updateGoal(id, patch) {
    const data = getData()
    const { goals } = data.wallet
    const { index, item } = locate(goals, id, 'savings goal')
    const goal = withChanges(item, validPatch<NewGoal>(patch, GOAL_CHECKS, 'savings goal'))
    if (goal !== item) commit(withWallet(data, { goals: goals.with(index, goal) }))
  },

  reorderGoals(orderedIds) {
    const data = getData()
    const goals = reorder(data.wallet.goals, orderedIds, 'savings goal')
    if (goals !== data.wallet.goals) commit(withWallet(data, { goals }))
  },

  setGoalDone(id, done) {
    const flag = booleanOf(done, 'done')
    const data = getData()
    const { goals } = data.wallet
    const { index, item } = locate(goals, id, 'savings goal')
    if ((item.doneAt !== null) === flag) return
    // Only doneAt changes (§5.4): a goal put back keeps its order, and with it its place.
    const goal: SavingsGoal = { ...item, doneAt: flag ? Date.now() : null }
    commit(withWallet(data, { goals: goals.with(index, goal) }))
  },

  deleteGoal(id) {
    const data = getData()
    const { goals } = data.wallet
    const { index } = locate(goals, id, 'savings goal')
    commit(withWallet(data, { goals: goals.toSpliced(index, 1) }))
  },

  markReviewed(month) {
    const key = monthOf(month)
    const data = getData()
    const reviewed = data.settings.lastReviewedMonth
    if (reviewed !== null && compareISO(key, reviewed) <= 0) return
    commit({ ...data, settings: { ...data.settings, lastReviewedMonth: key } })
  },

  setWalletOpening(amount) {
    const opening = openingOf(amount)
    const data = getData()
    if (opening !== data.wallet.opening) commit(withWallet(data, { opening }))
  },

  setWalletStart(month) {
    const startMonth = month === null ? null : monthOf(month, "The wallet's first month")
    const data = getData()
    if (startMonth !== data.wallet.startMonth) commit(withWallet(data, { startMonth }))
  },

  addWalletEntry(input) {
    const data = getData()
    const entry: WalletEntry = {
      id: newId(),
      kind: WALLET_ENTRY_CHECKS.kind(input.kind),
      amount: WALLET_ENTRY_CHECKS.amount(input.amount),
      date: WALLET_ENTRY_CHECKS.date(input.date),
      note: input.note === undefined ? '' : WALLET_ENTRY_CHECKS.note(input.note),
      createdAt: Date.now(),
    }
    commit(withWallet(data, { entries: [...data.wallet.entries, entry] }))
    return entry
  },

  updateWalletEntry(id, patch) {
    const data = getData()
    const { entries } = data.wallet
    const { index, item } = locate(entries, id, 'wallet entry')
    const entry = withChanges(item, validPatch<Required<NewWalletEntry>>(patch, WALLET_ENTRY_CHECKS, 'wallet entry'))
    if (entry !== item) commit(withWallet(data, { entries: entries.with(index, entry) }))
  },

  deleteWalletEntry(id) {
    const data = getData()
    const { entries } = data.wallet
    const { index } = locate(entries, id, 'wallet entry')
    commit(withWallet(data, { entries: entries.toSpliced(index, 1) }))
  },

  restore(previous) {
    const valid =
      isRecord(previous) &&
      isRecord(previous.settings) &&
      Array.isArray(previous.categories) &&
      Array.isArray(previous.recurring) &&
      Array.isArray(previous.transactions) &&
      Array.isArray(previous.quickAdds)
    if (!valid) invalid('Only data that getData() returned can be restored.')
    commit(previous)
  },
}
