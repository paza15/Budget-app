import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { lineFor, linesFor, type RecurringLine } from '@/domain/recurring'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import { makeCategory, makeData, makeRecurring } from '@/domain/test-helpers/dataFixtures'
import type { AppData, MonthKey, Recurring } from '@/domain/types'
import {
  canTick,
  fixedCategoryKeys,
  groupByCategory,
  itemAmount,
  itemsWithoutLine,
  knownCategoryIds,
  lineSubtitle,
  overrideAt,
  paidCount,
  periodPhrase,
  rowAmount,
  todayDividerIndex,
} from '@/features/fixed/fixedModel'

const OCT: MonthKey = '2026-10'
const LOCALE = 'de-DE'

const rent = makeRecurring({ id: 'rent', name: 'Rent', dueDay: 1, order: 0 })
const netflix = makeRecurring({
  id: 'netflix',
  name: 'Netflix',
  categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
  amounts: [{ from: '2026-08', amount: 1399 }],
  dueDay: 22,
  order: 1,
})
const gym = makeRecurring({
  id: 'gym',
  name: 'Gym',
  categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
  amounts: [{ from: '2026-08', amount: 2990 }],
  dueDay: 15,
  order: 2,
})
/** Yearly in September, set aside monthly: 5,00 € in every other period. */
const insurance = makeRecurring({
  id: 'insurance',
  name: 'Liability insurance',
  categoryId: DEFAULT_CATEGORY_IDS.insurance,
  amounts: [{ from: '2026-09', amount: 6000 }],
  everyMonths: 12,
  spread: true,
  startMonth: '2026-09',
  dueDay: 15,
  order: 3,
})

function line(r: Recurring, month: MonthKey, months: AppData['months'] = {}): RecurringLine {
  const result = lineFor(r, month, months, 1)
  if (result === null) throw new Error(`${r.id} has no line in ${month}`)
  return result
}

describe('period names (docs/SPEC.md §3)', () => {
  it('says "this month" for the current period and names the others', () => {
    expect(periodPhrase(OCT, OCT, 1, LOCALE)).toBe('this month')
    expect(periodPhrase('2026-09', OCT, 1, LOCALE)).toBe('in September')
    expect(periodPhrase('2027-01', OCT, 1, LOCALE)).toBe('in January 2027')
    expect(periodPhrase('2025-12', OCT, 1, LOCALE)).toBe('in December 2025')
    expect(periodPhrase('2026-11', OCT, 1, LOCALE)).toBe('in November')
  })
})

describe('paidCount (§3.5)', () => {
  it('counts only charge lines that are not skipped', () => {
    const months: AppData['months'] = {
      [OCT]: { overrides: { rent: { paid: true }, gym: { skipped: true } } },
    }
    const lines = linesFor([rent, netflix, gym, insurance], 'expense', OCT, months, 1)
    expect(lines).toHaveLength(4)
    // The skipped gym is not due, and the insurance share is no charge.
    expect(paidCount(lines)).toEqual({ paid: 1, count: 2 })
  })

  it('lets a month end with everything paid', () => {
    const months: AppData['months'] = { [OCT]: { overrides: { rent: { paid: true }, gym: { skipped: true } } } }
    expect(paidCount(linesFor([rent, gym], 'expense', OCT, months, 1))).toEqual({ paid: 1, count: 1 })
  })

  it('ticks off charge lines only', () => {
    expect(canTick(line(rent, OCT))).toBe(true)
    expect(canTick(line(insurance, OCT))).toBe(false)
    expect(canTick(line(insurance, '2026-09'))).toBe(true)
    expect(canTick(line(gym, OCT, { [OCT]: { overrides: { gym: { skipped: true } } } }))).toBe(false)
  })
})

describe('lineSubtitle (§3.5)', () => {
  it('shows the schedule of a charge line', () => {
    expect(lineSubtitle(line(netflix, OCT), OCT, 1, LOCALE)).toEqual({ kind: 'text', text: 'Due on the 22nd' })
    expect(lineSubtitle(line(insurance, '2026-09'), OCT, 1, LOCALE)).toEqual({ kind: 'text', text: 'Yearly in September' })
  })

  it('says a line is skipped, in this month or another', () => {
    const months: AppData['months'] = { [OCT]: { overrides: { gym: { skipped: true } } }, '2026-11': { overrides: { gym: { skipped: true } } } }
    expect(lineSubtitle(line(gym, OCT, months), OCT, 1, LOCALE)).toEqual({ kind: 'text', text: 'Skipped this month' })
    expect(lineSubtitle(line(gym, '2026-11', months), OCT, 1, LOCALE)).toEqual({ kind: 'text', text: 'Skipped in November' })
  })

  it('gives the share a spread item sets aside outside its charge month', () => {
    expect(lineSubtitle(line(insurance, OCT), OCT, 1, LOCALE)).toEqual({ kind: 'setAside', amount: 500, phrase: 'this month' })
    expect(lineSubtitle(line(insurance, '2026-11'), OCT, 1, LOCALE)).toEqual({
      kind: 'setAside',
      amount: 500,
      phrase: 'in November',
    })
  })
})

