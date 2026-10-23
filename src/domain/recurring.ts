import {
  addMonths,
  compareISO,
  daysInMonth,
  formatDate,
  maxMonth,
  monthDiff,
  ordinalDay,
  parseISODate,
  parseMonthKey,
  toISODate,
} from '@/domain/dates'
import { formatPeriodName, formatPeriodTitle, periodRange } from '@/domain/period'
import type {
  AmountChange,
  AppData,
  Cents,
  ISODate,
  MonthKey,
  Recurring,
  RecurringOverride,
  TxKind,
} from '@/domain/types'

/**
 * Recurring items: fixed costs and recurring income (docs/SPEC.md §4.4). N = everyMonths; an item
 * is charged every N periods counted from startMonth. Spread items (N > 1) count a share of the
 * charge in every period of the cycle instead of the full amount in the charge period.
 *
 * Period keys compare as strings (four-digit years keep them chronological). Month arithmetic goes
 * through dates.ts and day arithmetic through period.ts.
 */

/** What one recurring item contributes to one period. */
export interface RecurringLine {
  recurring: Recurring
  month: MonthKey
  /** Counted in this period: 0 when skipped; spread items count their share of the cycle. */
  amount: Cents
  /** What the schedule gives this period before any override (after spreading). */
  scheduledAmount: Cents
  /** Spread items: the cycle's full charge (override amount, else base). Others: the base amount. */
  fullAmount: Cents
  skipped: boolean
  /** Ticked off as paid or received. Only charge lines can be paid. */
  paid: boolean
  /** An amount override applies to this period. */
  overridden: boolean
  /** This is the period the item is charged in (always true for monthly items). */
  isChargeMonth: boolean
  /** Due date in a charge period when dueDay is set, else null. */
  dueDate: ISODate | null
}

/** The intervals an item may repeat at; normalizeRecurring turns anything else into monthly. */
const EVERY_MONTHS: ReadonlySet<number> = new Set([1, 2, 3, 6, 12])

/**
 * Name tie-break in line order: ignores case and accents and compares numbers by value ("Gym 2"
 * before "Gym 10"). A fixed locale keeps the order the same on every device.
 */
const NAME_ORDER = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/** mod(a, n) = ((a % n) + n) % n: the remainder in 0..n−1, also for negative a. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/** Counts a share in every period of its cycle: spread on and charged less often than monthly. */
function isSpread(r: Recurring): boolean {
  return r.spread && r.everyMonths > 1
}

/**
 * The override of item `id` in period `month`. Both records are read with Object.hasOwn (§4.7), so
 * an id such as "constructor" never picks up a property of Object.prototype.
 */
function overrideAt(months: AppData['months'], month: MonthKey, id: string): RecurringOverride | undefined {
  if (!Object.hasOwn(months, month)) return undefined
  const overrides = months[month]?.overrides
  if (overrides === undefined || !Object.hasOwn(overrides, id)) return undefined
  return overrides[id]
}

/**
 * One period's part of a cycle's charge: floor(total / N) in every period, and the remainder on
 * top in the charge period, so the N parts add up to the total exactly.
 */
function cycleShare(total: Cents, everyMonths: number, isChargePeriod: boolean): Cents {
  const share = Math.floor(total / everyMonths)
  return isChargePeriod ? total - (everyMonths - 1) * share : share
}

/** startMonth ≤ month and (no endMonth or month ≤ endMonth). */
export function isInRange(r: Recurring, month: MonthKey): boolean {
  if (compareISO(month, r.startMonth) < 0) return false
  return r.endMonth === null || compareISO(month, r.endMonth) <= 0
}

/**
 * In range, and a whole number of cycles after startMonth. The range check comes first: a month
 * before startMonth is never a charge month, however it lines up with the cycle.
 */
export function isChargeMonth(r: Recurring, month: MonthKey): boolean {
  return isInRange(r, month) && mod(monthDiff(r.startMonth, month), r.everyMonths) === 0
}

