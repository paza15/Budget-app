import {
  ACCENTS,
  canonicalNumberLocale,
  CATEGORY_COLORS,
  defaultCurrencyFor,
  FALLBACK_NUMBER_LOCALE,
  HOME_CARDS,
} from '@/domain/catalog'
import { MAX_CENTS, MAX_LENGTHS, MAX_MONTH_START_DAY } from '@/domain/constants'
import { isValidISODate, isValidMonthKey } from '@/domain/dates'
import { createDefaultSettings, createDefaultWallet, CURRENT_SCHEMA_VERSION } from '@/domain/defaults'
import { ID_PATTERN, newId } from '@/domain/ids'
import { isEmoji, isIconRef, splitGraphemes } from '@/domain/queries'
import { normalizeRecurring } from '@/domain/recurring'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import type {
  AccentKey,
  AmountChange,
  AppData,
  Category,
  CategoryColor,
  CategoryKind,
  Cents,
  EveryMonths,
  HomeCardKey,
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

/**
 * Validation and migration of stored data and backups (docs/SPEC.md §4.7). Everything that comes
 * from storage or a file passes through normalizeAppData before the app uses it.
 *
 * The input is treated as hostile: every output object is built field by field from validated
 * values (unknown objects are never spread), fields are read only when they are own properties,
 * and names of Object.prototype members ('__proto__', 'constructor', …) are never accepted as ids
 * or record keys. Repairs keep the row; rows that cannot be used are dropped and counted.
 *
 * Data saved before a field existed gets the field's default, counted as a repair and never as a
 * dropped row, so it loads without a damage notice: a transaction is not paid from the wallet and
 * has no splits, the wallet has no goals and no month has been reviewed (§5.9).
 */

/** not-backup: not an On a Budget file. newer-version: written by a newer build. damaged: unusable. */
export type DataErrorCode = 'not-backup' | 'newer-version' | 'damaged'

/** Data that cannot be used. `message` is written for the user and shown as is. */
export class DataError extends Error {
  readonly code: DataErrorCode

  constructor(code: DataErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DataError'
    this.code = code
  }
}

/** What normalisation changed. Nothing migrated, dropped or repaired means the input was clean. */
export interface NormalizeReport {
  /** Schema version the data was migrated from, or null when it was current. */
  migratedFrom: number | null
  /**
   * Rows removed because they could not be repaired (the "damaged entries" the app reports).
   * Wallet entries and savings goals count as transactions.
   */
  dropped: { transactions: number; recurring: number; categories: number; quickAdds: number; overrides: number }
  /**
   * Number of fields repaired in place or filled in because they were missing, plus exact
   * duplicate rows removed and splits removed from the expenses that keep them.
   */
  repaired: number
}

/** MIGRATIONS[n] turns raw data of schema n into schema n + 1. Schema 1 is the first: none yet. */
export const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {}

/** Messages for data loaded from storage (§3.10). parseBackup words its own for backup files. */
const MESSAGES = {
  'newer-version': 'This data was saved by a newer version of the app. Reload to update.',
  damaged: "This data is damaged and can't be opened.",
} as const satisfies Partial<Record<DataErrorCode, string>>

// ---------------------------------------------------------------------------------------------
// Reading unknown values

/** A JSON-like object: anything but null, arrays and primitives. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An own property of `record`, or undefined. Inherited members (`__proto__` too) read as missing. */
export function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

/** Object.prototype's members: never accepted as an id, so no lookup by id can reach them. */
const RESERVED_KEYS: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype))

/** Epoch ms up to the end of the year 2999, the last year dates.ts accepts from outside. */
const MAX_TIMESTAMP = Date.UTC(2999, 11, 31, 23, 59, 59, 999)

const THEMES: ReadonlySet<unknown> = new Set<ThemeMode>(['system', 'light', 'dark'])
const ACCENT_KEYS: ReadonlySet<unknown> = new Set<AccentKey>(ACCENTS.map(({ key }) => key))
const CATEGORY_COLOR_KEYS: ReadonlySet<unknown> = new Set<CategoryColor>(CATEGORY_COLORS.map(({ key }) => key))
const CATEGORY_KINDS: ReadonlySet<unknown> = new Set<CategoryKind>(['fixed', 'daily', 'both'])
const HOME_CARD_KEYS: ReadonlySet<unknown> = new Set<HomeCardKey>(HOME_CARDS.map(({ key }) => key))
const EVERY_MONTHS: ReadonlySet<unknown> = new Set<EveryMonths>([1, 2, 3, 6, 12])
const SPLIT_STATUSES: ReadonlySet<unknown> = new Set<SplitStatus>(['open', 'paid', 'forgiven'])

const CURRENCY_CODE = /^[A-Z]{3}$/