describe('rowAmount', () => {
  it('shows what a line counts, and what a skipped one would have counted', () => {
    expect(rowAmount(line(netflix, OCT), {})).toBe(1399)
    const skipped: AppData['months'] = { [OCT]: { overrides: { netflix: { skipped: true } } } }
    expect(rowAmount(line(netflix, OCT, skipped), skipped)).toBe(1399)
    const different: AppData['months'] = { [OCT]: { overrides: { netflix: { skipped: true, amount: 999 } } } }
    expect(rowAmount(line(netflix, OCT, different), different)).toBe(999)
    const cycle: AppData['months'] = { '2026-09': { overrides: { insurance: { skipped: true } } } }
    expect(rowAmount(line(insurance, OCT, cycle), cycle)).toBe(500)
  })

  it('reads overrides with Object.hasOwn', () => {
    expect(overrideAt({}, OCT, 'constructor')).toBeUndefined()
    expect(overrideAt({ [OCT]: { overrides: { rent: { paid: true } } } }, OCT, 'rent')).toEqual({ paid: true })
  })
})

describe('categories (§3.5)', () => {
  const data = makeData()
  const archived = makeCategory('cat-old', { name: 'Old', order: 0.5, archived: true })
  const categories = [...data.categories, archived].toSorted((a, b) => a.order - b.order)
  const known = knownCategoryIds(categories)
  const orphan = makeRecurring({ id: 'orphan', name: 'Locker', categoryId: 'cat-gone', order: 9 })
  const old = makeRecurring({ id: 'old', name: 'Storage', categoryId: 'cat-old', order: 8 })
  const salary = makeRecurring({ id: 'salary', kind: 'income', order: 10 })

  it('offers a chip for every category with fixed costs, in category order, Uncategorized last', () => {
    expect(fixedCategoryKeys([orphan, insurance, netflix, salary, old, rent], categories, known)).toEqual([
      DEFAULT_CATEGORY_IDS.rent,
      'cat-old',
      DEFAULT_CATEGORY_IDS.subscriptions,
      DEFAULT_CATEGORY_IDS.insurance,
      UNCATEGORIZED_ID,
    ])
  })

  it('groups lines under their categories with subtotals', () => {
    const lines = linesFor([rent, netflix, gym, insurance, orphan], 'expense', OCT, {}, 1)
    const groups = groupByCategory(lines, categories, known)
    expect(groups.map((g) => [g.key, g.lines.map((l) => l.recurring.id), g.total])).toEqual([
      [DEFAULT_CATEGORY_IDS.rent, ['rent'], 65000],
      [DEFAULT_CATEGORY_IDS.subscriptions, ['gym', 'netflix'], 4389],
      [DEFAULT_CATEGORY_IDS.insurance, ['insurance'], 500],
      [UNCATEGORIZED_ID, ['orphan'], 65000],
    ])
  })
})

describe('itemsWithoutLine (§3.5 "Not this month")', () => {
  const ended = makeRecurring({ id: 'ended', name: 'Old gym', endMonth: '2026-08', order: 4 })
  const endedLater = makeRecurring({ id: 'ended-later', name: 'Club', endMonth: '2026-09', order: 5 })
  const later = makeRecurring({ id: 'later', name: 'New flat', startMonth: '2027-01', order: 6 })
  const quarterly = makeRecurring({
    id: 'quarterly',
    name: 'Rundfunkbeitrag',
    amounts: [{ from: '2026-09', amount: 5508 }],
    everyMonths: 3,
    startMonth: '2026-09',
    dueDay: 15,
    order: 7,
  })

  it('lists upcoming items by their next charge, then the ended ones, latest first', () => {
    const items = [ended, rent, later, endedLater, quarterly, makeRecurring({ id: 'job', kind: 'income' })]
    const lines = linesFor(items, 'expense', OCT, {}, 1)
    expect(itemsWithoutLine(items, 'expense', lines, OCT).map((r) => r.id)).toEqual([
      'quarterly',
      'later',
      'ended-later',
      'ended',
    ])
  })

  it('shows the amount of the next charge, or the last one', () => {
    const changing = makeRecurring({
      amounts: [
        { from: '2026-08', amount: 1000 },
        { from: '2027-01', amount: 1200 },
      ],
      everyMonths: 3,
      startMonth: '2026-08',
    })
    expect(itemAmount(changing, OCT)).toBe(1000)
    expect(itemAmount(changing, '2026-12')).toBe(1200)
    expect(itemAmount(ended, OCT)).toBe(65000)
  })
})

describe('todayDividerIndex (§3.5)', () => {
  const lines = linesFor([rent, gym, netflix, insurance], 'expense', OCT, {}, 1)

  it('goes before the first line due today or later', () => {
    // Rent (1st), Gym (15th), Netflix (22nd), then the insurance share without a date.
    expect(lines.map((l) => l.recurring.id)).toEqual(['rent', 'gym', 'netflix', 'insurance'])
    expect(todayDividerIndex(lines, '2026-10-14')).toBe(1)
    expect(todayDividerIndex(lines, '2026-10-15')).toBe(1)
    expect(todayDividerIndex(lines, '2026-10-16')).toBe(2)
  })

  it('comes first or last when everything is still to come or already due', () => {
    expect(todayDividerIndex(linesFor([gym, netflix], 'expense', OCT, {}, 1), '2026-10-01')).toBe(0)
    expect(todayDividerIndex(linesFor([gym, netflix], 'expense', OCT, {}, 1), '2026-10-30')).toBe(2)
  })

  it('is left out when no line has a due date', () => {
    const undated = makeRecurring({ dueDay: null })
    expect(todayDividerIndex(linesFor([undated, insurance], 'expense', OCT, {}, 1), '2026-10-14')).toBeNull()
    expect(todayDividerIndex([], '2026-10-14')).toBeNull()
  })
})
