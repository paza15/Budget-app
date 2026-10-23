import { compareISO } from '@/domain/dates'
import { sumCents } from '@/domain/money'
import { formatPeriodTitle } from '@/domain/period'
import { baseAmountFor, nextChargeMonth, scheduleLabel, type RecurringLine } from '@/domain/recurring'
import { categoryKeyOf, UNCATEGORIZED_ID } from '@/domain/summary'
import type { AppData, Category, Cents, ISODate, MonthKey, Recurring, RecurringOverride, TxKind } from '@/domain/types'

/**
 * What the Fixed screen shows, derived from the month summary and the recurring items (docs/SPEC.md
 * §3.5, §4.4). Pure functions over domain results: every amount comes from the lines that
 * computeMonthSummary built, every label from recurring.ts and period.ts.
 */

/**
 * How sentences refer to the selected period (§3): "this month" for the current one, otherwise
 * "in October" ("in January 2027" in another year).
 */
export function periodPhrase(month: MonthKey, current: MonthKey, startDay: number, locale: string): string {
  return month === current ? 'this month' : `in ${formatPeriodTitle(month, current, startDay, locale)}`
}

export interface PaidCount {
  /** Charge lines ticked off. */
  paid: number
  /** Charge lines that are not skipped: a skipped cost is not due (§3.5). */
  count: number
}

/** "{paid} of {count} paid": only charge lines that are not skipped count. */
export function paidCount(lines: readonly RecurringLine[]): PaidCount {
  let paid = 0
  let count = 0
  for (const line of lines) {
    if (!line.isChargeMonth || line.skipped) continue
    count += 1
    if (line.paid) paid += 1
  }
  return { paid, count }
}

/** A line can be ticked off: it is charged in this period and not skipped. */
export function canTick(line: RecurringLine): boolean {
  return line.isChargeMonth && !line.skipped
}

/**
 * A row subtitle (§3.5): the schedule ("Due on the 1st", "Yearly in March"), "Skipped this month",
 * or for the monthly share of a spread item "Set aside {amount} this month". The last one carries
 * an amount, so the row renders it with the money format (masking included).
 */
export type LineSubtitle = { kind: 'text'; text: string } | { kind: 'setAside'; amount: Cents; phrase: string }

export function lineSubtitle(line: RecurringLine, current: MonthKey, startDay: number, locale: string): LineSubtitle {
  const phrase = periodPhrase(line.month, current, startDay, locale)
  if (line.skipped) return { kind: 'text', text: `Skipped ${phrase}` }
  if (!line.isChargeMonth) return { kind: 'setAside', amount: line.amount, phrase }
  return { kind: 'text', text: scheduleLabel(line.recurring, line.month, startDay, locale) }
}

/** The override of item `id` in period `month`, read with Object.hasOwn (§4.7). */
export function overrideAt(months: AppData['months'], month: MonthKey, id: string): RecurringOverride | undefined {
  if (!Object.hasOwn(months, month)) return undefined
  const overrides = months[month]?.overrides
  return overrides !== undefined && Object.hasOwn(overrides, id) ? overrides[id] : undefined
}

/**
 * The amount a row shows: what the line counts, or for a skipped line what it would have counted
 * (struck through): the period's different amount, else the scheduled amount.
 */
export function rowAmount(line: RecurringLine, months: AppData['months']): Cents {
  if (!line.skipped) return line.amount
  if (line.isChargeMonth && !(line.recurring.spread && line.recurring.everyMonths > 1)) {
    return overrideAt(months, line.month, line.recurring.id)?.amount ?? line.scheduledAmount
  }
  return line.scheduledAmount
}

/** The ids of every category, archived ones included, for categoryKeyOf. */
export function knownCategoryIds(categories: readonly Category[]): ReadonlySet<string> {
  return new Set(categories.map((category) => category.id))
}

