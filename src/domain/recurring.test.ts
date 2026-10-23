import { describe, expect, it } from 'vitest'
import { MAX_CENTS, MAX_MONTH_START_DAY } from '@/domain/constants'
import { addMonths, compareISO } from '@/domain/dates'
import { isDateInPeriod, shiftForStartDayChange } from '@/domain/period'
import {
  baseAmountFor,
  chargePeriodOf,
  compareLines,
  dueDateFor,
  isChargeMonth,
  isInRange,
  lineFor,
  linesFor,
  monthlyEquivalent,
  nextChargeMonth,
  normalizeRecurring,
  notThisMonthLabel,
  scheduleLabel,
  withAmountFrom,
} from '@/domain/recurring'
import { makeRecurring, monthsBetween } from '@/domain/test-helpers/budgetFixtures'
import type { AmountChange, AppData, EveryMonths, MonthKey, Recurring, RecurringOverride } from '@/domain/types'

const START_DAYS = Array.from({ length: MAX_MONTH_START_DAY }, (_, i) => i + 1)
const DUE_DAYS = Array.from({ length: 31 }, (_, i) => i + 1)
const INTERVALS: readonly EveryMonths[] = [1, 2, 3, 6, 12]
const NO_MONTHS: AppData['months'] = {}

/** `months` holding a single override of item `id` in `month`. */
function withOverride(month: MonthKey, id: string, override: RecurringOverride): AppData['months'] {
  return { [month]: { overrides: { [id]: override } } }
}

/** Line amounts of `r` in each period (start day 1), null where it has no line. */
function amountsIn(
  r: Recurring,
  periods: readonly MonthKey[],
  months: AppData['months'] = NO_MONTHS,
): (number | null)[] {
  return periods.map((month) => lineFor(r, month, months, 1)?.amount ?? null)
}

/** Sum of the line amounts of `r` over the periods (start day 1). */
function totalOver(r: Recurring, periods: readonly MonthKey[], months: AppData['months'] = NO_MONTHS): number {
  return amountsIn(r, periods, months).reduce<number>((sum, amount) => sum + (amount ?? 0), 0)
}

/** The §4.3 remap for a start-day change from `from` to `to`: every period key of the item moves by Δ. */
function remapped(r: Recurring, from: number, to: number): { item: Recurring; shift: number } {
  const shift = shiftForStartDayChange(r.dueDay, from, to)
  const item: Recurring = {
    ...r,
    startMonth: addMonths(r.startMonth, shift),
    endMonth: r.endMonth === null ? null : addMonths(r.endMonth, shift),
    amounts: r.amounts.map((entry) => ({ ...entry, from: addMonths(entry.from, shift) })),
  }
  return { item, shift }
}

describe('isInRange', () => {
  it('includes startMonth and endMonth', () => {
    const r = makeRecurring({ startMonth: '2026-03', endMonth: '2026-10' })
    expect(isInRange(r, '2026-02')).toBe(false)
    expect(isInRange(r, '2026-03')).toBe(true)
    expect(isInRange(r, '2026-07')).toBe(true)
    expect(isInRange(r, '2026-10')).toBe(true)
    expect(isInRange(r, '2026-11')).toBe(false)
  })

  it('runs forever without an endMonth', () => {
    const r = makeRecurring({ startMonth: '2026-03' })
    expect(isInRange(r, '2026-02')).toBe(false)
    expect(isInRange(r, '2099-12')).toBe(true)
  })

  it('compares periods across New Year', () => {
    const r = makeRecurring({ startMonth: '2026-11', endMonth: '2027-02' })
    expect(isInRange(r, '2026-12')).toBe(true)
    expect(isInRange(r, '2027-01')).toBe(true)
    expect(isInRange(r, '2027-03')).toBe(false)
    expect(isInRange(r, '2025-12')).toBe(false)
  })
})

describe('isChargeMonth', () => {
  it('charges a monthly item in every period of its range', () => {
    const r = makeRecurring({ startMonth: '2026-03', endMonth: '2026-06' })
    expect(monthsBetween('2026-02', '2026-07').map((m) => isChargeMonth(r, m))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ])
  })

  it.each([
    ['2026-03', true],
    ['2026-04', false],
    ['2026-05', false],
    ['2026-06', true],
    ['2026-09', true],
    ['2026-12', true],
    ['2027-01', false],
    ['2027-03', true],
  ] as const)('charges an item every 3 months from 2026-03 in %s: %s', (month, expected) => {
    expect(isChargeMonth(makeRecurring({ startMonth: '2026-03', everyMonths: 3 }), month)).toBe(expected)
  })

  it('never charges before startMonth, even where the cycle lines up (negative monthDiff)', () => {
    const quarterly = makeRecurring({ startMonth: '2026-03', everyMonths: 3 })
    expect(isChargeMonth(quarterly, '2025-12')).toBe(false)
    expect(isChargeMonth(quarterly, '2025-03')).toBe(false)
    expect(isChargeMonth(makeRecurring({ startMonth: '2026-03', everyMonths: 12 }), '2025-03')).toBe(false)
    expect(isChargeMonth(makeRecurring({ startMonth: '2026-03' }), '2026-02')).toBe(false)
  })

  it('never charges after endMonth, even where the cycle lines up', () => {
    const r = makeRecurring({ startMonth: '2026-03', everyMonths: 3, endMonth: '2026-08' })
    expect(isChargeMonth(r, '2026-06')).toBe(true)
    expect(isChargeMonth(r, '2026-09')).toBe(false)
  })

  it('counts cycles across New Year', () => {
    const r = makeRecurring({ startMonth: '2026-11', everyMonths: 2 })
    expect(isChargeMonth(r, '2027-01')).toBe(true)
    expect(isChargeMonth(r, '2027-02')).toBe(false)
    expect(isChargeMonth(r, '2027-03')).toBe(true)
  })
})

