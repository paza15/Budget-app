import { describe, expect, it } from 'vitest'
import { MAX_MONTH_START_DAY } from '@/domain/constants'
import {
  addDays,
  addMonths,
  compareISO,
  daysInMonth,
  diffDays,
  formatDate,
  parseMonthKey,
  toISODate,
  toMonthKey,
} from '@/domain/dates'
import {
  dayIndexInPeriod,
  daysLeftInPeriod,
  formatPeriodDates,
  formatPeriodLabel,
  formatPeriodName,
  formatPeriodRange,
  formatPeriodTitle,
  isDateInPeriod,
  periodDays,
  periodOf,
  periodRange,
  periodTiming,
  shiftForStartDayChange,
} from '@/domain/period'
import type { ISODate, MonthKey } from '@/domain/types'

const START_DAYS = Array.from({ length: MAX_MONTH_START_DAY }, (_, i) => i + 1)

/** Every month key from `first` to `last`, inclusive. */
function monthsBetween(first: MonthKey, last: MonthKey): MonthKey[] {
  const months: MonthKey[] = []
  for (let month = first; compareISO(month, last) <= 0; month = addMonths(month, 1)) months.push(month)
  return months
}

describe('periodRange', () => {
  it.each([
    ['2026-10', 1, '2026-10-01', '2026-10-31'],
    ['2026-02', 1, '2026-02-01', '2026-02-28'],
    ['2028-02', 1, '2028-02-01', '2028-02-29'],
    ['2026-10', 25, '2026-10-25', '2026-11-24'],
    ['2026-12', 25, '2026-12-25', '2027-01-24'],
    ['2026-01', 28, '2026-01-28', '2026-02-27'],
    ['2027-02', 28, '2027-02-28', '2027-03-27'],
    ['2028-02', 28, '2028-02-28', '2028-03-27'],
    ['2026-03', 15, '2026-03-15', '2026-04-14'],
    ['2026-12', 2, '2026-12-02', '2027-01-01'],
  ] as const)('(%s, %i) → %s … %s', (month, startDay, start, end) => {
    expect(periodRange(month, startDay)).toEqual({ start, end })
  })

  it.each([0, 29, 31, -1, 1.5, Number.NaN])('throws a RangeError for start day %d', (startDay) => {
    expect(() => periodRange('2026-10', startDay)).toThrow(RangeError)
  })
})

describe('periodOf', () => {
  it.each([
    ['2027-01-10', 25, '2026-12'],
    ['2026-10-25', 25, '2026-10'],
    ['2026-10-24', 25, '2026-09'],
    ['2026-11-24', 25, '2026-10'],
    ['2026-12-31', 25, '2026-12'],
    ['2027-01-24', 25, '2026-12'],
    ['2026-10-01', 1, '2026-10'],
    ['2026-10-31', 1, '2026-10'],
    ['2026-01-01', 2, '2025-12'],
    ['2028-02-29', 28, '2028-02'],
    ['2028-03-27', 28, '2028-02'],
    ['2028-03-28', 28, '2028-03'],
  ] as const)('(%s, %i) → %s', (date, startDay, expected) => {
    expect(periodOf(date, startDay)).toBe(expected)
  })

  it("puts New Year's Day in December's period for every start day but 1", () => {
    for (const startDay of START_DAYS) {
      expect(periodOf('2027-01-01', startDay)).toBe(startDay === 1 ? '2027-01' : toMonthKey(2026, 12))
    }
  })

  it('steps just past the valid years without throwing', () => {
    expect(periodOf('1900-01-03', 25)).toBe('1899-12')
  })

  it('throws a RangeError for a start day outside 1..28', () => {
    expect(() => periodOf('2026-10-14', 29)).toThrow(RangeError)
    expect(() => periodOf('2026-10-14', 0)).toThrow(RangeError)
  })
})

