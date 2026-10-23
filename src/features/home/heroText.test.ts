import { describe, expect, it } from 'vitest'
import { createMoneyFormat } from '@/domain/money'
import { computeMonthSummary } from '@/domain/summary'
import { expense, income, makeData, makeRecurring } from '@/domain/test-helpers/budgetFixtures'
import type { Cents, ISODate, MonthKey, Transaction } from '@/domain/types'
import { aheadBy, heroKind, heroText, walletLine, type HeroTextOptions } from '@/features/home/heroText'

// The DESIGN.md sample: October 2026 (31 days), 1.450,00 € in, 778,88 € of fixed costs, 100,00 €
// of savings, so 571,12 € for daily life. Today is Sunday 18 October (day 18, 14 days left).
const TODAY: ISODate = '2026-10-18'
const OCTOBER: MonthKey = '2026-10'

const plain = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: false })
const hidden = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: true })
const format = (cents: Cents): string => plain.format(cents).replaceAll('-', '−')

function options(patch: Partial<HeroTextOptions> = {}): HeroTextOptions {
  return { format, speak: format, name: 'October', walletCounts: true, closedLabel: null, ...patch }
}

/** Intl puts a no-break space before "€"; the tests read it as a plain space. */
function spaced(text: string | null | undefined): string | null {
  return text === null || text === undefined ? null : text.replace(/[  ]/g, ' ')
}

interface Sample {
  incomeAmount?: Cents
  fixed?: Cents
  savings?: Cents
  expenses?: readonly Transaction[]
  month?: MonthKey
  today?: ISODate
}

function summaryOf({ incomeAmount = 145000, fixed = 77888, savings = 10000, expenses = [], month = OCTOBER, today = TODAY }: Sample) {
  const recurring = []
  if (incomeAmount > 0) recurring.push(makeRecurring({ kind: 'income', amount: incomeAmount, startMonth: '2026-08' }))
  if (fixed > 0) recurring.push(makeRecurring({ amount: fixed, startMonth: '2026-08' }))
  const data = makeData({ settings: { savingsGoal: savings }, recurring, transactions: [...expenses] })
  return computeMonthSummary(data, month, today)
}

describe('heroKind (SPEC §3.1 table)', () => {
  it.each([
    ['current without income', { incomeAmount: 0 }, 'noIncome'],
    ['current with fixed costs above income', { incomeAmount: 50000 }, 'fixedExceed'],
    ['current with fixed costs and savings equal to income', { incomeAmount: 87888 }, 'fixedExceed'],
    ['current over budget', { expenses: [expense('2026-10-05', 60000)] }, 'over'],
    ['current with money left', { expenses: [expense('2026-10-05', 30000)] }, 'left'],
    ['current on its last day', { today: '2026-10-31' as ISODate }, 'lastDay'],
    ['past without income', { incomeAmount: 0, month: '2026-09' as MonthKey }, 'pastSpent'],
    ['past left over', { month: '2026-09' as MonthKey, expenses: [expense('2026-09-03', 51230)] }, 'pastLeft'],
    ['past over budget', { month: '2026-09' as MonthKey, expenses: [expense('2026-09-03', 60000)] }, 'pastOver'],
    ['future planned', { month: '2026-11' as MonthKey }, 'planned'],
    ['future short', { month: '2026-11' as MonthKey, incomeAmount: 72000 }, 'short'],
  ] as const)('%s', (_name, sample, kind) => {
    expect(heroKind(summaryOf(sample))).toBe(kind)
  })
})

