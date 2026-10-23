import { CATEGORY_COLORS, CATEGORY_ICONS } from '@/domain/catalog'
import { BEFORE_APP_NOTE } from '@/domain/constants'
import { compareISO, localDateOf, minMonth } from '@/domain/dates'
import { periodOf } from '@/domain/period'
import type { AppData, Category, CategoryColor, IconRef, ISODate, MonthKey, Transaction } from '@/domain/types'

/**
 * Read-only questions about the data (docs/SPEC.md §4.6, §5.3), and the test for valid category
 * symbols. Results reuse existing element references, never clones.
 */

/** How many records reference a category. */
export interface CategoryUsage {
  transactions: number
  recurring: number
  quickAdds: number
}

/** How a category reference is shown: its name, icon and colour. */
export interface CategoryDisplay {
  name: string
  icon: IconRef
  color: CategoryColor | null
}

/** Shown for category ids that do not exist (UNCATEGORIZED_ID or a deleted category). */
export const UNCATEGORIZED_DISPLAY = Object.freeze({ name: 'Uncategorized', icon: 'question', color: null } as const)

const MS_PER_DAY = 86_400_000

/** The backup reminder waits until there is this much to lose: transactions plus recurring items. */
const BACKUP_REMINDER_MIN_RECORDS = 10

/** Remind this long after the last backup. */
const BACKUP_REMINDER_AFTER_MS = 30 * MS_PER_DAY

/** Without any backup yet, remind this long after the install. */
const FIRST_BACKUP_REMINDER_AFTER_MS = 7 * MS_PER_DAY

/** Counts the transactions, recurring items and quick adds that use a category (before deleting it). */
export function categoryUsage(data: AppData, categoryId: string): CategoryUsage {
  const uses = (records: readonly { categoryId: string | null }[]): number =>
    records.reduce((count, record) => (record.categoryId === categoryId ? count + 1 : count), 0)
  return {
    transactions: uses(data.transactions),
    recurring: uses(data.recurring),
    quickAdds: uses(data.quickAdds),
  }
}

/**
 * Categories by `order`, without archived ones unless asked. The kind filter keeps that kind
 * plus 'both'. Returns a new array of the existing category objects; equal orders keep their
 * array order.
 */
export function sortedCategories(
  categories: readonly Category[],
  o: { includeArchived?: boolean; kind?: 'fixed' | 'daily' } = {},
): Category[] {
  const { includeArchived = false, kind } = o
  return categories
    .filter(
      (category) =>
        (includeArchived || !category.archived) &&
        (kind === undefined || category.kind === kind || category.kind === 'both'),
    )
    .toSorted((a, b) => a.order - b.order)
}

/**
 * The category's name, icon and colour, or UNCATEGORIZED_DISPLAY when `id` is null or names no
 * category in `map` (looked up with Object.hasOwn, so 'constructor' finds nothing). Returns the
 * category object itself or the frozen constant, never a new object, so results stay stable
 * between renders.
 */
export function categoryDisplay(id: string | null, map: Readonly<Record<string, Category>>): CategoryDisplay {
  if (id === null || !Object.hasOwn(map, id)) return UNCATEGORIZED_DISPLAY
  return map[id] ?? UNCATEGORIZED_DISPLAY
}

/**
 * Category of the most recently created expense whose category exists and is not archived,
 * skipping the onboarding "Before On a Budget" entry; null when there is none. Of expenses
 * created in the same millisecond, the one later in the list counts as the more recent.
 */
export function lastUsedCategoryId(data: AppData): string | null {
  const active = new Set(data.categories.filter((category) => !category.archived).map(({ id }) => id))
  let latest: Transaction | null = null
  for (const tx of data.transactions) {
    if (tx.kind !== 'expense' || tx.note === BEFORE_APP_NOTE) continue
    if (tx.categoryId === null || !active.has(tx.categoryId)) continue
    if (latest === null || tx.createdAt >= latest.createdAt) latest = tx
  }
  return latest?.categoryId ?? null
}

/**
 * True once there is something to lose (at least 10 transactions and recurring items together)
 * and no backup for more than 30 days, or, with no backup ever, more than 7 days after the
 * install. Drives the reminder dot on the You tab and the Backup row.
 */