/** Longest name of a person in a split and of a savings goal (§3.14, §3.16): the name limit. */
const MAX_PERSON_LENGTH = MAX_LENGTHS.name
const MAX_GOAL_NAME_LENGTH = MAX_LENGTHS.name

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isFalse(value: unknown): value is false {
  return value === false
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isTxKind(value: unknown): value is TxKind {
  return value === 'expense' || value === 'income'
}

function isTheme(value: unknown): value is ThemeMode {
  return THEMES.has(value)
}

function isAccent(value: unknown): value is AccentKey {
  return ACCENT_KEYS.has(value)
}

function isCategoryColor(value: unknown): value is CategoryColor {
  return CATEGORY_COLOR_KEYS.has(value)
}

function isCategoryKind(value: unknown): value is CategoryKind {
  return CATEGORY_KINDS.has(value)
}

function isHomeCardKey(value: unknown): value is HomeCardKey {
  return HOME_CARD_KEYS.has(value)
}

function isEveryMonths(value: unknown): value is EveryMonths {
  return EVERY_MONTHS.has(value)
}

function isSplitStatus(value: unknown): value is SplitStatus {
  return SPLIT_STATUSES.has(value)
}

/** An amount field: an integer 1..MAX_CENTS. */
function isAmount(value: unknown): value is Cents {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_CENTS
}

/** A category limit: null or an amount (a limit of 0 means none, so it is stored as null). */
function isBudget(value: unknown): value is Cents | null {
  return value === null || isAmount(value)
}

/** Epoch ms that every date helper can turn into a calendar date. */
function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_TIMESTAMP
}

function isTimestampOrNull(value: unknown): value is number | null {
  return value === null || isTimestamp(value)
}

function isMonthKeyOrNull(value: unknown): value is MonthKey | null {
  return value === null || isValidMonthKey(value)
}

function isDueDay(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 31)
}

function isNull(value: unknown): value is null {
  return value === null
}

/** A record id (§4.7): ID_PATTERN, and never an Object.prototype member such as 'constructor'. */
function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value) && !RESERVED_KEYS.has(value)
}

/** A category reference: a valid id (of a category that may no longer exist) or UNCATEGORIZED_ID. */
function isCategoryRef(value: unknown): value is string {
  return value === UNCATEGORIZED_ID || isValidId(value)
}

/** A savings goal clamped to 0..MAX_CENTS, or null when `value` is not a whole number. */
function clampSavings(value: unknown): Cents | null {
  if (!Number.isSafeInteger(value)) return null
  return Math.min(MAX_CENTS, Math.max(0, value as number))
}

/**
 * Structural equality of JSON-like values; key order does not matter. Recursion stops at the
 * shallower side, so comparing a normalised value with hostile input never runs deep.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item: unknown, i) => deepEqual(item, b[i]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
}

/**
 * Trims `value` and limits it to `maxLength` characters. Characters are graphemes, the most
 * generous measure (an input's maxLength counts UTF-16 units), so text the app saved never
 * changes and a cut never splits an emoji. The end is trimmed again after a cut, which keeps
 * this idempotent.
 */
function clampText(value: string, maxLength: number): string {
  const trimmed = value.trim()
  // A string never has more graphemes than UTF-16 code units.
  if (trimmed.length <= maxLength) return trimmed
  const graphemes = splitGraphemes(trimmed)
  if (graphemes.length <= maxLength) return trimmed
  return graphemes.slice(0, maxLength).join('').trimEnd()
}

// ---------------------------------------------------------------------------------------------
// Normalisation context

/** Running counts for the report. */
interface Context {
  readonly now: number
  readonly dropped: NormalizeReport['dropped']
  repaired: number
  /** New split ids by transaction id and split position, see newSplitId. */
  readonly splitIds: Map<string, string>
}

type Collection = keyof NormalizeReport['dropped']

/** `value` when `isValid` accepts it, else `fallback`, counted as a repair. */
function valid<T>(ctx: Context, value: unknown, isValid: (value: unknown) => value is T, fallback: T): T {
  if (isValid(value)) return value
  ctx.repaired += 1
  return fallback
}

/** Trimmed text of at most `maxLength` characters; anything but a string becomes ''. */
function textField(ctx: Context, value: unknown, maxLength: number): string {
  const cleaned = typeof value === 'string' ? clampText(value, maxLength) : ''
  if (cleaned !== value) ctx.repaired += 1
  return cleaned
}

/** The id when valid, else a new one. */
function idField(ctx: Context, value: unknown): string {
  if (isValidId(value)) return value
  ctx.repaired += 1
  return newId()
}

/** `value` when it is an array; anything else (a missing list too) is an empty one, counted as a repair. */
function listField(ctx: Context, value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value
  ctx.repaired += 1
  return []
}

