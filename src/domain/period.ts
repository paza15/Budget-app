import { MAX_MONTH_START_DAY } from '@/domain/constants'
import {
  addMonths,
  dateLocaleFor,
  daysInMonth,
  diffDays,
  formatDate,
  formatMonthKey,
  monthName,
  parseISODate,
  parseMonthKey,
  toISODate,
  toMonthKey,
} from '@/domain/dates'
import type { ISODate, MonthKey } from '@/domain/types'

/**
 * Budget periods (docs/SPEC.md §4.3). Period 'YYYY-MM' starts on day `startDay` (1..28) of that
 * month and ends the day before the same day of the next month, inclusive. With startDay 25,
 * '2026-10' runs from 2026-10-25 to 2026-11-24. Never assume calendar months.
 *
 * Every function taking a start day throws a RangeError unless it is a whole number 1..28, except
 * formatPeriodName: a period's name is the same for every start day.
 */

/** Inclusive first and last day of a period. */
export interface PeriodRange {
  start: ISODate
  end: ISODate
}

/** past: the period ended before today; future: it starts after today; else current. */
export type PeriodTiming = 'past' | 'current' | 'future'

/** Between the two ends of a date range: space, en dash (U+2013), space. */
const RANGE_SEPARATOR = ' \u2013 '

function assertStartDay(startDay: number): void {
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > MAX_MONTH_START_DAY) {
    throw new RangeError(`Month start day must be a whole number 1..${MAX_MONTH_START_DAY}: ${startDay}`)
  }
}

/** start = YYYY-MM-startDay; end = start + 1 month − 1 day. ('2026-12', 25) → 2026-12-25 … 2027-01-24. */
export function periodRange(month: MonthKey, startDay: number): PeriodRange {
  assertStartDay(startDay)
  const { y, m } = parseMonthKey(month)
  const start = toISODate(y, m, startDay)
  // The day before the next period starts: the month's last day when periods start on the 1st,
  // else day startDay − 1 of the next month (1..27, which every month has).
  if (startDay === 1) return { start, end: toISODate(y, m, daysInMonth(y, m)) }
  return { start, end: m === 12 ? toISODate(y + 1, 1, startDay - 1) : toISODate(y, m + 1, startDay - 1) }
}

/** The period a date falls in: day ≥ startDay → the date's month, else the previous month. */
export function periodOf(date: ISODate, startDay: number): MonthKey {
  assertStartDay(startDay)
  const { y, m, d } = parseISODate(date)
  const month = toMonthKey(y, m)
  return d >= startDay ? month : addMonths(month, -1)
}

/**
 * Inclusive length of the period in days. It always equals the length of the month the period
 * starts in: '2027-01' with start day 28 has 31 days, '2027-02' has 28.
 */
export function periodDays(month: MonthKey, startDay: number): number {
  const { start, end } = periodRange(month, startDay)
  return diffDays(start, end) + 1
}

/** 1-based position of a date in the period, or null outside it. */
export function dayIndexInPeriod(date: ISODate, month: MonthKey, startDay: number): number | null {
  const { start, end } = periodRange(month, startDay)
  const index = diffDays(start, date) + 1
  return index >= 1 && index <= diffDays(start, end) + 1 ? index : null
}

/** past when the period ends before today, future when it starts after today, else current. */
export function periodTiming(month: MonthKey, today: ISODate, startDay: number): PeriodTiming {
  const { start, end } = periodRange(month, startDay)
  if (diffDays(end, today) > 0) return 'past'
  if (diffDays(today, start) > 0) return 'future'
  return 'current'
}

/** Days left including today: current → days − dayIndex + 1; past → 0; future → days. */
export function daysLeftInPeriod(month: MonthKey, today: ISODate, startDay: number): number {
  const { start, end } = periodRange(month, startDay)
  const untilEnd = diffDays(today, end)
  if (untilEnd < 0) return 0
  if (diffDays(start, today) < 0) return diffDays(start, end) + 1
  // days − dayIndex + 1 = (end − start + 1) − (today − start + 1) + 1 = end − today + 1
  return untilEnd + 1
}

/** start ≤ date ≤ end, both inclusive. */
export function isDateInPeriod(date: ISODate, month: MonthKey, startDay: number): boolean {
  return dayIndexInPeriod(date, month, startDay) !== null
}

// ---------------------------------------------------------------------------------------------
// Names and labels (fixed English names, §4.2)

