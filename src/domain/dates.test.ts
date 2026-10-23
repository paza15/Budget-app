import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addDays,
  addMonths,
  compareISO,
  dateLocaleFor,
  daysInMonth,
  diffDays,
  formatDate,
  formatDayLabel,
  formatMonthKey,
  formatRelativeDue,
  formatRelativeTime,
  isValidISODate,
  isValidMonthKey,
  localDateOf,
  maxMonth,
  minMonth,
  monthDiff,
  monthKeyOf,
  monthName,
  ordinalDay,
  parseISODate,
  parseMonthKey,
  todayISO,
  toISODate,
  toMonthKey,
  weekday,
} from '@/domain/dates'
import type { ISODate } from '@/domain/types'

// Unit tests run with TZ=Europe/Berlin (vite.config.ts). Summer time 2026 starts on Sunday
// 29 March (a 23-hour day) and ends on Sunday 25 October (a 25-hour day).

/** Every date from `first` to `last`, inclusive. */
function datesBetween(first: ISODate, last: ISODate): ISODate[] {
  const dates: ISODate[] = []
  for (let date = first; compareISO(date, last) <= 0; date = addDays(date, 1)) dates.push(date)
  return dates
}

describe('todayISO', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the local calendar date of the given moment', () => {
    expect(todayISO(new Date(2026, 9, 18, 12, 0))).toBe('2026-10-18')
    expect(todayISO(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
    expect(todayISO(new Date(2026, 11, 31, 23, 59, 59, 999))).toBe('2026-12-31')
  })

  it('keeps the local date just after midnight, where UTC is still the day before', () => {
    const justAfterMidnight = new Date(2026, 9, 18, 0, 30)
    expect(justAfterMidnight.getUTCDate()).toBe(17)
    expect(todayISO(justAfterMidnight)).toBe('2026-10-18')
  })

  it('defaults to now', () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 18, 23, 45) })
    expect(todayISO()).toBe('2026-10-18')
  })
})

describe('toISODate', () => {
  it('pads month and day', () => {
    expect(toISODate(2026, 1, 5)).toBe('2026-01-05')
    expect(toISODate(2026, 10, 14)).toBe('2026-10-14')
    expect(toISODate(2026, 12, 31)).toBe('2026-12-31')
  })

  it('accepts leap days in leap years only', () => {
    expect(toISODate(2028, 2, 29)).toBe('2028-02-29')
    expect(toISODate(2000, 2, 29)).toBe('2000-02-29')
    expect(() => toISODate(2026, 2, 29)).toThrow(RangeError)
    expect(() => toISODate(2100, 2, 29)).toThrow(RangeError)
  })

  it.each([
    [2026, 2, 30],
    [2026, 4, 31],
    [2026, 13, 1],
    [2026, 0, 1],
    [2026, 1, 0],
    [2026, 1, 32],
    [2026, 1.5, 1],
    [2026, 1, 1.5],
    [2026.5, 1, 1],
    [Number.NaN, 1, 1],
    [999, 1, 1],
    [10000, 1, 1],
  ])('throws a RangeError for (%d, %d, %d)', (y, m, d) => {
    expect(() => toISODate(y, m, d)).toThrow(RangeError)
  })
})

describe('toMonthKey', () => {
  it('pads the month', () => {
    expect(toMonthKey(2026, 1)).toBe('2026-01')
    expect(toMonthKey(2026, 12)).toBe('2026-12')
  })

  it.each([
    [2026, 0],
    [2026, 13],
    [2026, 1.5],
    [Number.NaN, 1],
    [999, 1],
  ])('throws a RangeError for (%d, %d)', (y, m) => {
    expect(() => toMonthKey(y, m)).toThrow(RangeError)
  })
})