/** Income has no category; an expense without a usable one is uncategorized (unknown ids stay). */
function categoryField(ctx: Context, kind: TxKind, value: unknown): string | null {
  if (kind === 'income') return valid(ctx, value, isNull, null)
  return valid(ctx, value, isCategoryRef, UNCATEGORIZED_ID)
}

/**
 * Normalises every element of an array; elements that come back null are dropped and counted.
 * `normalize` also gets the row's position, which stands in for a missing or invalid `order`:
 * its index, or, when a row with the same id was kept earlier, that row's index. Copies of a row
 * then come out identical whatever their place in the list, so withUniqueIds removes them
 * instead of keeping each under a new id (§4.7 compares duplicates after repairs).
 */
function rows<T>(
  ctx: Context,
  collection: Collection,
  list: readonly unknown[],
  normalize: (raw: Record<string, unknown>, position: number) => T | null,
): T[] {
  const result: T[] = []
  // Only valid ids can be duplicates: an invalid one is replaced by a new, unique id.
  const firstIndexById = new Map<string, number>()
  list.forEach((raw: unknown, index) => {
    if (!isRecord(raw)) {
      ctx.dropped[collection] += 1
      return
    }
    const rawId = ownValue(raw, 'id')
    const id = isValidId(rawId) ? rawId : null
    const row = normalize(raw, (id === null ? undefined : firstIndexById.get(id)) ?? index)
    if (row === null) {
      ctx.dropped[collection] += 1
      return
    }
    if (id !== null && !firstIndexById.has(id)) firstIndexById.set(id, index)
    result.push(row)
  })
  return result
}

/**
 * Makes ids unique within a collection (§4.7). A later row with a taken id is removed when it is
 * identical to the first, which loses nothing and so counts as a repair; otherwise it gets a new id.
 */
function withUniqueIds<T extends { id: string }>(ctx: Context, list: readonly T[]): T[] {
  const firstById = new Map<string, T>()
  const result: T[] = []
  for (const row of list) {
    const first = firstById.get(row.id)
    if (first === undefined) {
      firstById.set(row.id, row)
      result.push(row)
    } else if (deepEqual(first, row)) {
      ctx.repaired += 1
    } else {
      // Spreading is safe here: `row` is a normalised object with known fields only.
      const renamed = { ...row, id: newId() }
      firstById.set(renamed.id, renamed)
      ctx.repaired += 1
      result.push(renamed)
    }
  }
  return result
}

// ---------------------------------------------------------------------------------------------
// Settings

/** An ISO 4217-shaped code that Intl can format ('eur' is repaired to 'EUR'), or null. */
function currencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  if (!CURRENCY_CODE.test(code)) return null
  try {
    const format = new Intl.NumberFormat('en', { style: 'currency', currency: code })
    return format.resolvedOptions().currency === code ? code : null
  } catch {
    return null
  }
}

/** Valid Home card keys in their stored order, without duplicates. */
function homeCards(ctx: Context, value: unknown, fallback: HomeCardKey[]): HomeCardKey[] {
  if (!Array.isArray(value)) {
    ctx.repaired += 1
    return fallback
  }
  const list: readonly unknown[] = value
  const cards = [...new Set(list.filter(isHomeCardKey))]
  if (!deepEqual(cards, list)) ctx.repaired += 1
  return cards
}

/**
 * Settings field by field (§4.7): every invalid field gets its default; monthStartDay is rounded
 * and clamped to 1..28 and savingsGoal clamped to 0..MAX_CENTS. The locale is kept in canonical
 * form when it is an offered format (even one the engine has no data for) or one Intl supports,
 * else it becomes de-DE. An invalid currency falls back to the one the (repaired) number format's
 * region uses. lastReviewedMonth is a valid MonthKey or null (§3.15).
 */
