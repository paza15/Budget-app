import type { ISODate, MonthKey } from '@/domain/types'

/**
 * Calendar dates (docs/SPEC.md §4.2). The only module that builds ISODate and MonthKey values.
 * Dates are local 'YYYY-MM-DD' strings from getFullYear/getMonth/getDate: never
 * `new Date('YYYY-MM-DD')` (parsed as UTC) and never toISOString(). Day differences use Date.UTC
 * midnights so DST never makes a day 23 or 25 hours long. Labels use fixed English month and
 * weekday names (never Intl.DateTimeFormat), ordered like dateLocaleFor(numberLocale).
 */

const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 60 * MS_PER_MINUTE
const MS_PER_DAY = 24 * MS_PER_HOUR

/** Years isValidISODate and isValidMonthKey accept from outside (storage, backups, inputs). */
const FIRST_VALID_YEAR = 1900
const LAST_VALID_YEAR = 2999

/**
 * Years the arithmetic works with: wider than the valid range, so stepping just past it (the
 * period of 1900-01-03 with start day 25 is '1899-12') never throws. Four digits keep string
 * order chronological, and Date.UTC would read years 0–99 as 1900–1999.
 */
const FIRST_YEAR = 1000
const LAST_YEAR = 9999

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** Indexed by weekday(), 0 = Sunday. */
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

// ---------------------------------------------------------------------------------------------
// Construction and validation

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function isYear(y: number): boolean {
  return Number.isInteger(y) && y >= FIRST_YEAR && y <= LAST_YEAR
}

function isMonth(m: number): boolean {
  return Number.isInteger(m) && m >= 1 && m <= 12
}