describe('heroText, current period', () => {
  it('says what is left, per day and for today, on track (DESIGN.md §9.4)', () => {
    const summary = summaryOf({ expenses: [expense('2026-10-05', 32840), expense(TODAY, 800)] })
    const text = heroText(summary, options())
    expect(text).toMatchObject({
      kind: 'left',
      label: 'Left to spend',
      labelTone: 'default',
      status: 'onTrack',
      figure: 23472,
      figureTone: 'default',
      figureKey: 'left',
      perDay: true,
      ahead: null,
      wallet: null,
      action: null,
      pace: true,
    })
    // floor((23472 + 800) / 14) = 1733: the mockup's 17,34 is rounded (tools/fixtures/README.md).
    expect(spaced(text.sentence)).toBe('About 17,33 € a day for the next 14 days')
    expect(spaced(text.today?.text)).toBe('Today: 9,33 € left')
    expect(text.today?.over).toBe(false)
    expect(spaced(text.compact)).toBe('234,72 € left')
    expect(spaced(text.speech)).toBe(
      'Left to spend, 234,72 €. On track. About 17,33 € a day for the next 14 days. Today, 9,33 € left.',
    )
  })

  it('runs ahead of the plan: "Spending fast" and how far ahead', () => {
    const summary = summaryOf({ expenses: [expense('2026-10-05', 39180), expense(TODAY, 800)] })
    expect(summary.pace.status).toBe('ahead')
    // 39980 − floor(57112 × 18 / 31) = 39980 − 33161
    expect(aheadBy(summary)).toBe(6819)
    const text = heroText(summary, options())
    expect(text.status).toBe('fast')
    expect(spaced(text.ahead)).toBe('68,19 € more than planned by today')
    expect(spaced(text.speech)).toContain('Spending fast.')
    expect(spaced(text.speech)).toMatch(/68,19 € more than planned by today\.$/)
  })

  it('says how far today went over its share', () => {
    const summary = summaryOf({ expenses: [expense('2026-10-05', 30000), expense(TODAY, 3000)] })
    const text = heroText(summary, options())
    // perDay floor((24112 + 3000) / 14) = 1936; today 1936 − 3000 = −1064.
    expect(text.today).toEqual({ text: 'Today: 10,64 € over', over: true })
    expect(spaced(text.speech)).toContain('Today, 10,64 € over.')
  })

  it('names the last day instead of the days to go', () => {
    const summary = summaryOf({ today: '2026-10-31', expenses: [expense('2026-10-05', 30000)] })
    const text = heroText(summary, options())
    expect(text.kind).toBe('lastDay')
    expect(text.sentence).toBe('Last day of this month.')
    expect(text.perDay).toBe(false)
    expect(text.figureKey).toBe('left')
    expect(spaced(text.today?.text)).toBe('Today: 271,12 € left')
  })

  it('is over budget: the overspend in critical ink and the pace bar', () => {
    const summary = summaryOf({ expenses: [expense('2026-10-05', 61240)] })
    const text = heroText(summary, options())
    expect(text).toMatchObject({
      kind: 'over',
      label: 'Over budget by',
      labelTone: 'critical',
      status: null,
      figure: 4128,
      figureTone: 'critical',
      figureKey: 'over',
      today: null,
      action: null,
      pace: true,
    })
    expect(spaced(text.sentence)).toBe('Spent 612,40 € of 571,12 € for daily life.')
    expect(spaced(text.compact)).toBe('41,28 € over budget')
  })

  it('says what the overspend does to the wallet (DESIGN.md §14 note 20)', () => {
    const covered = summaryOf({ expenses: [expense('2026-10-05', 61240)] })
    expect(spaced(heroText(covered, options()).wallet)).toBe(
      'Your savings cover it. October still adds 58,72 € to your wallet.',
    )
    const exactly = summaryOf({ expenses: [expense('2026-10-05', 67112)] })
    expect(heroText(exactly, options()).wallet).toBe('Your savings cover it.')
    const partly = summaryOf({ expenses: [expense('2026-10-05', 68312)] })
    expect(spaced(heroText(partly, options()).wallet)).toBe(
      'Your savings cover part of it. 12,00 € comes out of your wallet when October closes.',
    )
    const noSavings = summaryOf({ savings: 0, expenses: [expense('2026-10-05', 70000)] })
    expect(heroText(noSavings, options()).wallet).toBe('That comes out of your wallet when October closes.')
    expect(heroText(noSavings, options({ walletCounts: false })).wallet).toBeNull()
    expect(walletLine(noSavings, 'October', format)).toBe('That comes out of your wallet when October closes.')
  })

  it('has fixed costs and savings above the income: "Review fixed costs", no pace bar', () => {
    const summary = summaryOf({ incomeAmount: 80000, expenses: [expense('2026-10-05', 1000)] })
    const text = heroText(summary, options({ walletCounts: false }))
    expect(text).toMatchObject({
      kind: 'fixedExceed',
      label: 'Over budget by',
      labelTone: 'critical',
      figure: 8888,
      figureTone: 'critical',
      sentence: "Fixed costs and savings are more than this month's income.",
      action: 'reviewFixed',
      pace: false,
      wallet: null,
    })
  })

  it('has no income yet: what was spent and "Add your income"', () => {
    const summary = summaryOf({ incomeAmount: 0, expenses: [expense('2026-10-05', 1200)] })
    const text = heroText(summary, options())
    expect(text).toMatchObject({
      kind: 'noIncome',
      label: 'Spent this month',
      status: null,
      figure: 77888 + 1200,
      sentence: null,
      today: null,
      action: 'addIncome',
      pace: false,
    })
    expect(spaced(text.compact)).toBe('790,88 € spent')
    expect(spaced(text.speech)).toBe('Spent this month, 790,88 €.')
  })
})