function normalizeSettings(ctx: Context, raw: unknown): Settings {
  const defaults = createDefaultSettings(ctx.now)
  if (!isRecord(raw)) {
    ctx.repaired += 1
    return defaults
  }

  const rawLocale = ownValue(raw, 'locale')
  const locale = canonicalNumberLocale(rawLocale) ?? FALLBACK_NUMBER_LOCALE
  if (locale !== rawLocale) ctx.repaired += 1

  const rawCurrency = ownValue(raw, 'currency')
  const currency = currencyCode(rawCurrency) ?? defaultCurrencyFor(locale)
  if (currency !== rawCurrency) ctx.repaired += 1

  const rawAvatar = ownValue(raw, 'avatar')
  const trimmedAvatar = typeof rawAvatar === 'string' ? rawAvatar.trim() : ''
  const avatar = trimmedAvatar === '' || isEmoji(trimmedAvatar) ? trimmedAvatar : ''
  if (avatar !== rawAvatar) ctx.repaired += 1

  const rawStartDay = ownValue(raw, 'monthStartDay')
  const monthStartDay = isFiniteNumber(rawStartDay)
    ? Math.min(MAX_MONTH_START_DAY, Math.max(1, Math.round(rawStartDay)))
    : defaults.monthStartDay
  if (monthStartDay !== rawStartDay) ctx.repaired += 1

  const rawSavings = ownValue(raw, 'savingsGoal')
  const savingsGoal = clampSavings(rawSavings) ?? defaults.savingsGoal
  if (savingsGoal !== rawSavings) ctx.repaired += 1

  return {
    name: textField(ctx, ownValue(raw, 'name'), MAX_LENGTHS.name),
    avatar,
    currency,
    locale,
    monthStartDay,
    savingsGoal,
    theme: valid(ctx, ownValue(raw, 'theme'), isTheme, defaults.theme),
    accent: valid(ctx, ownValue(raw, 'accent'), isAccent, defaults.accent),
    showCents: valid(ctx, ownValue(raw, 'showCents'), isBoolean, defaults.showCents),
    hideAmounts: valid(ctx, ownValue(raw, 'hideAmounts'), isBoolean, defaults.hideAmounts),
    homeCards: homeCards(ctx, ownValue(raw, 'homeCards'), defaults.homeCards),
    onboarded: valid(ctx, ownValue(raw, 'onboarded'), isBoolean, defaults.onboarded),
    lastBackupAt: valid(ctx, ownValue(raw, 'lastBackupAt'), isTimestampOrNull, defaults.lastBackupAt),
    lastReviewedMonth: valid(ctx, ownValue(raw, 'lastReviewedMonth'), isMonthKeyOrNull, defaults.lastReviewedMonth),
    createdAt: valid(ctx, ownValue(raw, 'createdAt'), isTimestamp, defaults.createdAt),
  }
}

// ---------------------------------------------------------------------------------------------
// Rows

/**
 * A category; dropped without a name, the one field that has no default. A missing or invalid
 * order becomes `position` (see rows).
 */
function normalizeCategory(ctx: Context, raw: Record<string, unknown>, position: number): Category | null {
  const name = ownValue(raw, 'name')
  if (typeof name !== 'string') return null
  return {
    id: idField(ctx, ownValue(raw, 'id')),
    name: textField(ctx, name, MAX_LENGTHS.category),
    icon: valid(ctx, ownValue(raw, 'icon'), isIconRef, 'circle'),
    color: valid(ctx, ownValue(raw, 'color'), isCategoryColor, 'slate'),
    kind: valid(ctx, ownValue(raw, 'kind'), isCategoryKind, 'both'),
    budget: valid(ctx, ownValue(raw, 'budget'), isBudget, null),
    order: valid(ctx, ownValue(raw, 'order'), isFiniteNumber, position),
    archived: valid(ctx, ownValue(raw, 'archived'), isBoolean, false),
  }
}

/**
 * A new id for the split at `index` among the stored splits of the transaction `transactionId`.
 * Within one normalisation the same transaction id and index always get the same new id, so
 * copies of a transaction come out identical and withUniqueIds removes them instead of keeping
 * each under a new id (the way `rows` gives copies the same order). A transaction whose own id
 * was invalid has a new, unique id, so its splits get unique new ids too.
 */
function newSplitId(ctx: Context, transactionId: string, index: number): string {
  // Ids never contain a space, so the key names one transaction and one position.
  const key = `${transactionId} ${index}`
  const known = ctx.splitIds.get(key)
  if (known !== undefined) return known
  const id = newId()
  ctx.splitIds.set(key, id)
  return id
}

/**
 * One person's part of an expense (§4.9); dropped (null) when the person's name is empty once
 * trimmed or the amount is not an integer in 1..MAX_CENTS. An invalid status counts as open. An
 * open split has no settledAt; a paid or forgiven one without a valid time takes the
 * transaction's `updatedAt`, the last time anything about it changed.
 */
function normalizeSplit(
  ctx: Context,
  raw: Record<string, unknown>,
  transactionId: string,
  index: number,
  updatedAt: number,
): Split | null {
  const rawPerson = ownValue(raw, 'person')
  const amount = ownValue(raw, 'amount')
  const person = typeof rawPerson === 'string' ? clampText(rawPerson, MAX_PERSON_LENGTH) : ''
  if (person === '' || !isAmount(amount)) return null
  if (person !== rawPerson) ctx.repaired += 1

  const rawId = ownValue(raw, 'id')
  let id: string
  if (isValidId(rawId)) {
    id = rawId
  } else {
    ctx.repaired += 1
    id = newSplitId(ctx, transactionId, index)
  }
  const status = valid(ctx, ownValue(raw, 'status'), isSplitStatus, 'open')
  const rawSettledAt = ownValue(raw, 'settledAt')
  const settledAt =
    status === 'open' ? valid(ctx, rawSettledAt, isNull, null) : valid(ctx, rawSettledAt, isTimestamp, updatedAt)
  return { id, person, amount, status, settledAt }
}