describe('chargePeriodOf', () => {
  it('is null outside the range', () => {
    const r = makeRecurring({ startMonth: '2026-09', everyMonths: 6, endMonth: '2027-01' })
    expect(chargePeriodOf(r, '2026-08')).toBeNull()
    expect(chargePeriodOf(r, '2027-01')).toBe('2026-09')
    expect(chargePeriodOf(r, '2027-02')).toBeNull()
  })

  it('is the period itself for monthly items', () => {
    const r = makeRecurring({ startMonth: '2026-01' })
    expect(chargePeriodOf(r, '2026-01')).toBe('2026-01')
    expect(chargePeriodOf(r, '2026-10')).toBe('2026-10')
  })

  it.each([
    ['2026-03', '2026-03'],
    ['2026-07', '2026-03'],
    ['2027-02', '2026-03'],
    ['2027-03', '2027-03'],
    ['2028-01', '2027-03'],
  ] as const)('finds the charge period of a yearly item from 2026-03 for %s: %s', (month, expected) => {
    expect(chargePeriodOf(makeRecurring({ startMonth: '2026-03', everyMonths: 12 }), month)).toBe(expected)
  })

  it('finds the start of the cycle for items every 3 months', () => {
    const r = makeRecurring({ startMonth: '2026-03', everyMonths: 3 })
    expect(chargePeriodOf(r, '2026-05')).toBe('2026-03')
    expect(chargePeriodOf(r, '2026-06')).toBe('2026-06')
    expect(chargePeriodOf(r, '2027-02')).toBe('2026-12')
  })
})

describe('baseAmountFor', () => {
  const r = makeRecurring({
    startMonth: '2026-01',
    amounts: [
      { from: '2026-01', amount: 1000 },
      { from: '2026-05', amount: 1200 },
      { from: '2026-09', amount: 1500 },
    ],
  })

  it.each([
    ['2026-01', 1000],
    ['2026-04', 1000],
    ['2026-05', 1200],
    ['2026-08', 1200],
    ['2026-09', 1500],
    ['2030-01', 1500],
  ] as const)('uses the last change from or before the period: %s → %i', (month, expected) => {
    expect(baseAmountFor(r, month)).toBe(expected)
  })

  it('uses the first amount before any change applies', () => {
    expect(baseAmountFor(r, '2025-06')).toBe(1000)
  })

  it('throws a RangeError for an item without amounts', () => {
    expect(() => baseAmountFor(makeRecurring({ amounts: [] }), '2026-01')).toThrow(RangeError)
  })
})