/** Appends a year in the label's date order: en-GB "24 Nov 2026", en-US "Nov 24, 2026". */
function withYear(text: string, year: number, numberLocale: string): string {
  return dateLocaleFor(numberLocale) === 'en-US' ? `${text}, ${year}` : `${text} ${year}`
}

/** "25 Oct – 24 Nov" / "Oct 25 – Nov 24", or with both years when the range crosses New Year. */
function rangeText(range: PeriodRange, numberLocale: string): { text: string; year: number | null } {
  const startYear = parseISODate(range.start).y
  const endYear = parseISODate(range.end).y
  const start = formatDate(range.start, numberLocale, 'short')
  const end = formatDate(range.end, numberLocale, 'short')
  if (startYear === endYear) return { text: `${start}${RANGE_SEPARATOR}${end}`, year: startYear }
  const text = `${withYear(start, startYear, numberLocale)}${RANGE_SEPARATOR}${withYear(end, endYear, numberLocale)}`
  return { text, year: null }
}

/**
 * The period's name, after the month it starts in: "October" (default), "October 2026" with
 * `withYear`, "Oct 2026" with `style: 'short'`. The name is the same for every start day and date
 * order; the parameters keep the signature in line with formatPeriodRange and formatPeriodLabel.
 */
export function formatPeriodName(
  month: MonthKey,
  _startDay: number,
  numberLocale: string,
  o: { withYear?: boolean; style?: 'long' | 'short' } = {},
): string {
  const style = o.style ?? 'long'
  if (o.withYear === true) return formatMonthKey(month, numberLocale, style)
  return monthName(parseMonthKey(month).m, style)
}

/**
 * null when startDay is 1 (the name says it all); else en-GB "25 Oct – 24 Nov", en-US "Oct 25 –
 * Nov 24"; across New Year with years: "25 Dec 2026 – 24 Jan 2027" / "Dec 25, 2026 – Jan 24, 2027".
 */
export function formatPeriodRange(month: MonthKey, startDay: number, numberLocale: string): string | null {
  if (startDay === 1) return null
  return rangeText(periodRange(month, startDay), numberLocale).text
}

/**
 * One unambiguous string: "October 2026" when startDay is 1; else the range with its year,
 * "25 Oct – 24 Nov 2026" / "Oct 25 – Nov 24, 2026", or across New Year "25 Dec 2026 – 24 Jan 2027".
 */
export function formatPeriodLabel(month: MonthKey, startDay: number, numberLocale: string): string {
  if (startDay === 1) return formatMonthKey(month, numberLocale)
  return formatPeriodDates(month, startDay, numberLocale)
}

/**
 * The period's first and last day with the year, for every start day (the review's subtitle,
 * docs/design/EXTRAS.md §1.1): "1 Oct – 31 Oct 2026" / "Oct 1 – Oct 31, 2026" when startDay is 1;
 * else the same as formatPeriodLabel, "25 Oct – 24 Nov 2026", and across New Year with both years,
 * "25 Dec 2026 – 24 Jan 2027" / "Dec 25, 2026 – Jan 24, 2027".
 */
export function formatPeriodDates(month: MonthKey, startDay: number, numberLocale: string): string {
  const { text, year } = rangeText(periodRange(month, startDay), numberLocale)
  return year === null ? text : withYear(text, year, numberLocale)
}

/**
 * The period's name as titles and sentences write it (the month switcher, "in {name}"): its
 * formatPeriodName, with the year only when the period starts in another year than `currentMonth`,
 * the period the name is read against (usually today's): "October", "January 2027".
 */
export function formatPeriodTitle(month: MonthKey, currentMonth: MonthKey, startDay: number, numberLocale: string): string {
  assertStartDay(startDay)
  const otherYear = parseMonthKey(month).y !== parseMonthKey(currentMonth).y
  return formatPeriodName(month, startDay, numberLocale, { withYear: otherYear })
}

/**
 * Months to add to a recurring item's period keys when the start day changes from `from` to `to`,
 * so each charge keeps its due date: Δ = (d < from ? 1 : 0) − (d < to ? 1 : 0), d = dueDay ?? from.
 * A due day before the start day falls in the calendar month after the period's key; when that
 * changes with the start day, the key moves by one month to keep the same date. Items without a
 * due day count as due on the old start day.
 */
export function shiftForStartDayChange(dueDay: number | null, from: number, to: number): -1 | 0 | 1 {
  assertStartDay(from)
  assertStartDay(to)
  const day = dueDay ?? from
  const nextMonthBefore = day < from
  const nextMonthAfter = day < to
  if (nextMonthBefore === nextMonthAfter) return 0
  return nextMonthBefore ? 1 : -1
}