/**
 * The splits of an expense (§4.9). Data saved before splits existed has none. Splits that cannot
 * be used are removed, ids are made unique within the expense like the ids of rows (§4.7: an exact
 * copy is removed, a different split gets a new id), and splits never add up to more than the
 * amount: the last ones go first until the rest fits. The expense is kept, so each removed or
 * changed split counts as a repair.
 */
function splitsField(ctx: Context, value: unknown, transactionId: string, amount: Cents, updatedAt: number): Split[] {
  const list = listField(ctx, value)
  const splits: Split[] = []
  const firstById = new Map<string, Split>()
  list.forEach((raw: unknown, index) => {
    const split = isRecord(raw) ? normalizeSplit(ctx, raw, transactionId, index, updatedAt) : null
    if (split === null) {
      ctx.repaired += 1
      return
    }
    const first = firstById.get(split.id)
    if (first === undefined) {
      firstById.set(split.id, split)
      splits.push(split)
      return
    }
    ctx.repaired += 1
    // An exact copy loses nothing; a different split with a taken id gets its own.
    if (deepEqual(first, split)) return
    const renamed: Split = { ...split, id: newSplitId(ctx, transactionId, index) }
    firstById.set(renamed.id, renamed)
    splits.push(renamed)
  })

  // Keep the longest run from the start that fits: the same as dropping the last split until the
  // total fits, and the running total never grows past amount + MAX_CENTS, so it stays exact.
  let total = 0
  let fitting = splits.length
  for (const [index, split] of splits.entries()) {
    total += split.amount
    if (total > amount) {
      fitting = index
      break
    }
  }
  ctx.repaired += splits.length - fitting
  return fitting === splits.length ? splits : splits.slice(0, fitting)
}

/** Income has no splits: any stored ones are removed as one repair. */
function noSplits(ctx: Context, value: unknown): Split[] {
  if (!Array.isArray(value) || value.length > 0) ctx.repaired += 1
  return []
}

/**
 * A transaction; dropped when its kind, amount or date is invalid. Expenses keep whether they were
 * paid from the wallet (§3.13) and their splits (§3.16); income is never paid from the wallet and
 * has no splits.
 */
function normalizeTransaction(ctx: Context, raw: Record<string, unknown>): Transaction | null {
  const kind = ownValue(raw, 'kind')
  const amount = ownValue(raw, 'amount')
  const date = ownValue(raw, 'date')
  if (!isTxKind(kind) || !isAmount(amount) || !isValidISODate(date)) return null
  const id = idField(ctx, ownValue(raw, 'id'))
  const createdAt = valid(ctx, ownValue(raw, 'createdAt'), isTimestamp, ctx.now)
  const updatedAt = valid(ctx, ownValue(raw, 'updatedAt'), isTimestamp, createdAt)
  const rawFromWallet = ownValue(raw, 'fromWallet')
  const rawSplits = ownValue(raw, 'splits')
  return {
    id,
    kind,
    amount,
    categoryId: categoryField(ctx, kind, ownValue(raw, 'categoryId')),
    date,
    note: textField(ctx, ownValue(raw, 'note'), MAX_LENGTHS.note),
    fromWallet:
      kind === 'income' ? valid(ctx, rawFromWallet, isFalse, false) : valid(ctx, rawFromWallet, isBoolean, false),
    splits: kind === 'income' ? noSplits(ctx, rawSplits) : splitsField(ctx, rawSplits, id, amount, updatedAt),
    createdAt,
    updatedAt,
  }
}

/** The valid entries of an amount history, rebuilt as plain { from, amount } objects. */
function amountEntries(value: unknown): AmountChange[] {
  if (!Array.isArray(value)) return []
  const list: readonly unknown[] = value
  const entries: AmountChange[] = []
  for (const entry of list) {
    if (!isRecord(entry)) continue
    const from = ownValue(entry, 'from')
    const amount = ownValue(entry, 'amount')
    if (isValidMonthKey(from) && isAmount(amount)) entries.push({ from, amount })
  }
  return entries
}

/**
 * A recurring item; dropped when its startMonth is invalid or no amount entry is valid. Other
 * fields are repaired (an unknown kind counts as an expense, the common case; a missing or
 * invalid order becomes `position`, see rows), then normalizeRecurring puts the amount history,
 * range and flags in shape (§4.4).
 */