describe('parseISODate', () => {
  it('splits a date into numbers', () => {
    expect(parseISODate('2026-10-14')).toEqual({ y: 2026, m: 10, d: 14 })
    expect(parseISODate('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 })
    expect(parseISODate('2026-01-01')).toEqual({ y: 2026, m: 1, d: 1 })
  })

  it('accepts dates outside the range valid for storage, for arithmetic near its edges', () => {
    expect(parseISODate('1899-12-25')).toEqual({ y: 1899, m: 12, d: 25 })
  })

  it.each(['2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-10-00', '2026-1-01', '2026-10-1', '26-10-14'] as const)(
    'throws a RangeError for %s',
    (s) => {
      expect(() => parseISODate(s)).toThrow(RangeError)
    },
  )
})

describe('parseMonthKey', () => {
  it('splits a month key into numbers', () => {
    expect(parseMonthKey('2026-10')).toEqual({ y: 2026, m: 10 })
    expect(parseMonthKey('2027-01')).toEqual({ y: 2027, m: 1 })
  })

  it.each(['2026-13', '2026-00', '2026-1', '26-10'] as const)('throws a RangeError for %s', (key) => {
    expect(() => parseMonthKey(key)).toThrow(RangeError)
  })
})

describe('isValidISODate', () => {
  it.each(['2026-10-14', '2024-02-29', '2000-02-29', '1900-01-01', '2999-12-31', '2026-12-31', '2026-04-30'])(
    'accepts %s',
    (s) => {
      expect(isValidISODate(s)).toBe(true)
    },
  )

  it.each([
    '1899-12-31',
    '3000-01-01',
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-10-00',
    '2026-10-32',
    '2026-1-1',
    '2026-10-1',
    '20261014',
    '2026/10/14',
    '2026-10-14 ',
    ' 2026-10-14',
    '2026-10-14T00:00',
    '2026-10',
    '+2026-10-14',
    '２０２６-１０-１４',
    '',
  ])('rejects %j', (s) => {
    expect(isValidISODate(s)).toBe(false)
  })

  it('rejects values that are not strings, even when they stringify to a date', () => {
    for (const value of [20261014, null, undefined, {}, new Date(2026, 9, 14), ['2026-10-14'], { toString: () => '2026-10-14' }]) {
      expect(isValidISODate(value)).toBe(false)
    }
  })
})

describe('isValidMonthKey', () => {
  it.each(['2026-10', '2026-01', '2026-12', '1900-01', '2999-12'])('accepts %s', (s) => {
    expect(isValidMonthKey(s)).toBe(true)
  })

  it.each(['2026-13', '2026-00', '1899-12', '3000-01', '2026-1', '2026-10-01', '202610', '2026/10', ' 2026-10', ''])(
    'rejects %j',
    (s) => {
      expect(isValidMonthKey(s)).toBe(false)
    },
  )

  it('rejects values that are not strings', () => {
    for (const value of [202610, null, undefined, ['2026-10'], { toString: () => '2026-10' }]) {
      expect(isValidMonthKey(value)).toBe(false)
    }
  })
})

describe('daysInMonth', () => {
  it('knows every month of 2026', () => {
    const days = Array.from({ length: 12 }, (_, i) => daysInMonth(2026, i + 1))
    expect(days).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
  })

  it.each([
    [2024, 29],
    [2026, 28],
    [2028, 29],
    [2000, 29],
    [1900, 28],
    [2100, 28],
  ])('February %i has %i days', (y, days) => {
    expect(daysInMonth(y, 2)).toBe(days)
  })

  it('throws a RangeError for a month outside 1..12', () => {
    expect(() => daysInMonth(2026, 0)).toThrow(RangeError)
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError)
    expect(() => daysInMonth(2026, 1.5)).toThrow(RangeError)
  })
})

describe('addDays', () => {
  it.each([
    ['2026-10-14', 1, '2026-10-15'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2028-02-29', 1, '2028-03-01'],
    ['2026-02-28', 1, '2026-03-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2026-10-14', 0, '2026-10-14'],
    ['2026-10-14', 365, '2027-10-14'],
    ['2026-10-14', -30, '2026-09-14'],
  ] as const)('(%s, %i) → %s', (date, n, expected) => {
    expect(addDays(date, n)).toBe(expected)
  })

  it('steps over both DST changes one calendar day at a time', () => {
    expect(datesBetween('2026-03-28', '2026-03-31')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31'])
    expect(datesBetween('2026-10-24', '2026-10-27')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'])
  })

  it('agrees with a plain calendar successor for every day of 2024–2028', () => {
    const failures: string[] = []
    let [y, m, d] = [2024, 1, 1]
    for (const date of datesBetween('2024-01-01', '2028-12-31')) {
      if (date !== toISODate(y, m, d)) failures.push(date)
      if (addDays(addDays(date, 40), -40) !== date) failures.push(`${date} ±40`)
      if (d < daysInMonth(y, m)) d += 1
      else if (m < 12) [m, d] = [m + 1, 1]
      else [y, m, d] = [y + 1, 1, 1]
    }
    expect(failures).toEqual([])
  })

  it('throws a RangeError for a fractional number of days', () => {
    expect(() => addDays('2026-10-14', 0.5)).toThrow(RangeError)
  })
})

describe('diffDays', () => {
  it.each([
    ['2026-10-14', '2026-10-15', 1],
    ['2026-10-15', '2026-10-14', -1],
    ['2026-10-14', '2026-10-14', 0],
    ['2026-03-28', '2026-03-30', 2],
    ['2026-10-24', '2026-10-26', 2],
    ['2026-01-01', '2027-01-01', 365],
    ['2028-01-01', '2029-01-01', 366],
    ['2026-02-01', '2026-03-01', 28],
    ['2028-02-01', '2028-03-01', 29],
  ] as const)('(%s, %s) → %i', (from, to, expected) => {
    expect(diffDays(from, to)).toBe(expected)
  })

  it('counts whole days from 2024-01-01 for every day of 2024–2028', () => {
    const dates = datesBetween('2024-01-01', '2028-12-31')
    expect(dates).toHaveLength(1827)
    dates.forEach((date, i) => {
      expect(diffDays('2024-01-01', date)).toBe(i)
    })
  })
})

describe('compareISO', () => {
  it('orders dates and month keys chronologically', () => {
    expect(compareISO('2026-10-14', '2026-10-15')).toBeLessThan(0)
    expect(compareISO('2026-10-15', '2026-10-14')).toBeGreaterThan(0)
    expect(compareISO('2026-10-14', '2026-10-14')).toBe(0)
    expect(compareISO('2026-09', '2026-10')).toBeLessThan(0)
    expect(compareISO('2027-01', '2026-12')).toBeGreaterThan(0)
    expect(['2026-12-01', '2026-02-10', '2027-01-01', '2026-10-14'].toSorted(compareISO)).toEqual([
      '2026-02-10',
      '2026-10-14',
      '2026-12-01',
      '2027-01-01',
    ])
  })
})

describe('weekday', () => {
  it.each([
    ['2026-10-18', 0],
    ['2026-10-14', 3],
    ['2026-10-17', 6],
    ['2024-02-29', 4],
    ['2000-01-01', 6],
    ['2026-03-29', 0],
    ['2026-10-25', 0],
  ] as const)('%s is day %i', (date, expected) => {
    expect(weekday(date)).toBe(expected)
  })

  it('advances by one every day, across DST and New Year', () => {
    const dates = datesBetween('2025-12-25', '2027-01-05')
    for (const [i, date] of dates.entries()) expect(weekday(date)).toBe((weekday('2025-12-25') + i) % 7)
  })
})

describe('monthKeyOf', () => {
  it('takes the calendar month of a date', () => {
    expect(monthKeyOf('2026-10-14')).toBe('2026-10')
    expect(monthKeyOf('2026-01-31')).toBe('2026-01')
    expect(monthKeyOf('2026-12-01')).toBe('2026-12')
  })
})

describe('addMonths', () => {
  it.each([
    ['2026-10', 1, '2026-11'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-10', 0, '2026-10'],
    ['2026-10', 24, '2028-10'],
    ['2026-10', -22, '2024-12'],
    ['2026-10', 15, '2028-01'],
    ['2026-01', -13, '2024-12'],
  ] as const)('(%s, %i) → %s', (key, n, expected) => {
    expect(addMonths(key, n)).toBe(expected)
  })

  it('is undone by monthDiff for many offsets', () => {
    for (let n = -60; n <= 60; n += 1) {
      expect(monthDiff('2026-10', addMonths('2026-10', n))).toBe(n)
      expect(addMonths(addMonths('2026-10', n), -n)).toBe('2026-10')
    }
  })

  it('throws a RangeError for a fractional number of months', () => {
    expect(() => addMonths('2026-10', 1.5)).toThrow(RangeError)
  })
})

describe('monthDiff', () => {
  it.each([
    ['2026-10', '2027-01', 3],
    ['2027-01', '2026-10', -3],
    ['2026-10', '2026-10', 0],
    ['2025-12', '2026-01', 1],
    ['2024-02', '2028-02', 48],
  ] as const)('(%s, %s) → %i', (from, to, expected) => {
    expect(monthDiff(from, to)).toBe(expected)
  })
})

describe('maxMonth and minMonth', () => {
  it('pick the later and the earlier month', () => {
    expect(maxMonth('2026-10', '2027-01')).toBe('2027-01')
    expect(maxMonth('2027-01', '2026-10')).toBe('2027-01')
    expect(minMonth('2026-10', '2027-01')).toBe('2026-10')
    expect(minMonth('2027-01', '2026-10')).toBe('2026-10')
    expect(maxMonth('2026-10', '2026-10')).toBe('2026-10')
    expect(minMonth('2026-10', '2026-10')).toBe('2026-10')
  })
})

describe('localDateOf', () => {
  it('uses the local date, not the UTC one', () => {
    // 22:30 UTC on 17 October is 00:30 on the 18th in Berlin (UTC+2).
    expect(localDateOf(Date.UTC(2026, 9, 17, 22, 30))).toBe('2026-10-18')
    // 23:30 UTC on New Year's Eve is 00:30 on 1 January in Berlin (UTC+1).
    expect(localDateOf(Date.UTC(2026, 11, 31, 23, 30))).toBe('2027-01-01')
  })

  it('gives the right date at both ends of every local day of 2024–2028', () => {
    const failures: string[] = []
    for (const date of datesBetween('2024-01-01', '2028-12-31')) {
      const { y, m, d } = parseISODate(date)
      if (localDateOf(new Date(y, m - 1, d, 0, 0).getTime()) !== date) failures.push(`${date} 00:00`)
      if (localDateOf(new Date(y, m - 1, d, 23, 59, 59, 999).getTime()) !== date) failures.push(`${date} 23:59`)
    }
    expect(failures).toEqual([])
  })
})

describe('dateLocaleFor', () => {
  it.each([
    ['en-US', 'en-US'],
    ['en-us', 'en-US'],
    ['de-DE', 'en-GB'],
    ['en-GB', 'en-GB'],
    ['en-IE', 'en-GB'],
    ['de-CH', 'en-GB'],
    ['fr-FR', 'en-GB'],
    ['sq-AL', 'en-GB'],
    ['pl-PL', 'en-GB'],
  ])('%s → %s', (locale, expected) => {
    expect(dateLocaleFor(locale)).toBe(expected)
  })
})

describe('monthName', () => {
  it('gives fixed English names', () => {
    expect(monthName(1)).toBe('January')
    expect(monthName(9)).toBe('September')
    expect(monthName(9, 'short')).toBe('Sep')
    expect(monthName(12, 'long')).toBe('December')
    expect(monthName(5, 'short')).toBe('May')
  })

  it('throws a RangeError for a month outside 1..12', () => {
    expect(() => monthName(0)).toThrow(RangeError)
    expect(() => monthName(13)).toThrow(RangeError)
  })
})

describe('formatDate', () => {
  it.each([
    ['2026-10-14', 'de-DE', 'short', '14 Oct'],
    ['2026-10-14', 'de-DE', 'medium', 'Wed 14 Oct'],
    ['2026-10-14', 'de-DE', 'long', 'Wednesday 14 October 2026'],
    ['2026-10-14', 'en-US', 'short', 'Oct 14'],
    ['2026-10-14', 'en-US', 'medium', 'Wed, Oct 14'],
    ['2026-10-14', 'en-US', 'long', 'Wednesday, October 14, 2026'],
    ['2026-03-05', 'en-GB', 'short', '5 Mar'],
    ['2026-03-05', 'en-US', 'long', 'Thursday, March 5, 2026'],
    ['2026-09-01', 'fr-FR', 'medium', 'Tue 1 Sep'],
    ['2028-02-29', 'nl-NL', 'long', 'Tuesday 29 February 2028'],
    ['2026-12-31', 'de-CH', 'medium', 'Thu 31 Dec'],
  ] as const)('(%s, %s, %s) → %s', (date, locale, style, expected) => {
    expect(formatDate(date, locale, style)).toBe(expected)
  })

  it('defaults to the medium style', () => {
    expect(formatDate('2026-10-14', 'de-DE')).toBe('Wed 14 Oct')
    expect(formatDate('2026-10-14', 'en-US')).toBe('Wed, Oct 14')
  })

  it('names every weekday', () => {
    const names = datesBetween('2026-10-12', '2026-10-18').map((date) => formatDate(date, 'en-GB', 'long').split(' ')[0])
    expect(names).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
  })
})

describe('formatDayLabel', () => {
  it.each([
    ['2026-10-18', 'de-DE', 'Today'],
    ['2026-10-17', 'de-DE', 'Yesterday'],
    ['2026-10-16', 'de-DE', 'Fri 16 Oct'],
    ['2026-10-16', 'en-US', 'Fri, Oct 16'],
    ['2026-10-19', 'de-DE', 'Mon 19 Oct'],
  ] as const)('(%s, today 2026-10-18, %s) → %s', (date, locale, expected) => {
    expect(formatDayLabel(date, '2026-10-18', locale)).toBe(expected)
  })

  it('counts calendar days across New Year and DST', () => {
    expect(formatDayLabel('2026-12-31', '2027-01-01', 'de-DE')).toBe('Yesterday')
    expect(formatDayLabel('2026-03-28', '2026-03-29', 'de-DE')).toBe('Yesterday')
    expect(formatDayLabel('2026-10-25', '2026-10-26', 'de-DE')).toBe('Yesterday')
  })
})

describe('formatRelativeDue', () => {
  it.each([
    ['2026-10-18', 'Today'],
    ['2026-10-19', 'Tomorrow'],
    ['2026-10-20', 'In 2 days'],
    ['2026-10-23', 'In 5 days'],
    ['2026-10-24', 'In 6 days'],
    ['2026-10-25', 'Sun 25 Oct'],
    ['2026-10-17', 'Sat 17 Oct'],
  ] as const)('(%s, today 2026-10-18, de-DE) → %s', (date, expected) => {
    expect(formatRelativeDue(date, '2026-10-18', 'de-DE')).toBe(expected)
  })

  it('uses the en-US order for the date and counts across month ends and DST', () => {
    expect(formatRelativeDue('2026-10-25', '2026-10-18', 'en-US')).toBe('Sun, Oct 25')
    expect(formatRelativeDue('2026-11-01', '2026-10-30', 'de-DE')).toBe('In 2 days')
    expect(formatRelativeDue('2026-03-29', '2026-03-28', 'de-DE')).toBe('Tomorrow')
  })
})

describe('formatMonthKey', () => {
  it.each([
    ['2026-10', 'de-DE', 'long', 'October 2026'],
    ['2026-10', 'en-US', 'long', 'October 2026'],
    ['2026-10', 'de-DE', 'short', 'Oct 2026'],
    ['2027-01', 'en-US', 'short', 'Jan 2027'],
  ] as const)('(%s, %s, %s) → %s', (key, locale, style, expected) => {
    expect(formatMonthKey(key, locale, style)).toBe(expected)
  })

  it('defaults to the long style', () => {
    expect(formatMonthKey('2026-09', 'en-GB')).toBe('September 2026')
  })
})

/** A local wall-clock time in 2026 (Berlin in tests), as epoch ms. */
function at(month: number, day: number, hours: number, minutes = 0, seconds = 0): number {
  return new Date(2026, month - 1, day, hours, minutes, seconds).getTime()
}

describe('formatRelativeTime', () => {
  const now = at(10, 18, 12)

  it.each([
    [now, 'just now'],
    [now - 59_999, 'just now'],
    [now + 5 * 60_000, 'just now'],
    [now - 60_000, '1 minute ago'],
    [now - 119_999, '1 minute ago'],
    [now - 2 * 60_000, '2 minutes ago'],
    [at(10, 18, 11, 0, 1), '59 minutes ago'],
    [at(10, 18, 11), '1 hour ago'],
    [at(10, 18, 10), '2 hours ago'],
    [at(10, 17, 12, 0, 1), '23 hours ago'],
    [at(10, 17, 12), 'yesterday'],
    [at(10, 17, 0, 0), 'yesterday'],
    [at(10, 16, 23, 59), '2 days ago'],
    [at(10, 15, 12), '3 days ago'],
    [at(9, 19, 12), '29 days ago'],
    [at(9, 18, 12), '1 month ago'],
    [at(8, 20, 12), '1 month ago'],
    [at(8, 19, 12), '2 months ago'],
    [new Date(2025, 9, 19, 12).getTime(), '12 months ago'],
    [new Date(2025, 9, 18, 12).getTime(), 'over a year ago'],
    [new Date(2020, 0, 1).getTime(), 'over a year ago'],
  ])('%i → %s', (epochMs, expected) => {
    expect(formatRelativeTime(epochMs, now)).toBe(expected)
  })

  it('counts days by the calendar once a day has passed', () => {
    // 30 hours, but two calendar days: 23:00 on the 16th seen at 05:00 on the 18th.
    expect(formatRelativeTime(at(10, 16, 23), at(10, 18, 5))).toBe('2 days ago')
    // Under 24 hours stays in hours even across midnight.
    expect(formatRelativeTime(at(10, 17, 22), at(10, 18, 8))).toBe('10 hours ago')
  })

  it('handles the 23- and 25-hour DST days', () => {
    // 29 March has 23 hours: noon to noon is 23 hours.
    expect(formatRelativeTime(at(3, 28, 12), at(3, 29, 12))).toBe('23 hours ago')
    // 25 October has 25 hours: 00:10 to 23:50 is 24 h 40 min within one calendar day.
    expect(formatRelativeTime(at(10, 25, 0, 10), at(10, 25, 23, 50))).toBe('24 hours ago')
    expect(formatRelativeTime(at(10, 25, 0, 10), at(10, 26, 0, 10))).toBe('yesterday')
  })
})

describe('ordinalDay', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [10, '10th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [14, '14th'],
    [20, '20th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [24, '24th'],
    [30, '30th'],
    [31, '31st'],
    [101, '101st'],
    [111, '111th'],
    [112, '112th'],
    [113, '113th'],
    [122, '122nd'],
  ])('%i → %s', (day, expected) => {
    expect(ordinalDay(day)).toBe(expected)
  })
})