/** The charge period of the cycle containing `month`, or null when out of range. */
export function chargePeriodOf(r: Recurring, month: MonthKey): MonthKey | null {
  if (!isInRange(r, month)) return null
  const n = r.everyMonths
  return addMonths(r.startMonth, n * Math.floor(monthDiff(r.startMonth, month) / n))
}

/**
 * Amount of the last amount-history entry with from ≤ month (amounts[0] when none). Throws a
 * RangeError for an item without amounts, which the data contract rules out.
 */
export function baseAmountFor(r: Recurring, month: MonthKey): Cents {
  const change = r.amounts.findLast((entry) => compareISO(entry.from, month) <= 0) ?? r.amounts[0]
  if (change === undefined) throw new RangeError(`Recurring item ${r.id} has no amounts`)
  return change.amount
}

/**
 * Day `dueDay` of period `month`: a day from the start day on falls in the calendar month the period
 * starts in, an earlier day in the next calendar month, where the period ends. Clamped to that
 * month's length, so it always lies inside the period. Throws a RangeError for a start day
 * outside 1..28.
 */
function dueDateIn(month: MonthKey, startDay: number, dueDay: number): ISODate {
  const { start, end } = periodRange(month, startDay)
  const { y, m } = parseISODate(dueDay >= startDay ? start : end)
  return toISODate(y, m, Math.min(dueDay, daysInMonth(y, m)))
}

/**
 * Due date in a charge period with dueDay set: dueDay ≥ startDay → in the period's calendar month,
 * else in the next calendar month, clamped to that month's length. Otherwise null.
 * ('2026-10', start day 25, due on the 1st) → 2026-11-01; ('2027-02', 28, 30th) → 2027-02-28.
 */
export function dueDateFor(r: Recurring, month: MonthKey, startDay: number): ISODate | null {
  if (r.dueDay === null || !isChargeMonth(r, month)) return null
  return dueDateIn(month, startDay, r.dueDay)
}

/**
 * The item's line in a period with overrides applied (§4.4 Lines), or null when it has none.
 *
 * - Not spread (or monthly): a line only in charge periods, with that period's base amount and
 *   override.
 * - Spread: a line in every period in range. The cycle's charge period holds the override and fixes
 *   the base amount for the whole cycle, so an amount change takes effect from the first cycle that
 *   starts at or after it. A cycle cut short by endMonth simply has no lines after endMonth.
 *
 * The line references `r` itself, never a copy.
 */
export function lineFor(
  r: Recurring,
  month: MonthKey,
  months: AppData['months'],
  startDay: number,
): RecurringLine | null {
  const chargePeriod = chargePeriodOf(r, month)
  if (chargePeriod === null) return null
  const isCharge = chargePeriod === month
  const spread = isSpread(r)
  if (!spread && !isCharge) return null

  // For items that are not spread the charge period is `month` itself.
  const override = overrideAt(months, chargePeriod, r.id)
  const base = baseAmountFor(r, chargePeriod)
  const skipped = override?.skipped === true
  const n = r.everyMonths
  const fullAmount = spread ? (override?.amount ?? base) : base
  const charged = spread ? cycleShare(fullAmount, n, isCharge) : (override?.amount ?? base)

  return {
    recurring: r,
    month,
    amount: skipped ? 0 : charged,
    scheduledAmount: spread ? cycleShare(base, n, isCharge) : base,
    fullAmount,
    skipped,
    paid: isCharge && !skipped && override?.paid === true,
    overridden: override?.amount !== undefined,
    isChargeMonth: isCharge,
    dueDate: isCharge && r.dueDay !== null ? dueDateIn(month, startDay, r.dueDay) : null,
  }
}

/**
 * Line order of linesFor and upcomingFixed: by dueDate (lines without one last), then the item's
 * `order`, then its name.
 */