describe('periodDays', () => {
  it.each([
    ['2027-01', 28, 31],
    ['2027-02', 28, 28],
    ['2028-02', 28, 29],
    ['2026-10', 1, 31],
    ['2026-11', 1, 30],
    ['2026-10', 25, 31],
    ['2026-11', 25, 30],
    ['2026-12', 25, 31],
  ] as const)('(%s, %i) → %i', (month, startDay, expected) => {
    expect(periodDays(month, startDay)).toBe(expected)
  })

  it('always equals the length of the month the period starts in (2024–2028, every start day)', () => {
    const failures: string[] = []
    for (const month of monthsBetween('2024-01', '2028-12')) {
      const { y, m } = parseMonthKey(month)
      for (const startDay of START_DAYS) {
        if (periodDays(month, startDay) !== daysInMonth(y, m)) failures.push(`${month} ${startDay}`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe('dayIndexInPeriod', () => {
  it('counts from 1 on the first day to days on the last', () => {
    expect(dayIndexInPeriod('2026-10-25', '2026-10', 25)).toBe(1)
    expect(dayIndexInPeriod('2026-10-31', '2026-10', 25)).toBe(7)
    expect(dayIndexInPeriod('2026-11-01', '2026-10', 25)).toBe(8)
    expect(dayIndexInPeriod('2026-11-24', '2026-10', 25)).toBe(31)
    expect(dayIndexInPeriod('2026-10-14', '2026-10', 1)).toBe(14)
  })

  it('is null outside the period', () => {
    expect(dayIndexInPeriod('2026-10-24', '2026-10', 25)).toBeNull()
    expect(dayIndexInPeriod('2026-11-25', '2026-10', 25)).toBeNull()
    expect(dayIndexInPeriod('2025-10-25', '2026-10', 25)).toBeNull()
    expect(dayIndexInPeriod('2026-11-01', '2026-10', 1)).toBeNull()
  })

  it('counts calendar days across DST changes', () => {
    expect(dayIndexInPeriod('2026-03-30', '2026-03', 1)).toBe(30)
    expect(dayIndexInPeriod('2026-10-26', '2026-10', 1)).toBe(26)
  })
})

describe('periodTiming', () => {
  it.each([
    ['2026-10-24', 'future'],
    ['2026-10-25', 'current'],
    ['2026-11-10', 'current'],
    ['2026-11-24', 'current'],
    ['2026-11-25', 'past'],
  ] as const)('2026-10 with start day 25 on %s is %s', (today, expected) => {
    expect(periodTiming('2026-10', today, 25)).toBe(expected)
  })

  it('compares with today, not with the calendar month', () => {
    expect(periodTiming('2026-09', '2026-10-14', 25)).toBe('current')
    expect(periodTiming('2026-10', '2026-10-14', 25)).toBe('future')
    expect(periodTiming('2026-10', '2026-10-14', 1)).toBe('current')
    expect(periodTiming('2026-09', '2026-10-14', 1)).toBe('past')
  })
})

describe('daysLeftInPeriod', () => {
  it('counts today: days on the first day, 1 on the last', () => {
    expect(daysLeftInPeriod('2026-10', '2026-10-25', 25)).toBe(31)
    expect(daysLeftInPeriod('2026-10', '2026-11-24', 25)).toBe(1)
    expect(daysLeftInPeriod('2026-10', '2026-10-18', 1)).toBe(14)
  })

  it('is 0 for past periods and every day for future ones', () => {
    expect(daysLeftInPeriod('2026-10', '2026-11-25', 25)).toBe(0)
    expect(daysLeftInPeriod('2026-11', '2026-10-18', 25)).toBe(30)
    expect(daysLeftInPeriod('2027-02', '2026-10-18', 28)).toBe(28)
  })
})

describe('isDateInPeriod', () => {
  it('includes both ends', () => {
    expect(isDateInPeriod('2026-12-25', '2026-12', 25)).toBe(true)
    expect(isDateInPeriod('2027-01-01', '2026-12', 25)).toBe(true)
    expect(isDateInPeriod('2027-01-24', '2026-12', 25)).toBe(true)
    expect(isDateInPeriod('2026-12-24', '2026-12', 25)).toBe(false)
    expect(isDateInPeriod('2027-01-25', '2026-12', 25)).toBe(false)
  })
})

describe('period properties (2024–2028, every start day)', () => {
  // About 51,000 date and start-day pairs: under 2 s alone, past the 5 s default on a loaded machine.
  it('§4.3 property: each date lies in periodOf(date) with diffDays(date, end) + 1 days left', { timeout: 30_000 }, () => {
    const failures: string[] = []
    for (let date: ISODate = '2024-01-01'; compareISO(date, '2028-12-31') <= 0; date = addDays(date, 1)) {
      for (const startDay of START_DAYS) {
        const month = periodOf(date, startDay)
        const { end } = periodRange(month, startDay)
        const daysLeft = daysLeftInPeriod(month, date, startDay)
        const index = dayIndexInPeriod(date, month, startDay)
        const ok =
          isDateInPeriod(date, month, startDay) &&
          daysLeft === diffDays(date, end) + 1 &&
          index !== null &&
          index + daysLeft - 1 === periodDays(month, startDay) &&
          periodTiming(month, date, startDay) === 'current'
        if (!ok) failures.push(`${date} start day ${startDay}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('tiles the calendar: each period starts the day after the previous one ends', () => {
    const failures: string[] = []
    for (const month of monthsBetween('2024-01', '2028-12')) {
      for (const startDay of START_DAYS) {
        const { start, end } = periodRange(month, startDay)
        const next = addMonths(month, 1)
        const ok =
          addDays(end, 1) === periodRange(next, startDay).start &&
          periodOf(start, startDay) === month &&
          periodOf(end, startDay) === month &&
          periodOf(addDays(start, -1), startDay) === addMonths(month, -1) &&
          periodOf(addDays(end, 1), startDay) === next
        if (!ok) failures.push(`${month} start day ${startDay}`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe('formatPeriodName', () => {
  it('names the period after the month it starts in', () => {
    expect(formatPeriodName('2026-10', 25, 'de-DE')).toBe('October')
    expect(formatPeriodName('2026-12', 25, 'en-US')).toBe('December')
    expect(formatPeriodName('2026-10', 1, 'en-US')).toBe('October')
  })

  it('adds the year and abbreviates on request', () => {
    expect(formatPeriodName('2026-10', 25, 'de-DE', { withYear: true })).toBe('October 2026')
    expect(formatPeriodName('2026-10', 25, 'en-US', { withYear: true, style: 'short' })).toBe('Oct 2026')
    expect(formatPeriodName('2026-09', 1, 'de-DE', { style: 'short' })).toBe('Sep')
    expect(formatPeriodName('2026-09', 1, 'de-DE', { withYear: false, style: 'long' })).toBe('September')
  })
})

describe('formatPeriodRange', () => {
  it('is null for calendar months', () => {
    expect(formatPeriodRange('2026-10', 1, 'de-DE')).toBeNull()
    expect(formatPeriodRange('2026-12', 1, 'en-US')).toBeNull()
  })

  it.each([
    ['2026-10', 25, 'de-DE', '25 Oct – 24 Nov'],
    ['2026-10', 25, 'en-US', 'Oct 25 – Nov 24'],
    ['2026-12', 25, 'de-DE', '25 Dec 2026 – 24 Jan 2027'],
    ['2026-12', 25, 'en-US', 'Dec 25, 2026 – Jan 24, 2027'],
    ['2026-12', 2, 'en-GB', '2 Dec 2026 – 1 Jan 2027'],
    ['2027-02', 28, 'fr-FR', '28 Feb – 27 Mar'],
  ] as const)('(%s, %i, %s) → %s', (month, startDay, locale, expected) => {
    expect(formatPeriodRange(month, startDay, locale)).toBe(expected)
  })

  it('separates the ends with space, en dash, space', () => {
    expect(formatPeriodRange('2026-10', 25, 'de-DE')).toContain(' \u2013 ')
  })
})

describe('formatPeriodLabel', () => {
  it.each([
    ['2026-10', 25, 'de-DE', '25 Oct – 24 Nov 2026'],
    ['2026-12', 25, 'en-US', 'Dec 25, 2026 – Jan 24, 2027'],
    ['2027-02', 28, 'de-DE', '28 Feb – 27 Mar 2027'],
    ['2026-10', 1, 'en-US', 'October 2026'],
    ['2026-10', 25, 'en-US', 'Oct 25 – Nov 24, 2026'],
    ['2026-12', 25, 'de-DE', '25 Dec 2026 – 24 Jan 2027'],
    ['2026-11', 2, 'en-GB', '2 Nov – 1 Dec 2026'],
    ['2026-12', 2, 'en-US', 'Dec 2, 2026 – Jan 1, 2027'],
    ['2026-12', 1, 'de-DE', 'December 2026'],
  ] as const)('(%s, %i, %s) → %s', (month, startDay, locale, expected) => {
    expect(formatPeriodLabel(month, startDay, locale)).toBe(expected)
  })
})

describe('formatPeriodDates', () => {
  it.each([
    ['2026-10', 1, 'de-DE', '1 Oct – 31 Oct 2026'],
    ['2026-10', 1, 'en-GB', '1 Oct – 31 Oct 2026'],
    ['2026-10', 1, 'en-US', 'Oct 1 – Oct 31, 2026'],
    ['2026-12', 1, 'en-US', 'Dec 1 – Dec 31, 2026'],
    ['2028-02', 1, 'fr-FR', '1 Feb – 29 Feb 2028'],
    ['2026-10', 25, 'de-DE', '25 Oct – 24 Nov 2026'],
    ['2026-10', 25, 'en-US', 'Oct 25 – Nov 24, 2026'],
    ['2026-12', 25, 'de-DE', '25 Dec 2026 – 24 Jan 2027'],
    ['2026-12', 25, 'en-US', 'Dec 25, 2026 – Jan 24, 2027'],
  ] as const)('(%s, %i, %s) → %s', (month, startDay, locale, expected) => {
    expect(formatPeriodDates(month, startDay, locale)).toBe(expected)
  })

  it('reads as formatPeriodLabel for every start day but 1 (2026–2027)', () => {
    for (const startDay of START_DAYS.slice(1)) {
      for (const month of monthsBetween('2026-01', '2027-12')) {
        for (const locale of ['de-DE', 'en-US']) {
          expect([month, startDay, locale, formatPeriodDates(month, startDay, locale)]).toEqual([
            month,
            startDay,
            locale,
            formatPeriodLabel(month, startDay, locale),
          ])
        }
      }
    }
  })

  it('names the first and last day of the calendar month with start day 1 (2024–2028)', () => {
    for (const month of monthsBetween('2024-01', '2028-12')) {
      const { y, m } = parseMonthKey(month)
      const last = toISODate(y, m, daysInMonth(y, m))
      expect(formatPeriodDates(month, 1, 'de-DE')).toBe(
        `${formatDate(toISODate(y, m, 1), 'de-DE', 'short')} – ${formatDate(last, 'de-DE', 'short')} ${y}`,
      )
    }
  })

  it('throws a RangeError for a start day outside 1..28', () => {
    expect(() => formatPeriodDates('2026-10', 0, 'de-DE')).toThrow(RangeError)
    expect(() => formatPeriodDates('2026-10', 29, 'de-DE')).toThrow(RangeError)
  })
})

describe('formatPeriodTitle', () => {
  it.each([
    ['2026-10', '2026-10', 'October'],
    ['2027-01', '2026-10', 'January 2027'],
    ['2025-12', '2026-01', 'December 2025'],
    ['2026-01', '2026-12', 'January'],
    ['2026-12', '2027-01', 'December 2026'],
  ] as const)('(%s, current %s) → %s', (month, currentMonth, expected) => {
    expect(formatPeriodTitle(month, currentMonth, 1, 'de-DE')).toBe(expected)
  })

  it('is the period’s name, with the year as formatPeriodName writes it, for every start day and date order', () => {
    for (const startDay of [1, 15, 25, 28]) {
      for (const locale of ['de-DE', 'en-US']) {
        expect(formatPeriodTitle('2026-11', '2026-10', startDay, locale)).toBe(formatPeriodName('2026-11', startDay, locale))
        expect(formatPeriodTitle('2027-01', '2026-12', startDay, locale)).toBe(
          formatPeriodName('2027-01', startDay, locale, { withYear: true }),
        )
      }
    }
  })

  it('throws a RangeError for a start day outside 1..28 or a month that is not one', () => {
    expect(() => formatPeriodTitle('2026-10', '2026-10', 0, 'de-DE')).toThrow(RangeError)
    expect(() => formatPeriodTitle('2026-10', '2026-10', 29, 'de-DE')).toThrow(RangeError)
    expect(() => formatPeriodTitle('2026-13', '2026-10', 1, 'de-DE')).toThrow(RangeError)
    expect(() => formatPeriodTitle('2026-10', '2026-1', 1, 'de-DE')).toThrow(RangeError)
  })
})

/**
 * The due date of a charge in period `month` (§4.4, as recurring.ts dueDateFor computes it): a
 * due day ≥ the start day falls in the period's calendar month, an earlier one in the following
 * month, clamped to that month's length.
 */
function dueDateIn(month: MonthKey, startDay: number, dueDay: number): ISODate {
  const { y, m } = parseMonthKey(dueDay >= startDay ? month : addMonths(month, 1))
  return toISODate(y, m, Math.min(dueDay, daysInMonth(y, m)))
}

describe('shiftForStartDayChange', () => {
  it('follows Δ = (d < from ? 1 : 0) − (d < to ? 1 : 0)', () => {
    expect(shiftForStartDayChange(1, 1, 25)).toBe(-1)
    expect(shiftForStartDayChange(28, 1, 25)).toBe(0)
    expect(shiftForStartDayChange(10, 25, 1)).toBe(1)
    expect(shiftForStartDayChange(25, 25, 1)).toBe(0)
    expect(shiftForStartDayChange(31, 1, 28)).toBe(0)
    expect(shiftForStartDayChange(15, 10, 20)).toBe(-1)
    expect(shiftForStartDayChange(15, 20, 10)).toBe(1)
    expect(shiftForStartDayChange(5, 10, 20)).toBe(0)
    expect(shiftForStartDayChange(5, 7, 7)).toBe(0)
  })

  it('treats items without a due day as due on the old start day', () => {
    expect(shiftForStartDayChange(null, 1, 25)).toBe(-1)
    expect(shiftForStartDayChange(null, 25, 1)).toBe(0)
    expect(shiftForStartDayChange(null, 10, 10)).toBe(0)
  })

  it('§4.3 example: 1 → 25 moves rent due on the 1st back a month and leaves the gym on the 28th', () => {
    const rent = shiftForStartDayChange(1, 1, 25)
    expect(addMonths('2026-01', rent)).toBe('2025-12')
    expect(addMonths('2026-10', rent)).toBe('2026-09')
    expect(dueDateIn('2026-10', 1, 1)).toBe('2026-10-01')
    expect(dueDateIn('2026-09', 25, 1)).toBe('2026-10-01')
    expect(shiftForStartDayChange(28, 1, 25)).toBe(0)
  })

  it('keeps every due date for all a, b in 1..28 and due days 1..31', () => {
    // Months of 31, 28, 30 and 29 days, and one whose next month is in the next year.
    const keys = ['2026-01', '2026-02', '2026-11', '2026-12', '2028-02'] as const
    const failures: string[] = []
    for (const from of START_DAYS) {
      for (const to of START_DAYS) {
        for (let dueDay = 1; dueDay <= 31; dueDay += 1) {
          const shift = shiftForStartDayChange(dueDay, from, to)
          for (const key of keys) {
            if (dueDateIn(addMonths(key, shift), to, dueDay) !== dueDateIn(key, from, dueDay)) {
              failures.push(`${key} due ${dueDay}: ${from} → ${to}`)
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('keeps an item without a due day in the period that holds its old start date', () => {
    const failures: string[] = []
    for (const from of START_DAYS) {
      for (const to of START_DAYS) {
        const shift = shiftForStartDayChange(null, from, to)
        for (const key of ['2026-01', '2026-12', '2028-02'] as const) {
          const { y, m } = parseMonthKey(key)
          if (periodOf(toISODate(y, m, from), to) !== addMonths(key, shift)) failures.push(`${key}: ${from} → ${to}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('throws a RangeError for start days outside 1..28', () => {
    expect(() => shiftForStartDayChange(1, 0, 25)).toThrow(RangeError)
    expect(() => shiftForStartDayChange(1, 1, 29)).toThrow(RangeError)
  })
})