describe('heroText, past and future periods', () => {
  const closed = 'Statement closed on 30 September'

  it('reads a closed month as a statement', () => {
    const summary = summaryOf({ month: '2026-09', expenses: [expense('2026-09-03', 51230)] })
    const text = heroText(summary, options({ name: 'September', closedLabel: closed }))
    expect(text).toMatchObject({ kind: 'pastLeft', label: 'Left over', figure: 5882, status: null, pace: true })
    // The compact header never repeats the label word for word.
    expect(spaced(text.compact)).toBe('58,82 € left over')
    expect(spaced(text.sentence)).toBe('You spent 512,30 € on daily life.')
    expect(spaced(text.speech)).toBe('Left over, 58,82 €. Statement closed on 30 September. You spent 512,30 € on daily life.')
  })

  it('reads a month that ended over budget in critical ink', () => {
    const summary = summaryOf({ month: '2026-09', expenses: [expense('2026-09-03', 60000)] })
    const text = heroText(summary, options({ name: 'September', closedLabel: closed }))
    expect(text).toMatchObject({ kind: 'pastOver', label: 'Over budget by', labelTone: 'critical', figure: 2888, figureTone: 'critical' })
    expect(text.wallet).toBeNull()
  })

  it('reads a closed month without income as what was spent', () => {
    const summary = summaryOf({ month: '2026-09', incomeAmount: 0 })
    const text = heroText(summary, options({ name: 'September', closedLabel: closed }))
    expect(text).toMatchObject({ kind: 'pastSpent', label: 'Spent', figure: 77888, sentence: null, pace: false })
    expect(spaced(text.speech)).toBe('Spent, 778,88 €. Statement closed on 30 September.')
  })

  it('plans a future month: what is available and per day across its days', () => {
    const text = heroText(summaryOf({ month: '2026-11' }), options({ name: 'November' }))
    expect(text).toMatchObject({ kind: 'planned', label: 'Planned', figure: 57112, perDay: true, pace: false })
    expect(spaced(text.compact)).toBe('571,12 € planned')
    expect(spaced(text.sentence)).toBe('19,03 € a day across 30 days')
  })

  it('never plans a negative amount per day', () => {
    const summary = summaryOf({ month: '2026-11', expenses: [expense('2026-11-02', 60000)] })
    expect(summary.perDay).toBeLessThan(0)
    expect(spaced(heroText(summary, options({ name: 'November' })).sentence)).toBe('0,00 € a day across 30 days')
  })

  it('says a future month is short', () => {
    const text = heroText(summaryOf({ month: '2026-11', incomeAmount: 72000 }), options({ name: 'November' }))
    expect(text).toMatchObject({
      kind: 'short',
      label: 'Short by',
      labelTone: 'critical',
      figure: 15888,
      figureTone: 'critical',
      sentence: 'Fixed costs and savings are more than the income planned.',
    })
    expect(spaced(text.compact)).toBe('Short by 158,88 €')
  })
})

describe('heroText with hidden amounts', () => {
  it('shows dots and speaks "Amount hidden"', () => {
    const summary = summaryOf({ expenses: [expense('2026-10-05', 32840), expense(TODAY, 800)] })
    const text = heroText(summary, options({ format: (c) => hidden.format(c), speak: () => 'Amount hidden' }))
    expect(text.sentence).toBe('About ••• a day for the next 14 days')
    expect(text.today?.text).toBe('Today: ••• left')
    expect(text.compact).toBe('••• left')
    expect(text.speech).toBe('Left to spend, Amount hidden. On track. About Amount hidden a day for the next 14 days. Today, Amount hidden left.')
  })

  it('counts one-off income like recurring income', () => {
    const summary = summaryOf({ incomeAmount: 0, expenses: [income('2026-10-02', 145000)] })
    expect(heroKind(summary)).toBe('left')
  })
})