export function compareLines(a: RecurringLine, b: RecurringLine): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return compareISO(a.dueDate, b.dueDate)
  }
  return a.recurring.order - b.recurring.order || NAME_ORDER.compare(a.recurring.name, b.recurring.name)
}

/** Lines of all items of one kind, sorted by dueDate (nulls last), then order, then name. */
export function linesFor(
  items: readonly Recurring[],
  kind: TxKind,
  month: MonthKey,
  months: AppData['months'],
  startDay: number,
): RecurringLine[] {
  const lines: RecurringLine[] = []
  for (const r of items) {
    if (r.kind !== kind) continue
    const line = lineFor(r, month, months, startDay)
    if (line !== null) lines.push(line)
  }
  return lines.toSorted(compareLines)
}

/**
 * First charge period at or after `from` (and startMonth), or null once the item has ended.
 * { start 2026-03, every 3 months } from 2026-10 → 2026-12; from 2025-01 → 2026-03.
 */
export function nextChargeMonth(r: Recurring, from: MonthKey): MonthKey | null {
  const first = maxMonth(from, r.startMonth)
  const next = addMonths(first, mod(-monthDiff(r.startMonth, first), r.everyMonths))
  return r.endMonth === null || compareISO(next, r.endMonth) <= 0 ? next : null
}

/**
 * Subtitle for an item with no line in `month`, first match: "Starts {name}" before startMonth,
 * "Ended {name}" after endMonth, "Next: {due date or name}" for the next charge, else "No more
 * charges, ends {name}". Names carry their year when it differs from `month`'s; the next charge is
 * always within a year, so its name never needs one.
 */
export function notThisMonthLabel(r: Recurring, month: MonthKey, startDay: number, numberLocale: string): string {
  if (compareISO(month, r.startMonth) < 0) {
    return `Starts ${formatPeriodTitle(r.startMonth, month, startDay, numberLocale)}`
  }
  if (r.endMonth !== null && compareISO(month, r.endMonth) > 0) {
    return `Ended ${formatPeriodTitle(r.endMonth, month, startDay, numberLocale)}`
  }
  const next = nextChargeMonth(r, month)
  if (next === null) {
    // nextChargeMonth is null only when the next charge would fall after endMonth.
    return `No more charges, ends ${formatPeriodTitle(r.endMonth ?? month, month, startDay, numberLocale)}`
  }
  const due = dueDateFor(r, next, startDay)
  const when = due === null ? formatPeriodName(next, startDay, numberLocale) : formatDate(due, numberLocale, 'medium')
  return `Next: ${when}`
}

/**
 * Schedule subtitle of a Fixed row (§3.5): "Due on the 1st", "Yearly in March",
 * "Every 6 months, March and September", "Every 3 months, next in December".
 *
 * - Monthly: "Due on the {day}" ("Arrives on the {day}" for income), or "Monthly" without a due day.
 * - Yearly and every 6 months: the months of the year it is charged in, by period name.
 * - Every 2 or 3 months: the first charge period after `month`, or "ends {name}" when the item
 *   ends before another charge.
 */
export function scheduleLabel(r: Recurring, month: MonthKey, startDay: number, numberLocale: string): string {
  const name = (key: MonthKey): string => formatPeriodName(key, startDay, numberLocale)
  switch (r.everyMonths) {
    case 1:
      if (r.dueDay === null) return 'Monthly'
      return `${r.kind === 'income' ? 'Arrives' : 'Due'} on the ${ordinalDay(r.dueDay)}`
    case 12:
      return `Yearly in ${name(r.startMonth)}`
    case 6: {
      const other = addMonths(r.startMonth, 6)
      const startsFirst = parseMonthKey(r.startMonth).m < parseMonthKey(other).m
      const [early, late] = startsFirst ? [r.startMonth, other] : [other, r.startMonth]
      return `Every 6 months, ${name(early)} and ${name(late)}`
    }
    default: {
      // Every 2 or 3 months.
      const next = nextChargeMonth(r, addMonths(month, 1))
      if (next !== null) return `Every ${r.everyMonths} months, next in ${name(next)}`
      // As in notThisMonthLabel: no next charge means the item ends first.
      const end = r.endMonth ?? month
      return `Every ${r.everyMonths} months, ends ${formatPeriodTitle(end, month, startDay, numberLocale)}`
    }
  }
}