/** The category a recurring item is filed under: its own, or Uncategorized for unknown ids (§4.5). */
export function categoryKeyOfItem(r: Recurring, known: ReadonlySet<string>): string {
  return categoryKeyOf(r.categoryId, known)
}

/** Category keys in category order (archived ones in their place), Uncategorized last. */
function orderKeys(keys: ReadonlySet<string>, sortedCategories: readonly Category[]): string[] {
  const ordered = sortedCategories.filter((category) => keys.has(category.id)).map((category) => category.id)
  if (keys.has(UNCATEGORIZED_ID)) ordered.push(UNCATEGORIZED_ID)
  return ordered
}

/**
 * The categories that have fixed costs (the chips of §3.5): every category one or more expense
 * items are filed under, whatever the period, in category order with Uncategorized last.
 * `sortedCategories` holds every category, archived ones included, in order.
 */
export function fixedCategoryKeys(
  recurring: readonly Recurring[],
  sortedCategories: readonly Category[],
  known: ReadonlySet<string>,
): string[] {
  const keys = new Set<string>()
  for (const r of recurring) if (r.kind === 'expense') keys.add(categoryKeyOfItem(r, known))
  return orderKeys(keys, sortedCategories)
}

export interface CategoryGroup {
  /** A category id, or UNCATEGORIZED_ID. */
  key: string
  /** In line order: by due date, then order, then name. */
  lines: RecurringLine[]
  /** What the group's lines count in the period. */
  total: Cents
}

/** Lines grouped under their categories in category order (Uncategorized last), with subtotals. */
export function groupByCategory(
  lines: readonly RecurringLine[],
  sortedCategories: readonly Category[],
  known: ReadonlySet<string>,
): CategoryGroup[] {
  const byKey = new Map<string, RecurringLine[]>()
  for (const line of lines) {
    const key = categoryKeyOfItem(line.recurring, known)
    const group = byKey.get(key)
    if (group === undefined) byKey.set(key, [line])
    else group.push(line)
  }
  return orderKeys(new Set(byKey.keys()), sortedCategories).map((key) => {
    const group = byKey.get(key) ?? []
    return { key, lines: group, total: sumCents(group.map((line) => line.amount)) }
  })
}

/**
 * The "Not this month" items (§3.5): items of `kind` with no line in the period. Upcoming ones
 * first, by the period they are next charged in; then those that are over, the latest end first.
 */
export function itemsWithoutLine(
  recurring: readonly Recurring[],
  kind: TxKind,
  lines: readonly RecurringLine[],
  month: MonthKey,
): Recurring[] {
  const withLine = new Set(lines.map((line) => line.recurring.id))
  const items = recurring.filter((r) => r.kind === kind && !withLine.has(r.id))
  const next = new Map(items.map((r) => [r.id, nextChargeMonth(r, month)]))
  return items.toSorted((a, b) => {
    const nextA = next.get(a.id) ?? null
    const nextB = next.get(b.id) ?? null
    if (nextA !== null && nextB !== null) return compareISO(nextA, nextB) || a.order - b.order
    if (nextA !== null) return -1
    if (nextB !== null) return 1
    return compareISO(b.endMonth ?? b.startMonth, a.endMonth ?? a.startMonth) || a.order - b.order
  })
}

/** The amount shown for an item without a line: its amount at the next charge, or where it ended. */
export function itemAmount(r: Recurring, month: MonthKey): Cents {
  return baseAmountFor(r, nextChargeMonth(r, month) ?? r.endMonth ?? month)
}

/**
 * Where the "Today" divider goes in lines sorted by due date (§3.5): before the first line due
 * today or later (lines without a due date count as still to come). null when no line has a due
 * date, since then the divider would say nothing.
 */
export function todayDividerIndex(lines: readonly RecurringLine[], today: ISODate): number | null {
  if (!lines.some((line) => line.dueDate !== null)) return null
  const index = lines.findIndex((line) => line.dueDate === null || compareISO(line.dueDate, today) >= 0)
  return index === -1 ? lines.length : index
}