function normalizeRecurringItem(ctx: Context, raw: Record<string, unknown>, position: number): Recurring | null {
  const startMonth = ownValue(raw, 'startMonth')
  const rawAmounts = ownValue(raw, 'amounts')
  const amounts = amountEntries(rawAmounts)
  if (!isValidMonthKey(startMonth) || amounts.length === 0) return null
  if (!deepEqual(amounts, rawAmounts)) ctx.repaired += 1

  const kind = valid(ctx, ownValue(raw, 'kind'), isTxKind, 'expense')
  const item: Recurring = {
    id: idField(ctx, ownValue(raw, 'id')),
    kind,
    name: textField(ctx, ownValue(raw, 'name'), MAX_LENGTHS.recurring),
    categoryId: categoryField(ctx, kind, ownValue(raw, 'categoryId')),
    amounts,
    everyMonths: valid(ctx, ownValue(raw, 'everyMonths'), isEveryMonths, 1),
    spread: valid(ctx, ownValue(raw, 'spread'), isBoolean, false),
    startMonth,
    endMonth: valid(ctx, ownValue(raw, 'endMonth'), isMonthKeyOrNull, null),
    dueDay: valid(ctx, ownValue(raw, 'dueDay'), isDueDay, null),
    note: textField(ctx, ownValue(raw, 'note'), MAX_LENGTHS.note),
    order: valid(ctx, ownValue(raw, 'order'), isFiniteNumber, position),
    createdAt: valid(ctx, ownValue(raw, 'createdAt'), isTimestamp, ctx.now),
  }
  const normalized = normalizeRecurring(item)
  if (!deepEqual(normalized, item)) ctx.repaired += 1
  return normalized
}

/**
 * A quick add; dropped without a label, a valid amount or a category reference, since a button
 * that adds an expense to no category would be of no use. A missing or invalid order becomes
 * `position` (see rows).
 */
function normalizeQuickAdd(ctx: Context, raw: Record<string, unknown>, position: number): QuickAdd | null {
  const label = ownValue(raw, 'label')
  const amount = ownValue(raw, 'amount')
  const categoryId = ownValue(raw, 'categoryId')
  if (typeof label !== 'string' || !isAmount(amount) || !isCategoryRef(categoryId)) return null
  return {
    id: idField(ctx, ownValue(raw, 'id')),
    label: textField(ctx, label, MAX_LENGTHS.quickAdd),
    icon: valid(ctx, ownValue(raw, 'icon'), isIconRef, 'circle'),
    amount,
    categoryId,
    order: valid(ctx, ownValue(raw, 'order'), isFiniteNumber, position),
  }
}

// ---------------------------------------------------------------------------------------------
// Months and overrides

/**
 * One override in its stored form (§5.4): only `amount` (1..MAX_CENTS), `skipped: true` and
 * `paid: true`. Any other value of those keys is removed and counted as a repair.
 */
function normalizeOverride(ctx: Context, raw: Record<string, unknown>): RecurringOverride {
  const override: RecurringOverride = {}
  if (Object.hasOwn(raw, 'amount')) {
    const amount = ownValue(raw, 'amount')
    if (isAmount(amount)) override.amount = amount
    else ctx.repaired += 1
  }
  if (Object.hasOwn(raw, 'skipped')) {
    if (ownValue(raw, 'skipped') === true) override.skipped = true
    else ctx.repaired += 1
  }
  if (Object.hasOwn(raw, 'paid')) {
    if (ownValue(raw, 'paid') === true) override.paid = true
    else ctx.repaired += 1
  }
  return override
}

/**
 * The overrides of one period, or undefined when none remain. Overrides of unknown recurring
 * items and ones that are not objects are dropped; empty ones are removed.
 */
function normalizeOverrides(
  ctx: Context,
  raw: unknown,
  recurringIds: ReadonlySet<string>,
): Record<string, RecurringOverride> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    ctx.repaired += 1
    return undefined
  }
  const overrides: Record<string, RecurringOverride> = {}
  let kept = 0
  for (const recurringId of Object.keys(raw)) {
    const value = ownValue(raw, recurringId)
    if (!recurringIds.has(recurringId) || !isRecord(value)) {
      ctx.dropped.overrides += 1
      continue
    }
    const override = normalizeOverride(ctx, value)
    if (Object.keys(override).length === 0) {
      ctx.repaired += 1
      continue
    }
    // recurringIds holds valid ids only, so `recurringId` is never '__proto__' or 'constructor'.
    overrides[recurringId] = override
    kept += 1
  }
  if (kept === 0) {
    ctx.repaired += 1
    return undefined
  }
  return overrides
}