/** The item with `amount` applying from period `from` onward, normalised. */
export function withAmountFrom(r: Recurring, amount: Cents, from: MonthKey): Recurring {
  const before = r.amounts.filter((entry) => compareISO(entry.from, from) < 0)
  return normalizeRecurring({ ...r, amounts: [...before, { from: maxMonth(from, r.startMonth), amount }] })
}

/**
 * Steps 1–4 of §4.4 normalisation: sort by `from` keeping the last of equal `from`s, anchor the
 * first entry at startMonth with the amount in force there, drop entries after endMonth, and merge
 * consecutive equal amounts (keeping the earlier). Existing entries are reused, not copied.
 */
function normalizeAmounts(
  amounts: readonly AmountChange[],
  startMonth: MonthKey,
  endMonth: MonthKey | null,
): AmountChange[] {
  // toSorted is stable, so among equal `from`s the last in the input stays last.
  const sorted = amounts.toSorted((a, b) => compareISO(a.from, b.from))
  const unique = sorted.filter((entry, i) => sorted[i + 1]?.from !== entry.from)

  const anchor = unique.findLast((entry) => compareISO(entry.from, startMonth) <= 0) ?? unique[0]
  if (anchor === undefined) throw new RangeError('A recurring item needs at least one amount')
  const first = anchor.from === startMonth ? anchor : { from: startMonth, amount: anchor.amount }
  const later = unique.filter(
    (entry) =>
      compareISO(entry.from, startMonth) > 0 && (endMonth === null || compareISO(entry.from, endMonth) <= 0),
  )

  const steps = [first, ...later]
  return steps.filter((entry, i) => i === 0 || steps[i - 1]?.amount !== entry.amount)
}

function sameAmounts(a: readonly AmountChange[], b: readonly AmountChange[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry.from === b[i]?.from && entry.amount === b[i]?.amount)
}

/**
 * Repairs the amount history, range, interval, spread flag and income category (§4.4):
 * 1. amounts sorted by `from`, the last of equal `from`s kept;
 * 2. the first entry moved to startMonth with the amount in force there;
 * 3. entries after endMonth dropped;
 * 4. consecutive equal amounts merged;
 * 5. endMonth before startMonth → startMonth; an unknown interval → monthly; spread only when
 *    N > 1; income has no category.
 * Step 3 only drops changes after startMonth, so the entry at startMonth always remains, also when
 * endMonth was before startMonth. Returns `r` itself when it is already normal. Throws a RangeError
 * when `amounts` is empty.
 */
export function normalizeRecurring(r: Recurring): Recurring {
  const endMonth = r.endMonth !== null && compareISO(r.endMonth, r.startMonth) < 0 ? r.startMonth : r.endMonth
  const everyMonths = EVERY_MONTHS.has(r.everyMonths) ? r.everyMonths : 1
  const spread = r.spread && everyMonths > 1
  const categoryId = r.kind === 'income' ? null : r.categoryId
  const amounts = normalizeAmounts(r.amounts, r.startMonth, endMonth)

  const unchanged =
    endMonth === r.endMonth &&
    everyMonths === r.everyMonths &&
    spread === r.spread &&
    categoryId === r.categoryId &&
    sameAmounts(amounts, r.amounts)
  return unchanged ? r : { ...r, amounts, everyMonths, spread, endMonth, categoryId }
}

/** Math.round(baseAmountFor(r, month) / everyMonths), for display only. */
export function monthlyEquivalent(r: Recurring, month: MonthKey): Cents {
  return Math.round(baseAmountFor(r, month) / r.everyMonths)
}