function isCalendarDate(y: number, m: number, d: number): boolean {
  return isYear(y) && isMonth(m) && Number.isInteger(d) && d >= 1 && d <= daysInMonth(y, m)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Builds a date from year, month 1..12 and day. Throws a RangeError unless it is a real calendar day. */
export function toISODate(y: number, m: number, d: number): ISODate {
  if (!isCalendarDate(y, m, d)) throw new RangeError(`Not a calendar date: ${y}-${m}-${d}`)
  return `${y}-${pad2(m)}-${pad2(d)}` as ISODate
}

/** Builds a month key from year and month 1..12. Throws a RangeError for any other month. */
export function toMonthKey(y: number, m: number): MonthKey {
  if (!isYear(y) || !isMonth(m)) throw new RangeError(`Not a month: ${y}-${m}`)
  return `${y}-${pad2(m)}` as MonthKey
}

/** The numbers of a well-formed real calendar date, or null. */
function matchISODate(s: unknown): { y: number; m: number; d: number } | null {
  if (typeof s !== 'string') return null
  const match = ISO_DATE_PATTERN.exec(s)
  if (match === null) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  return isCalendarDate(y, m, d) ? { y, m, d } : null
}

/** The numbers of a well-formed month key, or null. */
function matchMonthKey(s: unknown): { y: number; m: number } | null {
  if (typeof s !== 'string') return null
  const match = MONTH_KEY_PATTERN.exec(s)
  if (match === null) return null
  const y = Number(match[1])
  const m = Number(match[2])
  return isYear(y) && isMonth(m) ? { y, m } : null
}

/** Splits a date into numbers (month 1..12). Throws a RangeError on an invalid date. */
export function parseISODate(s: ISODate): { y: number; m: number; d: number } {
  const parts = matchISODate(s)
  if (parts === null) throw new RangeError(`Not a date: ${String(s)}`)
  return parts
}

/** Splits a month key into numbers (month 1..12). Throws a RangeError on an invalid key. */
export function parseMonthKey(key: MonthKey): { y: number; m: number } {
  const parts = matchMonthKey(key)
  if (parts === null) throw new RangeError(`Not a month: ${String(key)}`)
  return parts
}

/** True for a 'YYYY-MM-DD' string naming a real calendar day in the years 1900..2999. */
export function isValidISODate(s: unknown): s is ISODate {
  const parts = matchISODate(s)
  return parts !== null && parts.y >= FIRST_VALID_YEAR && parts.y <= LAST_VALID_YEAR
}

/** True for a 'YYYY-MM' string with a month 01..12 in the years 1900..2999. */
export function isValidMonthKey(s: unknown): s is MonthKey {
  const parts = matchMonthKey(s)
  return parts !== null && parts.y >= FIRST_VALID_YEAR && parts.y <= LAST_VALID_YEAR
}

/** Number of days in month m (1..12) of year y, leap years included. Throws a RangeError for other m. */
export function daysInMonth(y: number, m: number): number {
  const days = DAYS_IN_MONTH[m - 1]
  if (days === undefined) throw new RangeError(`Not a month: ${m}`)
  return m === 2 && isLeapYear(y) ? 29 : days
}

// ---------------------------------------------------------------------------------------------
// Day arithmetic

/** Days since 1970-01-01, counted between UTC midnights so DST never shortens or stretches a day. */
function dayNumber(date: ISODate): number {
  const { y, m, d } = parseISODate(date)
  return Date.UTC(y, m - 1, d) / MS_PER_DAY
}

function fromDayNumber(day: number): ISODate {
  const utc = new Date(day * MS_PER_DAY)
  return toISODate(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate())
}

function assertWholeNumber(n: number, what: string): void {
  if (!Number.isInteger(n)) throw new RangeError(`Not a whole number of ${what}: ${n}`)
}

/** Today's local date (or that of `now`). */
export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** The local calendar date of an epoch-ms timestamp. */
export function localDateOf(epochMs: number): ISODate {
  return todayISO(new Date(epochMs))
}

/** The date n days later (n may be negative). */
export function addDays(date: ISODate, n: number): ISODate {
  assertWholeNumber(n, 'days')
  return fromDayNumber(dayNumber(date) + n)
}

/** Whole days from `from` to `to` (to − from), unaffected by DST. */
export function diffDays(from: ISODate, to: ISODate): number {
  return dayNumber(to) - dayNumber(from)
}

/** Comparator for ISODate or MonthKey strings: negative, 0 or positive. */
export function compareISO(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

/** Day of the week, 0 = Sunday. */
export function weekday(date: ISODate): number {
  const { y, m, d } = parseISODate(date)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

// ---------------------------------------------------------------------------------------------
// Month arithmetic

/** Months since year 0, so that month keys can be added and subtracted. */
function monthIndex(key: MonthKey): number {
  const { y, m } = parseMonthKey(key)
  return y * 12 + m - 1
}

/** The calendar month of a date ('2026-10-14' → '2026-10'). Not its budget period; see period.ts. */
export function monthKeyOf(date: ISODate): MonthKey {
  const { y, m } = parseISODate(date)
  return toMonthKey(y, m)
}

/** The month n months later (n may be negative). */
export function addMonths(key: MonthKey, n: number): MonthKey {
  assertWholeNumber(n, 'months')
  const index = monthIndex(key) + n
  return toMonthKey(Math.floor(index / 12), (index % 12) + 1)
}

/** Whole months from `from` to `to` (to − from). */
export function monthDiff(from: MonthKey, to: MonthKey): number {
  return monthIndex(to) - monthIndex(from)
}

/** The later of two months. */
export function maxMonth(a: MonthKey, b: MonthKey): MonthKey {
  return compareISO(a, b) >= 0 ? a : b
}

/** The earlier of two months. */
export function minMonth(a: MonthKey, b: MonthKey): MonthKey {
  return compareISO(a, b) <= 0 ? a : b
}

// ---------------------------------------------------------------------------------------------
// Labels

/** Date order for labels: 'en-US' when the number locale is en-US, else 'en-GB'. */
export function dateLocaleFor(numberLocale: string): 'en-US' | 'en-GB' {
  return numberLocale.toLowerCase() === 'en-us' ? 'en-US' : 'en-GB'
}

/** English name of month m (1..12): long "September", short "Sep". */
export function monthName(m: number, style: 'long' | 'short' = 'long'): string {
  const name = MONTH_NAMES[m - 1]
  if (name === undefined) throw new RangeError(`Not a month: ${m}`)
  return style === 'long' ? name : name.slice(0, 3)
}

/** English name of a weekday (0 = Sunday): long "Wednesday", short "Wed". */
function weekdayName(day: number, style: 'long' | 'short'): string {
  const name = WEEKDAY_NAMES[day]
  if (name === undefined) throw new RangeError(`Not a weekday: ${day}`)
  return style === 'long' ? name : name.slice(0, 3)
}

/**
 * short "14 Oct" / "Oct 14"; medium (default) "Wed 14 Oct" / "Wed, Oct 14";
 * long "Wednesday 14 October 2026" / "Wednesday, October 14, 2026". en-GB order unless the
 * number locale is en-US.
 */
export function formatDate(date: ISODate, numberLocale: string, style: 'short' | 'medium' | 'long' = 'medium'): string {
  const { y, m, d } = parseISODate(date)
  const us = dateLocaleFor(numberLocale) === 'en-US'
  if (style === 'long') {
    const day = weekdayName(weekday(date), 'long')
    const month = monthName(m, 'long')
    return us ? `${day}, ${month} ${d}, ${y}` : `${day} ${d} ${month} ${y}`
  }
  const short = us ? `${monthName(m, 'short')} ${d}` : `${d} ${monthName(m, 'short')}`
  if (style === 'short') return short
  const day = weekdayName(weekday(date), 'short')
  return us ? `${day}, ${short}` : `${day} ${short}`
}

/** "Today", "Yesterday", else the medium date. */
export function formatDayLabel(date: ISODate, today: ISODate, numberLocale: string): string {
  const daysAgo = diffDays(date, today)
  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  return formatDate(date, numberLocale, 'medium')
}

/** "Today", "Tomorrow", "In N days" (2–6), else the medium date (also for past dates). */
export function formatRelativeDue(date: ISODate, today: ISODate, numberLocale: string): string {
  const daysAhead = diffDays(today, date)
  if (daysAhead === 0) return 'Today'
  if (daysAhead === 1) return 'Tomorrow'
  if (daysAhead >= 2 && daysAhead <= 6) return `In ${daysAhead} days`
  return formatDate(date, numberLocale, 'medium')
}

/** long (default) "October 2026", short "Oct 2026". Both date orders write months the same way. */
export function formatMonthKey(key: MonthKey, _numberLocale: string, style: 'long' | 'short' = 'long'): string {
  const { y, m } = parseMonthKey(key)
  return `${monthName(m, style)} ${y}`
}

/** "1 hour ago", "2 hours ago". */
function ago(count: number, unit: 'minute' | 'hour' | 'day' | 'month'): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}

/**
 * How long ago `epochMs` was at `nowMs`: "just now" (under a minute, or in the future), "N minutes
 * ago" (under an hour), "N hours ago" (under 24 hours), then by local calendar days: "yesterday",
 * "N days ago" (under 30), "N months ago" (30-day months, under 365 days), "over a year ago".
 * Singular forms read "1 minute ago", "1 hour ago", "1 month ago".
 */
export function formatRelativeTime(epochMs: number, nowMs: number): string {
  const elapsed = nowMs - epochMs
  if (elapsed < MS_PER_MINUTE) return 'just now'
  if (elapsed < MS_PER_HOUR) return ago(Math.floor(elapsed / MS_PER_MINUTE), 'minute')

  const days = diffDays(localDateOf(epochMs), localDateOf(nowMs))
  // A 25-hour DST day can hold 24 elapsed hours within one calendar day.
  if (elapsed < MS_PER_DAY || days < 1) return ago(Math.floor(elapsed / MS_PER_HOUR), 'hour')
  if (days === 1) return 'yesterday'
  if (days < 30) return ago(days, 'day')
  if (days < 365) return ago(Math.floor(days / 30), 'month')
  return 'over a year ago'
}

/** English ordinal: 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 22 → "22nd". */
export function ordinalDay(day: number): string {
  const lastTwo = day % 100
  if (lastTwo >= 11 && lastTwo <= 13) return `${day}th`
  switch (day % 10) {
    case 1:
      return `${day}st`
    case 2:
      return `${day}nd`
    case 3:
      return `${day}rd`
    default:
      return `${day}th`
  }
}