/** Counts what a discarded period held: its overrides as dropped, anything else as a repair. */
function discardMonth(ctx: Context, raw: unknown): void {
  const overrides = isRecord(raw) ? ownValue(raw, 'overrides') : undefined
  const count = isRecord(overrides) ? Object.keys(overrides).length : 0
  if (count > 0) ctx.dropped.overrides += count
  else ctx.repaired += 1
}

/**
 * Per-period data keyed by valid MonthKeys (which can never name an Object.prototype member). A
 * period keeps only valid overrides and a savings goal clamped to 0..MAX_CENTS; a period left
 * with neither is removed.
 */
function normalizeMonths(ctx: Context, raw: unknown, recurringIds: ReadonlySet<string>): AppData['months'] {
  const months: AppData['months'] = {}
  if (!isRecord(raw)) {
    ctx.repaired += 1
    return months
  }
  for (const key of Object.keys(raw)) {
    const value = ownValue(raw, key)
    if (!isValidMonthKey(key) || !isRecord(value)) {
      discardMonth(ctx, value)
      continue
    }
    const month: MonthData = {}
    const overrides = normalizeOverrides(ctx, ownValue(value, 'overrides'), recurringIds)
    if (overrides !== undefined) month.overrides = overrides
    if (Object.hasOwn(value, 'savingsGoal')) {
      const rawSavings = ownValue(value, 'savingsGoal')
      const savingsGoal = clampSavings(rawSavings)
      if (savingsGoal === null) {
        ctx.repaired += 1
      } else {
        month.savingsGoal = savingsGoal
        if (savingsGoal !== rawSavings) ctx.repaired += 1
      }
    }
    if (month.overrides === undefined && month.savingsGoal === undefined) {
      ctx.repaired += 1
      continue
    }
    months[key] = month
  }
  return months
}

// ---------------------------------------------------------------------------------------------
// Wallet

/** A deposit or withdrawal; dropped when its kind, amount or date is invalid. */
function normalizeWalletEntry(ctx: Context, raw: Record<string, unknown>): WalletEntry | null {
  const kind = ownValue(raw, 'kind')
  const amount = ownValue(raw, 'amount')
  const date = ownValue(raw, 'date')
  if ((kind !== 'deposit' && kind !== 'withdrawal') || !isAmount(amount) || !isValidISODate(date)) return null
  return {
    id: idField(ctx, ownValue(raw, 'id')),
    kind,
    amount,
    date,
    note: textField(ctx, ownValue(raw, 'note'), MAX_LENGTHS.note),
    createdAt: valid(ctx, ownValue(raw, 'createdAt'), isTimestamp, ctx.now),
  }
}

/**
 * A savings goal (§3.14); dropped when its name is empty once trimmed or its target is not an
 * integer in 1..MAX_CENTS, since a goal without either has nothing to show. An invalid icon
 * becomes 'circle', a missing or invalid order becomes `position` (see rows), and an invalid
 * doneAt makes the goal active.
 */
function normalizeGoal(ctx: Context, raw: Record<string, unknown>, position: number): SavingsGoal | null {
  const rawName = ownValue(raw, 'name')
  const target = ownValue(raw, 'target')
  const name = typeof rawName === 'string' ? clampText(rawName, MAX_GOAL_NAME_LENGTH) : ''
  if (name === '' || !isAmount(target)) return null
  if (name !== rawName) ctx.repaired += 1
  return {
    id: idField(ctx, ownValue(raw, 'id')),
    name,
    icon: valid(ctx, ownValue(raw, 'icon'), isIconRef, 'circle'),
    target,
    order: valid(ctx, ownValue(raw, 'order'), isFiniteNumber, position),
    createdAt: valid(ctx, ownValue(raw, 'createdAt'), isTimestamp, ctx.now),
    doneAt: valid(ctx, ownValue(raw, 'doneAt'), isTimestampOrNull, null),
  }
}

/**
 * The wallet (§4.8). Data saved before the wallet existed has none and gets an empty one, and a
 * wallet saved before goals existed gets none. The opening balance is clamped to 0..MAX_CENTS.
 * The report has no counters for the wallet's rows (§5.3), so dropped entries and goals count as
 * dropped transactions: the "skipped damaged entries" notice and the quarantine copy cover them.
 */
function normalizeWallet(ctx: Context, raw: unknown): Wallet {
  if (!isRecord(raw)) {
    ctx.repaired += 1
    return createDefaultWallet()
  }
  const rawOpening = ownValue(raw, 'opening')
  const opening = clampSavings(rawOpening) ?? 0
  if (opening !== rawOpening) ctx.repaired += 1

  const startMonth = valid(ctx, ownValue(raw, 'startMonth'), isMonthKeyOrNull, null)

  const entries = withUniqueIds(
    ctx,
    rows(ctx, 'transactions', listField(ctx, ownValue(raw, 'entries')), (row) => normalizeWalletEntry(ctx, row)),
  )
  const goals = withUniqueIds(
    ctx,
    rows(ctx, 'transactions', listField(ctx, ownValue(raw, 'goals')), (row, position) =>
      normalizeGoal(ctx, row, position),
    ),
  )
  return { opening, startMonth, entries, goals }
}