describe('dueDateFor', () => {
  it.each([
    ['2026-10', 25, 1, '2026-11-01'],
    ['2026-11', 25, 31, '2026-11-30'],
    ['2027-02', 28, 30, '2027-02-28'],
    ['2028-02', 28, 31, '2028-02-29'],
    ['2026-02', 1, 31, '2026-02-28'],
    ['2026-04', 1, 31, '2026-04-30'],
    ['2026-10', 1, 18, '2026-10-18'],
    ['2026-12', 25, 1, '2027-01-01'],
    ['2026-12', 25, 24, '2027-01-24'],
    ['2026-12', 25, 25, '2026-12-25'],
    ['2026-01', 28, 30, '2026-01-30'],
    ['2026-01', 28, 27, '2026-02-27'],
  ] as const)('(%s, start day %i, due day %i) → %s', (month, startDay, dueDay, expected) => {
    expect(dueDateFor(makeRecurring({ startMonth: '2026-01', dueDay }), month, startDay)).toBe(expected)
  })

  it('is null without a due day', () => {
    expect(dueDateFor(makeRecurring({ startMonth: '2026-01' }), '2026-10', 1)).toBeNull()
  })

  it('is null outside charge periods and outside the range', () => {
    const quarterly = makeRecurring({ startMonth: '2026-03', everyMonths: 3, endMonth: '2026-12', dueDay: 5 })
    expect(dueDateFor(quarterly, '2026-06', 1)).toBe('2026-06-05')
    expect(dueDateFor(quarterly, '2026-07', 1)).toBeNull()
    expect(dueDateFor(quarterly, '2025-12', 1)).toBeNull()
    expect(dueDateFor(quarterly, '2027-03', 1)).toBeNull()
    const spread = makeRecurring({ startMonth: '2026-03', everyMonths: 12, spread: true, dueDay: 5 })
    expect(dueDateFor(spread, '2026-03', 1)).toBe('2026-03-05')
    expect(dueDateFor(spread, '2026-04', 1)).toBeNull()
  })

  it('always falls inside the period (every start day and due day)', () => {
    const failures: string[] = []
    for (const dueDay of DUE_DAYS) {
      const r = makeRecurring({ startMonth: '2026-01', dueDay })
      for (const startDay of START_DAYS) {
        for (const month of ['2026-01', '2026-02', '2026-04', '2026-12', '2028-02'] as const) {
          const due = dueDateFor(r, month, startDay)
          if (due === null || !isDateInPeriod(due, month, startDay)) failures.push(`${month} ${startDay} ${dueDay}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('§4.3 property: remapping for a new start day keeps every due date (a, b in 1..28, due days 1..31)', () => {
    // Charge periods of an item every 3 months (with February clamping in 2027 and 2028) and one
    // period without a charge.
    const keys = ['2026-01', '2026-02', '2027-01', '2028-01'] as const
    const failures: string[] = []
    for (const dueDay of DUE_DAYS) {
      const original = makeRecurring({ startMonth: '2026-01', everyMonths: 3, dueDay })
      for (const a of START_DAYS) {
        for (const b of START_DAYS) {
          const { item, shift } = remapped(original, a, b)
          for (const key of keys) {
            if (dueDateFor(item, addMonths(key, shift), b) !== dueDateFor(original, key, a)) {
              failures.push(`${key} due ${dueDay}: ${a} → ${b}`)
            }
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('throws a RangeError for a start day outside 1..28', () => {
    const r = makeRecurring({ startMonth: '2026-01', dueDay: 1 })
    expect(() => dueDateFor(r, '2026-10', 0)).toThrow(RangeError)
    expect(() => dueDateFor(r, '2026-10', 29)).toThrow(RangeError)
  })
})

describe('lineFor', () => {
  describe('items that are not spread', () => {
    const rent = makeRecurring({ id: 'rent', amount: 64000, startMonth: '2026-01', dueDay: 1 })

    it('gives a monthly item a line in every period of its range', () => {
      const line = lineFor(rent, '2026-10', NO_MONTHS, 1)
      expect(line).toEqual({
        recurring: rent,
        month: '2026-10',
        amount: 64000,
        scheduledAmount: 64000,
        fullAmount: 64000,
        skipped: false,
        paid: false,
        overridden: false,
        isChargeMonth: true,
        dueDate: '2026-10-01',
      })
      expect(line?.recurring).toBe(rent)
    })

    it('has no line outside the range', () => {
      const ended = makeRecurring({ startMonth: '2026-03', endMonth: '2026-06' })
      expect(lineFor(ended, '2026-02', NO_MONTHS, 1)).toBeNull()
      expect(lineFor(ended, '2026-07', NO_MONTHS, 1)).toBeNull()
    })

    it('only has lines in charge periods when charged every few months', () => {
      const quarterly = makeRecurring({ amount: 3000, startMonth: '2026-03', everyMonths: 3 })
      expect(amountsIn(quarterly, monthsBetween('2026-03', '2026-07'))).toEqual([3000, null, null, 3000, null])
    })

    it('counts a different amount for one period', () => {
      const line = lineFor(rent, '2026-10', withOverride('2026-10', 'rent', { amount: 60000 }), 1)
      expect(line).toMatchObject({ amount: 60000, scheduledAmount: 64000, fullAmount: 64000, overridden: true })
      expect(lineFor(rent, '2026-11', withOverride('2026-10', 'rent', { amount: 60000 }), 1)?.amount).toBe(64000)
    })

    it('counts 0 when skipped, and a skipped line is never paid', () => {
      const months = withOverride('2026-10', 'rent', { skipped: true, paid: true, amount: 60000 })
      expect(lineFor(rent, '2026-10', months, 1)).toMatchObject({
        amount: 0,
        scheduledAmount: 64000,
        skipped: true,
        paid: false,
        overridden: true,
      })
    })

    it('is paid once ticked off', () => {
      const line = lineFor(rent, '2026-10', withOverride('2026-10', 'rent', { paid: true }), 1)
      expect(line).toMatchObject({ amount: 64000, paid: true, skipped: false, overridden: false })
    })

    it('ignores overrides of other items', () => {
      expect(lineFor(rent, '2026-10', withOverride('2026-10', 'gym', { skipped: true }), 1)?.amount).toBe(64000)
    })

    it('reads months and overrides with Object.hasOwn, ignoring inherited keys (§4.7)', () => {
      const inheritedOverride: AppData['months'] = {
        '2026-10': { overrides: Object.create({ rent: { skipped: true, paid: true } }) },
      }
      const inheritedMonth: AppData['months'] = Object.create(withOverride('2026-10', 'rent', { skipped: true }))
      expect(lineFor(rent, '2026-10', inheritedOverride, 1)).toMatchObject({ amount: 64000, paid: false })
      expect(lineFor(rent, '2026-10', inheritedMonth, 1)).toMatchObject({ amount: 64000, skipped: false })
    })

    it('treats spread on a monthly item as not spread', () => {
      const r = makeRecurring({ amount: 1000, startMonth: '2026-01', everyMonths: 1, spread: true })
      expect(lineFor(r, '2026-05', NO_MONTHS, 1)).toMatchObject({ amount: 1000, isChargeMonth: true })
    })
  })

  describe('spread items', () => {
    // §4.4 test: 10000 yearly, spread, from 2026-03.
    const insurance = makeRecurring({
      id: 'insurance',
      amount: 10000,
      startMonth: '2026-03',
      everyMonths: 12,
      spread: true,
    })
    const firstCycle = monthsBetween('2026-03', '2027-02')

    it.each([
      ['2026-03', 837],
      ['2026-04', 833],
      ['2027-02', 833],
      ['2027-03', 837],
    ] as const)('§4.4: 10000 yearly from 2026-03 counts %s: %i', (month, expected) => {
      expect(lineFor(insurance, month, NO_MONTHS, 1)?.amount).toBe(expected)
    })

    it('§4.4: a full cycle adds up to the yearly amount', () => {
      expect(totalOver(insurance, firstCycle)).toBe(10000)
    })

    it('has a line in every period of the range, the charge period holding the remainder', () => {
      expect(lineFor(insurance, '2026-02', NO_MONTHS, 1)).toBeNull()
      expect(lineFor(insurance, '2026-03', NO_MONTHS, 1)).toMatchObject({
        scheduledAmount: 837,
        fullAmount: 10000,
        isChargeMonth: true,
      })
      expect(lineFor(insurance, '2026-08', NO_MONTHS, 1)).toMatchObject({
        scheduledAmount: 833,
        fullAmount: 10000,
        isChargeMonth: false,
      })
    })

    it('§4.4: an amount change takes effect from the first cycle starting at or after it', () => {
      const r = makeRecurring({
        startMonth: '2026-01',
        amounts: [
          { from: '2026-01', amount: 12000 },
          { from: '2026-07', amount: 14400 },
        ],
        everyMonths: 12,
        spread: true,
      })
      expect(lineFor(r, '2026-07', NO_MONTHS, 1)?.amount).toBe(1000)
      expect(totalOver(r, monthsBetween('2026-01', '2026-12'))).toBe(12000)
      expect(lineFor(r, '2027-01', NO_MONTHS, 1)?.amount).toBe(1200)
      expect(totalOver(r, monthsBetween('2027-01', '2027-12'))).toBe(14400)
    })

    it('§4.4: skipping at the charge period zeroes every line of the cycle', () => {
      const months = withOverride('2026-03', 'insurance', { skipped: true })
      expect(amountsIn(insurance, firstCycle, months)).toEqual(firstCycle.map(() => 0))
      expect(firstCycle.every((m) => lineFor(insurance, m, months, 1)?.skipped === true)).toBe(true)
      expect(lineFor(insurance, '2027-03', months, 1)).toMatchObject({ amount: 837, skipped: false })
    })

    it('§4.4: a different amount at the charge period is spread over the whole cycle', () => {
      const months = withOverride('2026-03', 'insurance', { amount: 11000 })
      expect(amountsIn(insurance, firstCycle, months)).toEqual([924, ...firstCycle.slice(1).map(() => 916)])
      expect(totalOver(insurance, firstCycle, months)).toBe(11000)
      expect(lineFor(insurance, '2026-07', months, 1)).toMatchObject({
        amount: 916,
        scheduledAmount: 833,
        fullAmount: 11000,
        overridden: true,
      })
      expect(lineFor(insurance, '2027-03', months, 1)).toMatchObject({ amount: 837, overridden: false })
    })

    it('§4.4: a cycle cut short by endMonth is truncated', () => {
      const ended = { ...insurance, endMonth: '2026-10' } satisfies Recurring
      expect(lineFor(ended, '2026-11', NO_MONTHS, 1)).toBeNull()
      expect(totalOver(ended, monthsBetween('2026-03', '2026-10'))).toBe(6668)
    })

    it('can only be paid on the charge line', () => {
      const months = withOverride('2026-03', 'insurance', { paid: true })
      expect(lineFor(insurance, '2026-03', months, 1)?.paid).toBe(true)
      expect(lineFor(insurance, '2026-04', months, 1)?.paid).toBe(false)
    })

    it('ignores overrides stored outside the charge period', () => {
      const months = withOverride('2026-05', 'insurance', { amount: 1, skipped: true, paid: true })
      expect(lineFor(insurance, '2026-05', months, 1)).toMatchObject({
        amount: 833,
        skipped: false,
        paid: false,
        overridden: false,
      })
    })

    it('has a due date on the charge line only', () => {
      const r = { ...insurance, dueDay: 15 } satisfies Recurring
      expect(lineFor(r, '2026-03', NO_MONTHS, 1)?.dueDate).toBe('2026-03-15')
      expect(lineFor(r, '2026-04', NO_MONTHS, 1)?.dueDate).toBeNull()
    })

    it('spreads over 6 and 2 months with the remainder in the charge period', () => {
      const halfYearly = makeRecurring({ amount: 1000, startMonth: '2026-01', everyMonths: 6, spread: true })
      expect(amountsIn(halfYearly, monthsBetween('2026-01', '2026-07'))).toEqual([170, 166, 166, 166, 166, 166, 170])
      const bimonthly = makeRecurring({ amount: 999, startMonth: '2026-01', everyMonths: 2, spread: true })
      expect(amountsIn(bimonthly, monthsBetween('2026-01', '2026-03'))).toEqual([500, 499, 500])
    })

    it('splits every amount so that a full cycle adds up to it exactly', () => {
      const amounts = [1, 2, 5, 11, 99, 100, 101, 1199, 9999, 10000, 123457, MAX_CENTS]
      const failures: string[] = []
      for (const everyMonths of [2, 3, 6, 12] as const) {
        for (const amount of amounts) {
          const r = makeRecurring({ amount, startMonth: '2026-05', everyMonths, spread: true })
          const cycle = monthsBetween('2026-05', addMonths('2026-05', everyMonths - 1))
          const share = Math.floor(amount / everyMonths)
          const expected = [amount - (everyMonths - 1) * share, ...cycle.slice(1).map(() => share)]
          const actual = amountsIn(r, cycle)
          if (JSON.stringify(actual) !== JSON.stringify(expected) || totalOver(r, cycle) !== amount) {
            failures.push(`${amount} every ${everyMonths}: ${JSON.stringify(actual)}`)
          }
        }
      }
      expect(failures).toEqual([])
    })
  })

  it('§4.3 example: after the start day moves from 1 to 25, rent is still due on 2026-10-01 and paid', () => {
    const rent = makeRecurring({ id: 'rent', amount: 64000, startMonth: '2026-01', dueDay: 1 })
    const before = lineFor(rent, '2026-10', withOverride('2026-10', 'rent', { paid: true }), 1)
    const { item, shift } = remapped(rent, 1, 25)
    expect(item.startMonth).toBe('2025-12')
    const overrideKey = addMonths('2026-10', shift)
    expect(overrideKey).toBe('2026-09')
    const after = lineFor(item, overrideKey, withOverride(overrideKey, 'rent', { paid: true }), 25)
    expect(before).toMatchObject({ dueDate: '2026-10-01', paid: true, amount: 64000 })
    expect(after).toMatchObject({ dueDate: '2026-10-01', paid: true, amount: 64000 })

    const gym = makeRecurring({ startMonth: '2026-01', dueDay: 28 })
    expect(remapped(gym, 1, 25).shift).toBe(0)
    expect(dueDateFor(gym, '2026-10', 1)).toBe('2026-10-28')
    expect(dueDateFor(gym, '2026-10', 25)).toBe('2026-10-28')
  })
})

describe('linesFor', () => {
  const phone = makeRecurring({ id: 'b', name: 'Phone', dueDay: 1, order: 5 })
  const banana = makeRecurring({ id: 'd', name: 'Banana', dueDay: 15, order: 1 })
  const apple = makeRecurring({ id: 'e', name: 'apple', dueDay: 15, order: 1 })
  const gym = makeRecurring({ id: 'a', name: 'Gym', dueDay: 15, order: 2 })
  const savings = makeRecurring({ id: 'c', name: 'Savings', order: 0 })
  const salary = makeRecurring({ id: 'salary', kind: 'income', dueDay: 25 })
  const parents = makeRecurring({ id: 'parents', kind: 'income', dueDay: 1 })
  const quarterly = makeRecurring({ id: 'quarterly', startMonth: '2026-09', everyMonths: 3, dueDay: 2 })
  const ended = makeRecurring({ id: 'ended', endMonth: '2026-09', dueDay: 3 })
  const items = [savings, gym, salary, apple, quarterly, phone, banana, ended, parents]

  it('sorts by due date (none last), then order, then name', () => {
    const lines = linesFor(items, 'expense', '2026-10', NO_MONTHS, 1)
    expect(lines.map((line) => line.recurring.id)).toEqual(['b', 'e', 'd', 'a', 'c'])
  })

  it('only lists items of the kind asked for that have a line in the period', () => {
    expect(linesFor(items, 'income', '2026-10', NO_MONTHS, 1).map((line) => line.recurring.id)).toEqual([
      'parents',
      'salary',
    ])
    expect(linesFor(items, 'expense', '2026-12', NO_MONTHS, 1).map((line) => line.recurring.id)).toContain(
      'quarterly',
    )
  })

  it('sorts by the due date, not the due day, when periods start later in the month', () => {
    const first = makeRecurring({ id: 'first', dueDay: 1, order: 0 })
    const late = makeRecurring({ id: 'late', dueDay: 28, order: 1 })
    // Period 2026-10 with start day 25: the 28th is 2026-10-28, the 1st is 2026-11-01.
    const lines = linesFor([first, late], 'expense', '2026-10', NO_MONTHS, 25)
    expect(lines.map((line) => [line.recurring.id, line.dueDate])).toEqual([
      ['late', '2026-10-28'],
      ['first', '2026-11-01'],
    ])
  })

  it('compares names ignoring case and with numbers by value', () => {
    const gym10 = makeRecurring({ id: 'g10', name: 'Gym 10' })
    const gym2 = makeRecurring({ id: 'g2', name: 'gym 2' })
    expect(linesFor([gym10, gym2], 'expense', '2026-10', NO_MONTHS, 1).map((l) => l.recurring.id)).toEqual([
      'g2',
      'g10',
    ])
  })

  it('returns lines that reference the given items', () => {
    const lines = linesFor(items, 'expense', '2026-10', NO_MONTHS, 1)
    expect(lines.find((line) => line.recurring.id === 'a')?.recurring).toBe(gym)
  })

  it('returns an empty list when nothing has a line', () => {
    expect(linesFor([], 'expense', '2026-10', NO_MONTHS, 1)).toEqual([])
    expect(linesFor([ended], 'expense', '2026-10', NO_MONTHS, 1)).toEqual([])
  })
})

describe('compareLines', () => {
  it('puts lines without a due date last and keeps equal lines in place', () => {
    const due = lineFor(makeRecurring({ dueDay: 20, order: 9 }), '2026-10', NO_MONTHS, 1)
    const undated = lineFor(makeRecurring({ order: 0 }), '2026-10', NO_MONTHS, 1)
    if (due === null || undated === null) throw new Error('expected lines')
    expect(compareLines(due, undated)).toBeLessThan(0)
    expect(compareLines(undated, due)).toBeGreaterThan(0)
    expect(compareLines(due, due)).toBe(0)
  })
})

describe('nextChargeMonth', () => {
  it.each([
    // §4.4 tests
    ['2026-03', 3, null, '2026-10', '2026-12'],
    ['2026-03', 3, null, '2026-12', '2026-12'],
    ['2026-03', 3, null, '2025-01', '2026-03'],
    ['2026-01', 12, '2026-11', '2026-10', null],
    // more
    ['2026-01', 1, null, '2026-10', '2026-10'],
    ['2026-09', 6, null, '2026-10', '2027-03'],
    ['2026-11', 2, null, '2027-02', '2027-03'],
    ['2026-03', 12, null, '2026-03', '2026-03'],
    ['2026-03', 12, null, '2026-04', '2027-03'],
    ['2026-01', 1, '2026-06', '2026-06', '2026-06'],
    ['2026-01', 1, '2026-06', '2026-07', null],
  ] as const)('{ start %s, every %i, end %s } from %s → %s', (startMonth, everyMonths, endMonth, from, expected) => {
    expect(nextChargeMonth(makeRecurring({ startMonth, everyMonths, endMonth }), from)).toBe(expected)
  })

  it('is the first charge period at or after `from` (2025-06 … 2028-06, every interval)', () => {
    const failures: string[] = []
    for (const everyMonths of INTERVALS) {
      for (const endMonth of [null, '2027-08'] as const) {
        const r = makeRecurring({ startMonth: '2026-03', everyMonths, endMonth })
        for (const from of monthsBetween('2025-06', '2028-06')) {
          const next = nextChargeMonth(r, from)
          // Every period from `from` up to the answer (or to the end of the window) that is not
          // the answer must not be a charge period.
          const last = next ?? '2028-12'
          const skipped = monthsBetween(from, last).filter((m) => m !== next)
          const ok =
            skipped.every((m) => !isChargeMonth(r, m)) &&
            (next === null || (compareISO(next, from) >= 0 && isChargeMonth(r, next)))
          if (!ok) failures.push(`every ${everyMonths}, end ${endMonth}, from ${from}: ${next}`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})

describe('notThisMonthLabel', () => {
  it('names the start month of an item that has not started', () => {
    expect(notThisMonthLabel(makeRecurring({ startMonth: '2026-11' }), '2026-10', 1, 'de-DE')).toBe('Starts November')
    expect(notThisMonthLabel(makeRecurring({ startMonth: '2026-11' }), '2026-10', 25, 'en-US')).toBe(
      'Starts November',
    )
  })

  it('adds the year when it differs from the selected period', () => {
    expect(notThisMonthLabel(makeRecurring({ startMonth: '2027-03' }), '2026-10', 1, 'de-DE')).toBe(
      'Starts March 2027',
    )
    const ended = makeRecurring({ startMonth: '2025-01', endMonth: '2025-12' })
    expect(notThisMonthLabel(ended, '2026-10', 1, 'de-DE')).toBe('Ended December 2025')
  })

  it('names the end month of an item that has ended', () => {
    const ended = makeRecurring({ startMonth: '2026-01', endMonth: '2026-09' })
    expect(notThisMonthLabel(ended, '2026-10', 1, 'de-DE')).toBe('Ended September')
  })

  it('throws a RangeError for a start day outside 1..28, whatever the label', () => {
    expect(() => notThisMonthLabel(makeRecurring({ startMonth: '2026-11' }), '2026-10', 0, 'de-DE')).toThrow(RangeError)
    const ended = makeRecurring({ startMonth: '2026-01', endMonth: '2026-09' })
    expect(() => notThisMonthLabel(ended, '2026-10', 29, 'de-DE')).toThrow(RangeError)
  })

  it('names the next charge period when there is no due day', () => {
    const quarterly = makeRecurring({ startMonth: '2026-09', everyMonths: 3 })
    expect(notThisMonthLabel(quarterly, '2026-10', 1, 'de-DE')).toBe('Next: December')
    // The next charge is always within a year, so it never needs one.
    const lateQuarterly = makeRecurring({ startMonth: '2026-11', everyMonths: 3 })
    expect(notThisMonthLabel(lateQuarterly, '2026-12', 1, 'de-DE')).toBe('Next: February')
  })

  it('gives the next due date when there is a due day', () => {
    const quarterly = makeRecurring({ startMonth: '2026-09', everyMonths: 3, dueDay: 1 })
    expect(notThisMonthLabel(quarterly, '2026-10', 1, 'de-DE')).toBe('Next: Tue 1 Dec')
    expect(notThisMonthLabel(quarterly, '2026-10', 1, 'en-US')).toBe('Next: Tue, Dec 1')
    // With periods starting on the 25th, the charge of period 2026-12 is due on 2027-01-01.
    expect(notThisMonthLabel(quarterly, '2026-10', 25, 'de-DE')).toBe('Next: Fri 1 Jan')
  })

  it('says when no charge is left before the item ends', () => {
    const yearly = makeRecurring({ startMonth: '2026-01', everyMonths: 12, endMonth: '2026-11' })
    expect(notThisMonthLabel(yearly, '2026-10', 1, 'de-DE')).toBe('No more charges, ends November')
    const quarterly = makeRecurring({ startMonth: '2026-08', everyMonths: 3, endMonth: '2027-01' })
    expect(notThisMonthLabel(quarterly, '2026-12', 1, 'de-DE')).toBe('No more charges, ends January 2027')
  })

  it('takes the first rule that matches', () => {
    // Before the start beats everything else, even for an item that ends without another charge.
    const r = makeRecurring({ startMonth: '2026-11', everyMonths: 12, endMonth: '2026-12' })
    expect(notThisMonthLabel(r, '2026-10', 1, 'de-DE')).toBe('Starts November')
    expect(notThisMonthLabel(r, '2027-01', 1, 'de-DE')).toBe('Ended December 2026')
    expect(notThisMonthLabel(r, '2026-12', 1, 'de-DE')).toBe('No more charges, ends December')
  })
})

describe('scheduleLabel', () => {
  it('gives the due day of monthly items', () => {
    expect(scheduleLabel(makeRecurring({ dueDay: 1 }), '2026-10', 1, 'de-DE')).toBe('Due on the 1st')
    expect(scheduleLabel(makeRecurring({ dueDay: 22 }), '2026-10', 25, 'de-DE')).toBe('Due on the 22nd')
    expect(scheduleLabel(makeRecurring({ kind: 'income', dueDay: 25 }), '2026-10', 1, 'de-DE')).toBe(
      'Arrives on the 25th',
    )
  })

  it('says monthly without a due day', () => {
    expect(scheduleLabel(makeRecurring({}), '2026-10', 1, 'de-DE')).toBe('Monthly')
  })

  it('names the month of yearly items', () => {
    const yearly = makeRecurring({ startMonth: '2026-03', everyMonths: 12, dueDay: 14 })
    expect(scheduleLabel(yearly, '2026-03', 1, 'de-DE')).toBe('Yearly in March')
    expect(scheduleLabel(yearly, '2027-03', 25, 'en-US')).toBe('Yearly in March')
  })

  it('names both months of half-yearly items in calendar order', () => {
    const fromMarch = makeRecurring({ startMonth: '2026-03', everyMonths: 6 })
    const fromSeptember = makeRecurring({ startMonth: '2026-09', everyMonths: 6, spread: true })
    expect(scheduleLabel(fromMarch, '2026-09', 1, 'de-DE')).toBe('Every 6 months, March and September')
    expect(scheduleLabel(fromSeptember, '2026-09', 1, 'de-DE')).toBe('Every 6 months, March and September')
  })

  it('names the next charge after the period for items every 2 or 3 months', () => {
    const quarterly = makeRecurring({ startMonth: '2026-09', everyMonths: 3 })
    expect(scheduleLabel(quarterly, '2026-09', 1, 'de-DE')).toBe('Every 3 months, next in December')
    expect(scheduleLabel(quarterly, '2026-12', 1, 'de-DE')).toBe('Every 3 months, next in March')
    const spread = { ...quarterly, spread: true } satisfies Recurring
    expect(scheduleLabel(spread, '2026-10', 1, 'de-DE')).toBe('Every 3 months, next in December')
    const bimonthly = makeRecurring({ startMonth: '2026-10', everyMonths: 2 })
    expect(scheduleLabel(bimonthly, '2026-10', 1, 'de-DE')).toBe('Every 2 months, next in December')
  })

  it('names the end month when the item ends before its next charge', () => {
    const ending = makeRecurring({ startMonth: '2026-09', everyMonths: 3, endMonth: '2026-11' })
    expect(scheduleLabel(ending, '2026-09', 1, 'de-DE')).toBe('Every 3 months, ends November')
    const nextYear = makeRecurring({ startMonth: '2026-09', everyMonths: 3, endMonth: '2027-01' })
    expect(scheduleLabel(nextYear, '2026-12', 1, 'de-DE')).toBe('Every 3 months, ends January 2027')
  })
})

/** The amount history after withAmountFrom on an item from 2026-01 with `amounts`. */
function amountsOf(amounts: AmountChange[], amount: number, from: MonthKey): AmountChange[] {
  return withAmountFrom(makeRecurring({ startMonth: '2026-01', amounts }), amount, from).amounts
}

describe('withAmountFrom', () => {
  it('§4.4 tests: an unchanged amount adds nothing, and later changes give way', () => {
    expect(amountsOf([{ from: '2026-01', amount: 1000 }], 1000, '2026-05')).toEqual([{ from: '2026-01', amount: 1000 }])
    expect(
      amountsOf(
        [
          { from: '2026-01', amount: 1000 },
          { from: '2026-05', amount: 1200 },
        ],
        1000,
        '2026-03',
      ),
    ).toEqual([{ from: '2026-01', amount: 1000 }])
  })

  it('adds a change from the given period on and drops the changes after it', () => {
    expect(amountsOf([{ from: '2026-01', amount: 1000 }], 1200, '2026-05')).toEqual([
      { from: '2026-01', amount: 1000 },
      { from: '2026-05', amount: 1200 },
    ])
    const history: AmountChange[] = [
      { from: '2026-01', amount: 1000 },
      { from: '2026-05', amount: 1200 },
      { from: '2026-09', amount: 1500 },
    ]
    expect(amountsOf(history, 1300, '2026-07')).toEqual([
      { from: '2026-01', amount: 1000 },
      { from: '2026-05', amount: 1200 },
      { from: '2026-07', amount: 1300 },
    ])
    expect(amountsOf(history, 1300, '2026-05')).toEqual([
      { from: '2026-01', amount: 1000 },
      { from: '2026-05', amount: 1300 },
    ])
  })

  it('replaces the whole history from startMonth or earlier', () => {
    const history: AmountChange[] = [
      { from: '2026-01', amount: 1000 },
      { from: '2026-05', amount: 1200 },
    ]
    expect(amountsOf(history, 2000, '2026-01')).toEqual([{ from: '2026-01', amount: 2000 }])
    expect(amountsOf(history, 2000, '2025-06')).toEqual([{ from: '2026-01', amount: 2000 }])
  })

  it('has no effect after the item ends', () => {
    const r = makeRecurring({ startMonth: '2026-01', endMonth: '2026-06', amount: 1000 })
    expect(withAmountFrom(r, 1200, '2026-08').amounts).toEqual([{ from: '2026-01', amount: 1000 }])
  })

  it('changes a spread item from the next cycle on', () => {
    const yearly = makeRecurring({ startMonth: '2026-01', amount: 12000, everyMonths: 12, spread: true })
    const raised = withAmountFrom(yearly, 14400, '2026-07')
    expect(lineFor(raised, '2026-07', NO_MONTHS, 1)?.amount).toBe(1000)
    expect(lineFor(raised, '2027-01', NO_MONTHS, 1)?.amount).toBe(1200)
  })

  it('keeps the other fields and leaves the item untouched', () => {
    const r = makeRecurring({ id: 'gym', name: 'Gym', startMonth: '2026-01', amount: 2990, dueDay: 3, note: 'Card' })
    const snapshot = structuredClone(r)
    const changed = withAmountFrom(r, 3490, '2026-10')
    expect(changed).toEqual({ ...snapshot, amounts: [...snapshot.amounts, { from: '2026-10', amount: 3490 }] })
    expect(r).toEqual(snapshot)
  })
})

describe('normalizeRecurring', () => {
  const history: AmountChange[] = [
    { from: '2026-01', amount: 1000 },
    { from: '2026-06', amount: 1200 },
  ]
  const base = makeRecurring({ startMonth: '2026-01', amounts: history })

  it('§4.4 tests: moves the history with startMonth and cuts it at endMonth', () => {
    expect(normalizeRecurring({ ...base, startMonth: '2025-10' }).amounts).toEqual([
      { from: '2025-10', amount: 1000 },
      { from: '2026-06', amount: 1200 },
    ])
    expect(normalizeRecurring({ ...base, startMonth: '2026-08' }).amounts).toEqual([{ from: '2026-08', amount: 1200 }])
    expect(normalizeRecurring({ ...base, endMonth: '2026-03' }).amounts).toEqual([{ from: '2026-01', amount: 1000 }])
  })

  it('sorts the history and keeps the last of equal months', () => {
    const r = makeRecurring({
      startMonth: '2026-01',
      amounts: [
        { from: '2026-05', amount: 1200 },
        { from: '2026-01', amount: 1000 },
        { from: '2026-05', amount: 1300 },
      ],
    })
    expect(normalizeRecurring(r).amounts).toEqual([
      { from: '2026-01', amount: 1000 },
      { from: '2026-05', amount: 1300 },
    ])
  })

  it('merges consecutive equal amounts, keeping the earlier', () => {
    const r = makeRecurring({
      startMonth: '2026-01',
      amounts: [
        { from: '2026-01', amount: 1000 },
        { from: '2026-03', amount: 1000 },
        { from: '2026-05', amount: 1200 },
        { from: '2026-07', amount: 1200 },
        { from: '2026-09', amount: 1000 },
      ],
    })
    expect(normalizeRecurring(r).amounts).toEqual([
      { from: '2026-01', amount: 1000 },
      { from: '2026-05', amount: 1200 },
      { from: '2026-09', amount: 1000 },
    ])
  })

  it('moves an endMonth before startMonth to startMonth and keeps the amount in force there', () => {
    const r = normalizeRecurring({ ...base, startMonth: '2026-05', endMonth: '2026-03' })
    expect(r.endMonth).toBe('2026-05')
    expect(r.amounts).toEqual([{ from: '2026-05', amount: 1000 }])
  })

  it('turns an unknown interval into monthly and spreads only items charged less often', () => {
    const invalid: number = 4
    const r = normalizeRecurring({ ...base, everyMonths: invalid as EveryMonths, spread: true })
    expect(r.everyMonths).toBe(1)
    expect(r.spread).toBe(false)
    expect(normalizeRecurring({ ...base, everyMonths: 1, spread: true }).spread).toBe(false)
    expect(normalizeRecurring({ ...base, everyMonths: 12, spread: true }).spread).toBe(true)
    for (const everyMonths of INTERVALS) {
      expect(normalizeRecurring({ ...base, everyMonths }).everyMonths).toBe(everyMonths)
    }
  })

  it('removes the category of income and keeps that of costs', () => {
    expect(normalizeRecurring({ ...base, kind: 'income', categoryId: 'cat-rent' }).categoryId).toBeNull()
    expect(normalizeRecurring({ ...base, categoryId: 'cat-rent' }).categoryId).toBe('cat-rent')
  })

  it('returns the item itself when it is already normal, and is idempotent', () => {
    expect(normalizeRecurring(base)).toBe(base)
    const repaired = normalizeRecurring({ ...base, startMonth: '2025-10', endMonth: '2025-01', spread: true })
    expect(normalizeRecurring(repaired)).toBe(repaired)
  })

  it('never changes its input', () => {
    const messy = makeRecurring({
      startMonth: '2026-03',
      endMonth: '2026-02',
      kind: 'income',
      categoryId: 'cat-rent',
      amounts: [
        { from: '2026-05', amount: 1200 },
        { from: '2026-01', amount: 1000 },
      ],
    })
    const snapshot = structuredClone(messy)
    normalizeRecurring(messy)
    expect(messy).toEqual(snapshot)
  })

  it('throws a RangeError for an item without amounts', () => {
    expect(() => normalizeRecurring(makeRecurring({ amounts: [] }))).toThrow(RangeError)
  })
})

describe('monthlyEquivalent', () => {
  it.each([
    [10000, 12, 833],
    [1000, 3, 333],
    [1000, 6, 167],
    [6, 12, 1],
    [5, 12, 0],
    [2990, 1, 2990],
  ] as const)('%i every %i months → %i a month', (amount, everyMonths, expected) => {
    expect(monthlyEquivalent(makeRecurring({ amount, everyMonths }), '2026-10')).toBe(expected)
  })

  it('uses the amount in force in the period', () => {
    const r = makeRecurring({
      startMonth: '2026-01',
      everyMonths: 12,
      amounts: [
        { from: '2026-01', amount: 12000 },
        { from: '2026-07', amount: 14400 },
      ],
    })
    expect(monthlyEquivalent(r, '2026-06')).toBe(1000)
    expect(monthlyEquivalent(r, '2026-07')).toBe(1200)
  })
})