export function needsBackupReminder(data: AppData, now: number): boolean {
  if (data.transactions.length + data.recurring.length < BACKUP_REMINDER_MIN_RECORDS) return false
  const { lastBackupAt, createdAt } = data.settings
  return lastBackupAt === null
    ? now - createdAt > FIRST_BACKUP_REMINDER_AFTER_MS
    : now - lastBackupAt > BACKUP_REMINDER_AFTER_MS
}

/**
 * The earliest period with data: the earliest of the install date's period, the earliest
 * transaction's period and the earliest recurring startMonth; never after the period that
 * contains `today`. The month picker and the trend charts start here.
 */
export function firstPeriod(data: AppData, today: ISODate): MonthKey {
  const startDay = data.settings.monthStartDay
  let first = minMonth(periodOf(today, startDay), periodOf(localDateOf(data.settings.createdAt), startDay))

  let earliestDate: ISODate | null = null
  for (const { date } of data.transactions) {
    if (earliestDate === null || compareISO(date, earliestDate) < 0) earliestDate = date
  }
  if (earliestDate !== null) first = minMonth(first, periodOf(earliestDate, startDay))

  for (const { startMonth } of data.recurring) first = minMonth(first, startMonth)
  return first
}

/**
 * The colour for a new category: the first in CATEGORY_COLORS order that no active category
 * uses, else the one active categories use least (the earlier one on a tie). Archived
 * categories do not count.
 */
export function nextFreeCategoryColor(categories: readonly Category[]): CategoryColor {
  const uses = new Map<CategoryColor, number>()
  for (const { color, archived } of categories) {
    if (!archived) uses.set(color, (uses.get(color) ?? 0) + 1)
  }
  let choice: CategoryColor = 'blue'
  let fewest = Number.POSITIVE_INFINITY
  for (const { key } of CATEGORY_COLORS) {
    const count = uses.get(key) ?? 0
    if (count < fewest) {
      choice = key
      fewest = count
    }
  }
  return choice
}

// ---------------------------------------------------------------------------------------------
// Category symbols

const ICON_KEYS: ReadonlySet<string> = new Set(CATEGORY_ICONS.map(({ key }) => key))

/** True when `icon` is a CATEGORY_ICONS key (a Phosphor icon) rather than an emoji. */
export function isIconKey(icon: IconRef): boolean {
  return ICON_KEYS.has(icon)
}

/** Every engine the app supports has Intl.Segmenter (Safari since 14.1); null where it is missing. */
const GRAPHEME_SEGMENTER: Intl.Segmenter | null =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null

/**
 * The user-perceived characters (grapheme clusters) of `text`: '👩‍💻', '👍🏽' and '🇩🇪' are one
 * each. Without Intl.Segmenter it falls back to code points, which split such sequences.
 */
export function splitGraphemes(text: string): string[] {
  if (GRAPHEME_SEGMENTER === null) return Array.from(text)
  return Array.from(GRAPHEME_SEGMENTER.segment(text), ({ segment }) => segment)
}

/**
 * Longer than any single emoji: the longest, kisses with two skin tones (👩🏻‍❤️‍💋‍👨🏼), take 15
 * UTF-16 code units. It bounds the work spent on hostile input before segmenting it.
 */
const MAX_EMOJI_LENGTH = 32

/** What every emoji starts with: a symbol (😀, ♥, €, 🇩🇪) or a punctuation mark (#️⃣, ‼️). */
const SYMBOL_START = /^[\p{S}\p{P}]/u

/** Letters and digits make text, not a symbol (this also rules out 1️⃣ and ℹ️). */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/**
 * True when `value` is one emoji as the app accepts it: exactly one user-perceived character that
 * starts with a symbol or punctuation mark and holds no letter or digit, such as 😀, 👍🏽, 🇩🇪,
 * 👩‍💻, ❤️‍🔥, #️⃣, ♥ or €. Rejects letters, digits, whitespace, invisible characters and anything
 * longer than one character. This is the Emoji tab's input rule (§5.8: one grapheme, no letters
 * or digits), so whatever a picker accepts survives normalisation; pickers should test with it.
 */
export function isEmoji(value: string): boolean {
  return (
    value.length <= MAX_EMOJI_LENGTH &&
    SYMBOL_START.test(value) &&
    !LETTER_OR_DIGIT.test(value) &&
    splitGraphemes(value).length === 1
  )
}

/** True for a valid category or quick-add symbol: a CATEGORY_ICONS key or a single emoji. */
export function isIconRef(value: unknown): value is IconRef {
  return typeof value === 'string' && (isIconKey(value) || isEmoji(value))
}