// ---------------------------------------------------------------------------------------------
// Entry points

/** Runs MIGRATIONS from `version` up to CURRENT_SCHEMA_VERSION. */
function migrate(raw: Record<string, unknown>, version: number): Record<string, unknown> {
  let record = raw
  for (let from = version; from < CURRENT_SCHEMA_VERSION; from += 1) {
    const step = Object.hasOwn(MIGRATIONS, from) ? MIGRATIONS[from] : undefined
    if (step === undefined) throw new DataError('damaged', MESSAGES.damaged)
    const next = step(record)
    if (!isRecord(next)) throw new DataError('damaged', MESSAGES.damaged)
    record = next
  }
  return record
}

/** One of the top-level arrays every schema has; without it the data is damaged. */
function requiredArray(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = ownValue(record, key)
  if (!Array.isArray(value)) throw new DataError('damaged', MESSAGES.damaged)
  return value
}

function normalizeUnchecked(raw: unknown, now: number): { data: AppData; report: NormalizeReport } {
  if (!isRecord(raw)) throw new DataError('damaged', MESSAGES.damaged)
  const version = ownValue(raw, 'schemaVersion')
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) throw new DataError('damaged', MESSAGES.damaged)
  // Checked before anything else: a newer schema may have changed every other field.
  if (version > CURRENT_SCHEMA_VERSION) throw new DataError('newer-version', MESSAGES['newer-version'])

  const record = migrate(raw, version)
  const rawCategories = requiredArray(record, 'categories')
  const rawRecurring = requiredArray(record, 'recurring')
  const rawTransactions = requiredArray(record, 'transactions')
  const rawQuickAdds = requiredArray(record, 'quickAdds')

  const ctx: Context = {
    now,
    dropped: { transactions: 0, recurring: 0, categories: 0, quickAdds: 0, overrides: 0 },
    repaired: 0,
    splitIds: new Map(),
  }
  const settings = normalizeSettings(ctx, ownValue(record, 'settings'))
  const categories = withUniqueIds(
    ctx,
    rows(ctx, 'categories', rawCategories, (row, position) => normalizeCategory(ctx, row, position)),
  )
  const recurring = withUniqueIds(
    ctx,
    rows(ctx, 'recurring', rawRecurring, (row, position) => normalizeRecurringItem(ctx, row, position)),
  )
  const transactions = withUniqueIds(
    ctx,
    rows(ctx, 'transactions', rawTransactions, (row) => normalizeTransaction(ctx, row)),
  )
  const quickAdds = withUniqueIds(
    ctx,
    rows(ctx, 'quickAdds', rawQuickAdds, (row, position) => normalizeQuickAdd(ctx, row, position)),
  )
  const recurringIds = new Set(recurring.map((item) => item.id))
  const months = normalizeMonths(ctx, ownValue(record, 'months'), recurringIds)
  const wallet = normalizeWallet(ctx, ownValue(record, 'wallet'))

  return {
    data: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      settings,
      categories,
      recurring,
      transactions,
      quickAdds,
      months,
      wallet,
    },
    report: {
      migratedFrom: version < CURRENT_SCHEMA_VERSION ? version : null,
      dropped: ctx.dropped,
      repaired: ctx.repaired,
    },
  }
}

/**
 * Migrates, validates and repairs raw data (§4.7). Throws DataError 'damaged' when `raw` is not an
 * object with a whole-number schemaVersion and the four top-level arrays, and 'newer-version'
 * when its schemaVersion is newer than CURRENT_SCHEMA_VERSION; it never throws anything else.
 * `now` stands in for timestamps that are missing or invalid. Idempotent: normalising its own
 * output changes nothing and reports nothing.
 */
export function normalizeAppData(raw: unknown, now: number): { data: AppData; report: NormalizeReport } {
  try {
    return normalizeUnchecked(raw, now)
  } catch (error) {
    if (error instanceof DataError) throw error
    // Input built to break the reader (a throwing getter, a revoked Proxy) is damaged too.
    throw new DataError('damaged', MESSAGES.damaged, { cause: error })
  }
}

/** Total number of dropped rows in a report: the "damaged entries" the app tells the user about. */
export function droppedCount(report: NormalizeReport): number {
  const { transactions, recurring, categories, quickAdds, overrides } = report.dropped
  return transactions + recurring + categories + quickAdds + overrides
}
