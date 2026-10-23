import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCENTS, NUMBER_LOCALES } from '@/domain/catalog'
import { MAX_CENTS, MAX_LENGTHS, MAX_MONTH_START_DAY, MAX_QUICK_ADDS } from '@/domain/constants'
import { addMonths, compareISO, diffDays } from '@/domain/dates'
import { createDefaultWallet, DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { ID_PATTERN } from '@/domain/ids'
import { normalizeAppData, type NormalizeReport } from '@/domain/normalize'
import { periodDays, periodRange, shiftForStartDayChange, type PeriodRange } from '@/domain/period'
import { nextFreeCategoryColor } from '@/domain/queries'
import { dueDateFor, lineFor } from '@/domain/recurring'
import { unreviewedClosedMonth } from '@/domain/review'
import { myShare, owedSummary } from '@/domain/splits'
import { computeMonthSummary, UNCATEGORIZED_ID } from '@/domain/summary'
import {
  appDataProblems,
  daysAfterInstall,
  makeCategory,
  makeData,
  makeRecurring,
  NOW,
  sampleData,
  TODAY,
} from '@/domain/test-helpers/dataFixtures'
import type {
  AppData,
  MonthKey,
  Recurring,
  RecurringOverride,
  SavingsGoal,
  Settings,
  Transaction,
  WalletEntry,
} from '@/domain/types'
import { walletSummary } from '@/domain/wallet'
import {
  actions,
  periodShiftForStartDayChange,
  remapStartDay,
  type NewCategory,
  type NewGoal,
  type NewRecurring,
  type NewSplit,
  type NewTransaction,
  type NewWalletEntry,
  type SettingsPatch,
} from '@/store/actions'
import { getData, useAppStore } from '@/store/appStore'

const CLEAN_REPORT: NormalizeReport = {
  migratedFrom: null,
  dropped: { transactions: 0, recurring: 0, categories: 0, quickAdds: 0, overrides: 0 },
  repaired: 0,
}

const BRANCHES = ['settings', 'categories', 'recurring', 'transactions', 'quickAdds', 'months', 'wallet'] as const
type Branch = (typeof BRANCHES)[number]

const START_DAYS = Array.from({ length: MAX_MONTH_START_DAY }, (_, i) => i + 1)
const DUE_DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

/** §9: normalizeAppData is idempotent on action results, so an action's data loads back unchanged. */
function expectNormalized(data: AppData): void {
  expect(appDataProblems(data)).toEqual([])
  const again = normalizeAppData(data, NOW + 1)
  expect(again.data).toStrictEqual(data)
  expect(again.report).toStrictEqual(CLEAN_REPORT)
}

/** What an action did: replaced the data, left it as it was, or rejected its input. */
type Outcome = 'changed' | 'unchanged' | 'rejected'

/**
 * Runs one action and says what it did, checking on the way the rules every action keeps (a
 * broken rule throws): exactly one setState when the data changes and none otherwise, a result
 * that normalises to itself, and untouched data when it rejects its input with a RangeError.
 */
function outcome(action: () => unknown): Outcome {
  const before = getData()
  let updates = 0
  const unsubscribe = useAppStore.subscribe(() => {
    updates += 1
  })
  let rejected = false
  try {
    action()
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    rejected = true
  } finally {
    unsubscribe()
  }
  const after = getData()
  if (rejected) {
    if (after !== before || updates > 0) throw new Error('A rejected action changed the data.')
    return 'rejected'
  }
  if (updates !== (after === before ? 0 : 1)) throw new Error(`The action set the data ${updates} times.`)
  expectNormalized(after)
  return after === before ? 'unchanged' : 'changed'
}

/** Runs an action that must change the data; returns the data before and after. */
function run(action: () => unknown): { before: AppData; after: AppData } {
  const before = getData()
  const result = outcome(action)
  if (result !== 'changed') throw new Error(`Expected the action to change the data, but it ${result} it.`)
  return { before, after: getData() }
}

/** The branches that are new objects are exactly `changed`; every other branch keeps its identity. */
function expectChangedBranches(before: AppData, after: AppData, ...changed: Branch[]): void {
  const replaced = BRANCHES.filter((branch) => after[branch] !== before[branch])
  expect(replaced).toEqual(BRANCHES.filter((branch) => changed.includes(branch)))
}

function setData(data: AppData): void {
  useAppStore.setState({ data, status: 'ready' })
}

function settingsWith(patch: Partial<Settings>): Settings {
  return { ...makeData().settings, ...patch }
}

function recurringById(id: string, data = getData()): Recurring {
  const item = data.recurring.find((r) => r.id === id)
  if (item === undefined) throw new Error(`No recurring item ${id}`)
  return item
}

function overrideOf(month: MonthKey, id: string, data = getData()): RecurringOverride | undefined {
  return data.months[month]?.overrides?.[id]
}

function txById(id: string, data = getData()): Transaction {
  const tx = data.transactions.find((t) => t.id === id)
  if (tx === undefined) throw new Error(`No transaction ${id}`)
  return tx
}

function goalById(id: string, data = getData()): SavingsGoal {
  const goal = data.wallet.goals.find((g) => g.id === id)
  if (goal === undefined) throw new Error(`No goal ${id}`)
  return goal
}

function entryById(id: string, data = getData()): WalletEntry {
  const entry = data.wallet.entries.find((e) => e.id === id)
  if (entry === undefined) throw new Error(`No wallet entry ${id}`)
  return entry
}

/** The ids of the active goals in fill order, as the wallet fills them (§3.14). */
function fillOrder(data = getData()): string[] {
  return walletSummary(data, TODAY).goals.map(({ goal }) => goal.id)
}

/** Each active goal's id and what it holds of the balance, in fill order (§3.14, §4.9). */
function goalFills(data = getData()): [string, number][] {
  return walletSummary(data, TODAY).goals.map(({ goal, filled }) => [goal.id, filled])
}

/** A small seeded generator (mulberry32), so a failing random case replays exactly. */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Σ amounts. */
function totalOf(splits: readonly { amount: number }[]): number {
  return splits.reduce((sum, { amount }) => sum + amount, 0)
}

function expensesOf(data: AppData): Transaction[] {
  return data.transactions.filter((tx) => tx.kind === 'expense')
}

/** The transaction added last. */
function lastTx(): Transaction {
  const tx = getData().transactions.at(-1)
  if (tx === undefined) throw new Error('No transaction yet')
  return tx
}

/** The id of the goal at `index` in the stored list, or '' (which no action accepts). */
function goalId(index: number): string {
  return getData().wallet.goals[index]?.id ?? ''
}

/** An expense of 3,50 in Coffee & snacks today with `splits`, for the split rules. */
function splitExpense(splits: unknown, amount: unknown = 350): NewTransaction {
  return { kind: 'expense', amount, categoryId: 'cat-coffee', date: TODAY, splits } as NewTransaction
}

/** Days two inclusive date ranges have in common. */
function sharedDays(a: PeriodRange, b: PeriodRange): number {
  const start = compareISO(a.start, b.start) >= 0 ? a.start : b.start
  const end = compareISO(a.end, b.end) <= 0 ? a.end : b.end
  return Math.max(0, diffDays(start, end) + 1)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  setData(sampleData())
})

afterEach(() => {
  vi.useRealTimers()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('updateSettings', () => {
  it('changes the given fields and nothing else', () => {
    const accent = ACCENTS.find(({ key }) => key !== getData().settings.accent)?.key
    if (accent === undefined) throw new Error('The catalog needs two accents')
    const { before, after } = run(() =>
      actions.updateSettings({ name: 'Sam', theme: 'light', accent, showCents: true, hideAmounts: false }),
    )
    expect(after.settings).toEqual({
      ...before.settings,
      name: 'Sam',
      theme: 'light',
      accent,
      showCents: true,
      hideAmounts: false,
    })
    expectChangedBranches(before, after, 'settings')
    expect(after.settings.homeCards).toBe(before.settings.homeCards)
  })

  it('trims the name and cuts it to 24 characters, keeping whole emoji', () => {
    run(() => actions.updateSettings({ name: '  Alexandra  ' }))
    expect(getData().settings.name).toBe('Alexandra')
    run(() => actions.updateSettings({ name: `${'x'.repeat(23)}👩‍💻👩‍💻 ` }))
    expect(getData().settings.name).toBe(`${'x'.repeat(23)}👩‍💻`)
  })

  it('accepts a single emoji avatar or the monogram', () => {
    run(() => actions.updateSettings({ avatar: ' 🐼 ' }))
    expect(getData().settings.avatar).toBe('🐼')
    run(() => actions.updateSettings({ avatar: '' }))
    expect(getData().settings.avatar).toBe('')
  })

  it('accepts currencies and number formats Intl knows, in canonical form', () => {
    run(() => actions.updateSettings({ currency: 'JPY', locale: 'en-US', homeCards: ['recent', 'equation'] }))
    expect(getData().settings).toMatchObject({ currency: 'JPY', locale: 'en-US', homeCards: ['recent', 'equation'] })
    // Not offered in the picker, but a format Intl supports loads as it is (§4.7).
    run(() => actions.updateSettings({ locale: 'ja-JP' }))
    expect(getData().settings.locale).toBe('ja-JP')
  })

  it('accepts every offered number format as listed, even one the engine has no data for (sq-AL in Chromium)', () => {
    const supportedLocalesOf = Intl.NumberFormat.supportedLocalesOf.bind(Intl.NumberFormat)
    // Chromium ships no Albanian number data, so Intl does not list sq-AL as supported there.
    vi.spyOn(Intl.NumberFormat, 'supportedLocalesOf').mockImplementation((locales, options) =>
      supportedLocalesOf(locales, options).filter((locale) => locale !== 'sq-AL'),
    )
    expect(Intl.NumberFormat.supportedLocalesOf(['sq-AL'])).toEqual([])
    for (const { locale } of NUMBER_LOCALES) {
      expect(outcome(() => actions.updateSettings({ locale }))).not.toBe('rejected')
      expect(getData().settings.locale).toBe(locale)
    }
  })

  it('changes nothing when every value is already set', () => {
    const { settings } = getData()
    const same = { name: settings.name, homeCards: [...settings.homeCards], theme: settings.theme }
    expect(outcome(() => actions.updateSettings(same))).toBe('unchanged')
    expect(outcome(() => actions.updateSettings({}))).toBe('unchanged')
  })

  it('treats undefined values as not given', () => {
    expect(outcome(() => actions.updateSettings({ name: undefined, theme: undefined }))).toBe('unchanged')
  })

  it.each<[string, Record<string, unknown>]>([
    ['a lower-case currency', { currency: 'eur' }],
    ['a currency of four letters', { currency: 'EURO' }],
    ['a non-canonical locale', { locale: 'de-de' }],
    ['an offered locale in another case', { locale: 'sq-al' }],
    ['a malformed locale', { locale: 'not a locale!' }],
    ['a locale Intl does not support', { locale: 'xx-YY' }],
    ['a locale that is not text', { locale: 49 }],
    ['an unknown theme', { theme: 'blue' }],
    ['an unknown accent', { accent: 'pink' }],
    ['an avatar with letters', { avatar: 'AB' }],
    ['two emoji as avatar', { avatar: '🐼🐼' }],
    ['a name that is not text', { name: 42 }],
    ['a flag that is not boolean', { showCents: 'yes' }],
    ['an unknown Home card', { homeCards: ['equation', 'weather'] }],
    ['a Home card twice', { homeCards: ['recent', 'recent'] }],
    ['Home cards that are no list', { homeCards: 'recent' }],
    ['monthStartDay (setMonthStartDay)', { monthStartDay: 25 }],
    ['savingsGoal (setSavingsGoal)', { savingsGoal: 100 }],
    ['lastBackupAt (markBackupDone)', { lastBackupAt: NOW }],
    ['lastReviewedMonth (markReviewed)', { lastReviewedMonth: '2026-10' }],
    ['createdAt', { createdAt: NOW }],
    ['an unknown field', { colour: 'red' }],
  ])('rejects %s', (_name, patch) => {
    expect(outcome(() => actions.updateSettings(patch as SettingsPatch))).toBe('rejected')
  })
})

describe('periodShiftForStartDayChange', () => {
  it.each<[number, number, number]>([
    [1, 1, 0],
    [25, 27, 0],
    [10, 20, 0],
    [20, 10, 0],
    [1, 16, 0],
    [16, 1, 0],
    [1, 17, -1],
    [17, 1, 1],
    [1, 25, -1],
    [25, 1, 1],
    [5, 25, -1],
    [1, 28, -1],
    [28, 1, 1],
  ])('from %i to %i moves keys by %i', (from, to, shift) => {
    expect(periodShiftForStartDayChange(from, to)).toBe(shift)
  })

  it('is undone by changing back, for all pairs of start days', () => {
    for (const a of START_DAYS) {
      for (const b of START_DAYS) expect(periodShiftForStartDayChange(a, b) + periodShiftForStartDayChange(b, a)).toBe(0)
    }
  })

  it.each([0, 29, 1.5, Number.NaN])('rejects the start day %j', (day) => {
    expect(() => periodShiftForStartDayChange(day, 1)).toThrow(RangeError)
    expect(() => periodShiftForStartDayChange(1, day)).toThrow(RangeError)
  })
})

describe('setMonthStartDay', () => {
  const rent = makeRecurring({ id: 'rec-rent', startMonth: '2026-01', dueDay: 1 })
  const gym = makeRecurring({
    id: 'rec-gym',
    name: 'Gym',
    categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
    startMonth: '2026-01',
    amounts: [{ from: '2026-01', amount: 2990 }],
    dueDay: 28,
  })

  it('remaps period keys so every charge keeps its due date (§4.3 test)', () => {
    setData(makeData({ recurring: [rent, gym], months: { '2026-10': { overrides: { 'rec-rent': { paid: true } } } } }))
    const { before, after } = run(() => actions.setMonthStartDay(25))

    const movedRent = recurringById('rec-rent')
    expect(movedRent.startMonth).toBe('2025-12')
    expect(movedRent.amounts).toEqual([{ from: '2025-12', amount: 65000 }])
    expect(after.months).toEqual({ '2026-09': { overrides: { 'rec-rent': { paid: true } } } })
    const line = lineFor(movedRent, '2026-09', after.months, 25)
    expect(line?.dueDate).toBe('2026-10-01')
    expect(line?.paid).toBe(true)

    expect(recurringById('rec-gym')).toBe(gym)
    expect(after.settings.monthStartDay).toBe(25)
    expectChangedBranches(before, after, 'settings', 'recurring', 'months')
  })

  it('moves end months and the whole amount history with the item', () => {
    const item = makeRecurring({
      id: 'rec-x',
      startMonth: '2026-01',
      endMonth: '2026-12',
      amounts: [
        { from: '2026-01', amount: 1000 },
        { from: '2026-06', amount: 1200 },
      ],
      dueDay: 3,
    })
    setData(makeData({ recurring: [item] }))
    run(() => actions.setMonthStartDay(10))
    expect(recurringById('rec-x')).toMatchObject({
      startMonth: '2025-12',
      endMonth: '2026-11',
      amounts: [
        { from: '2025-12', amount: 1000 },
        { from: '2026-05', amount: 1200 },
      ],
    })
  })

  it('moves period savings goals to the new period holding most of their days, and back', () => {
    const months = { '2026-10': { savingsGoal: 5000 }, '2026-11': { savingsGoal: 0 } }
    setData(makeData({ months }))
    const { before, after } = run(() => actions.setMonthStartDay(25))
    // 1–31 Oct shares 24 days with 25 Sep – 24 Oct ('2026-09') and 7 with 25 Oct – 24 Nov.
    expect(after.months).toEqual({ '2026-09': { savingsGoal: 5000 }, '2026-10': { savingsGoal: 0 } })
    expectChangedBranches(before, after, 'settings', 'months')

    // 25 Sep – 24 Oct shares 24 days with 1–31 Oct: moving 20 days earlier brings them back.
    run(() => actions.setMonthStartDay(5))
    expect(getData().months).toEqual(months)
  })

  it('leaves keys without a due date alone when the start day moves a little (review: 25 → 27)', () => {
    const undated = makeRecurring({
      id: 'rec-gym',
      name: 'Gym',
      categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
      startMonth: '2026-09',
      amounts: [{ from: '2026-09', amount: 2990 }],
      dueDay: null,
    })
    const data = makeData({
      settings: settingsWith({ monthStartDay: 25, lastReviewedMonth: '2026-08' }),
      recurring: [undated],
      months: { '2026-09': { savingsGoal: 30000 } },
      wallet: { ...createDefaultWallet(), startMonth: '2026-09' },
    })
    setData(data)
    expect(computeMonthSummary(data, '2026-09', TODAY)).toMatchObject({ timing: 'current', fixed: 2990, savings: 30000 })

    const { before, after } = run(() => actions.setMonthStartDay(27))
    // 27 Sep – 26 Oct shares 28 days with 25 Sep – 24 Oct, so the charge and the goal stay with it,
    // and the closed period before it gains nothing.
    expect(computeMonthSummary(after, '2026-09', TODAY)).toMatchObject({ timing: 'current', fixed: 2990, savings: 30000 })
    expect(computeMonthSummary(after, '2026-08', TODAY)).toMatchObject({ timing: 'past', fixed: 0, savings: 0 })
    expect(recurringById('rec-gym')).toBe(undated)
    expect(after.wallet.startMonth).toBe('2026-09')
    expect(after.settings).toEqual({ ...before.settings, monthStartDay: 27 })
    expectChangedBranches(before, after, 'settings')
  })

  it('puts everything back when the start day changes back (review: 1 → 25 → 1)', () => {
    const undated = makeRecurring({
      id: 'rec-gym',
      name: 'Gym',
      categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
      startMonth: '2026-10',
      amounts: [{ from: '2026-10', amount: 2990 }],
      dueDay: null,
    })
    const original = makeData({
      recurring: [rent, undated],
      months: { '2026-10': { overrides: { 'rec-gym': { paid: true }, 'rec-rent': { amount: 60000 } }, savingsGoal: 30000 } },
      wallet: { ...createDefaultWallet(), startMonth: '2026-10' },
    })
    setData(original)

    run(() => actions.setMonthStartDay(25))
    // 1–31 Oct shares 24 days with 25 Sep – 24 Oct, the period now called '2026-09'.
    expect(recurringById('rec-gym').startMonth).toBe('2026-09')
    expect(getData().months).toEqual({
      '2026-09': { overrides: { 'rec-gym': { paid: true }, 'rec-rent': { amount: 60000 } }, savingsGoal: 30000 },
    })
    expect(getData().wallet.startMonth).toBe('2026-09')

    run(() => actions.setMonthStartDay(1))
    expect(getData()).toEqual(original)
    const october = computeMonthSummary(getData(), '2026-10', TODAY)
    expect(october).toMatchObject({ fixed: 60000 + 2990, savings: 30000 })
    expect(october.fixedLines.find((line) => line.recurring.id === 'rec-gym')?.paid).toBe(true)
  })

  it('puts every key back when the start day changes back, for all pairs of start days (property)', () => {
    const items = [
      ...DUE_DAYS.map((dueDay) =>
        makeRecurring({
          id: `rec-${dueDay}`,
          startMonth: '2025-11',
          endMonth: '2027-01',
          amounts: [
            { from: '2025-11', amount: 1000 + dueDay },
            { from: '2026-03', amount: 2000 + dueDay },
          ],
          dueDay,
        }),
      ),
      makeRecurring({ id: 'rec-none', startMonth: '2025-11', dueDay: null }),
    ]
    const months: AppData['months'] = {
      '2026-01': { overrides: Object.fromEntries(items.map((item) => [item.id, { paid: true }])), savingsGoal: 1000 },
      '2026-02': { savingsGoal: 0 },
    }
    for (const a of START_DAYS) {
      const data = makeData({
        settings: settingsWith({ monthStartDay: a, lastReviewedMonth: '2026-01' }),
        recurring: items,
        months,
        wallet: { ...createDefaultWallet(), startMonth: '2026-01' },
      })
      for (const b of START_DAYS) {
        const remapped = remapStartDay(data, b)
        // The reviewed period is a key without a date, so it moves with the wallet's first period.
        expect(remapped.settings.lastReviewedMonth, `${a} → ${b}`).toBe(remapped.wallet.startMonth)
        expect(remapStartDay(remapped, a), `${a} → ${b} → ${a}`).toEqual(data)
      }
    }
  })

  it('moves keys without a due date to the new period holding most of their days (property)', () => {
    // Periods of 28, 29, 30 and 31 days.
    const periods: MonthKey[] = ['2027-02', '2028-02', '2026-04', '2026-10']
    const problems: string[] = []
    for (const a of START_DAYS) {
      for (const b of START_DAYS) {
        const shift = periodShiftForStartDayChange(a, b)
        for (const month of periods) {
          const old = periodRange(month, a)
          const shared = (key: MonthKey) => sharedDays(old, periodRange(key, b))
          const kept = shared(addMonths(month, shift))
          const most = Math.max(shared(addMonths(month, -1)), shared(month), shared(addMonths(month, 1)))
          // The one exception: a 28- or 29-day period moved by exactly 15 days keeps its key.
          const exception = Math.abs(a - b) === 15 && periodDays(month, a) < 30 && shift === 0
          if (kept < most && !exception) problems.push(`${month} from ${a} to ${b}: ${kept} of ${most} days`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('moves the wallet’s first period like period savings goals (§4.8)', () => {
    setData(makeData({ wallet: { ...createDefaultWallet(), startMonth: '2026-10' } }))
    const { before, after } = run(() => actions.setMonthStartDay(25))
    expect(after.wallet).toEqual({ ...before.wallet, startMonth: '2026-09' })
    expectChangedBranches(before, after, 'settings', 'wallet')

    run(() => actions.setMonthStartDay(27))
    expect(getData().wallet.startMonth).toBe('2026-09')
    run(() => actions.setMonthStartDay(1))
    expect(getData().wallet.startMonth).toBe('2026-10')
  })

  it('keeps the wallet’s entries and goals when its first period moves', () => {
    const data = sampleData()
    setData({ ...data, wallet: { ...data.wallet, startMonth: '2026-10' } })
    const { before, after } = run(() => actions.setMonthStartDay(25))
    expect(after.wallet.startMonth).toBe('2026-09')
    expect(after.wallet.entries).toBe(before.wallet.entries)
    expect(after.wallet.goals).toBe(before.wallet.goals)
  })

  it('keeps a wallet that starts with the set-up period as it is', () => {
    const { before, after } = run(() => actions.setMonthStartDay(25))
    expect(before.wallet.startMonth).toBeNull()
    expect(after.wallet).toBe(before.wallet)
  })

  it('moves the reviewed period with the keys without a date, so the banner offers the next period once (review: 1 → 25 → 1)', () => {
    // 1–30 Sep was reviewed under the 1st; the wallet counts from August.
    const original = makeData({
      settings: settingsWith({ lastReviewedMonth: '2026-09' }),
      wallet: { ...createDefaultWallet(), startMonth: '2026-08' },
    })
    setData(original)

    const { before, after } = run(() => actions.setMonthStartDay(25))
    // Under the 25th most of 1–30 Sep lies in 2026-08 (25 Aug – 24 Sep), as for the wallet's start.
    expect(after.settings).toEqual({ ...before.settings, monthStartDay: 25, lastReviewedMonth: '2026-08' })
    expect(after.wallet.startMonth).toBe('2026-07')
    expectChangedBranches(before, after, 'settings', 'wallet')
    // 19 October lies in 2026-09 (25 Sep – 24 Oct), which is still running.
    expect(unreviewedClosedMonth(after, '2026-10-19')).toBeNull()
    expect(unreviewedClosedMonth(after, '2026-10-24')).toBeNull()
    // It closes on 24 October and was never reviewed, so the banner offers it from the 25th.
    expect(unreviewedClosedMonth(after, '2026-10-25')).toBe('2026-09')

    // Changing back puts the reviewed period back: September is not offered again, October is once it closes.
    run(() => actions.setMonthStartDay(1))
    expect(getData()).toEqual(original)
    expect(unreviewedClosedMonth(getData(), '2026-10-19')).toBeNull()
    expect(unreviewedClosedMonth(getData(), '2026-11-01')).toBe('2026-10')
  })

  it('never offers a period again when most of its days were reviewed under the old start day (review: 25 → 1)', () => {
    // 25 Aug – 24 Sep (2026-08) was reviewed under the 25th; the wallet counts from July.
    setData(
      makeData({
        settings: settingsWith({ monthStartDay: 25, lastReviewedMonth: '2026-08' }),
        wallet: { ...createDefaultWallet(), startMonth: '2026-07' },
      }),
    )
    expect(unreviewedClosedMonth(getData(), '2026-10-19')).toBeNull()

    const { after } = run(() => actions.setMonthStartDay(1))
    // 1–30 Sep (2026-09) holds 24 of the reviewed days, so it counts as reviewed.
    expect(after.settings.lastReviewedMonth).toBe('2026-09')
    expect(after.wallet.startMonth).toBe('2026-08')
    expect(unreviewedClosedMonth(after, '2026-10-19')).toBeNull()
    expect(unreviewedClosedMonth(after, '2026-10-31')).toBeNull()
    expect(unreviewedClosedMonth(after, '2026-11-01')).toBe('2026-10')
  })

  it('keeps data in which no period was reviewed without one', () => {
    setData(makeData({ wallet: { ...createDefaultWallet(), startMonth: '2026-10' } }))
    const { before, after } = run(() => actions.setMonthStartDay(25))
    expect(before.settings.lastReviewedMonth).toBeNull()
    expect(after.settings).toEqual({ ...before.settings, monthStartDay: 25 })
  })

  it('combines moved overrides and savings goals in one period', () => {
    setData(
      makeData({
        recurring: [rent, gym],
        months: { '2026-10': { overrides: { 'rec-rent': { paid: true }, 'rec-gym': { amount: 1500 } }, savingsGoal: 7000 } },
      }),
    )
    run(() => actions.setMonthStartDay(25))
    expect(getData().months).toEqual({
      '2026-09': { overrides: { 'rec-rent': { paid: true } }, savingsGoal: 7000 },
      '2026-10': { overrides: { 'rec-gym': { amount: 1500 } } },
    })
  })

  it('moves items without a due day with most of their days, overrides and amount history included', () => {
    const undated = makeRecurring({
      id: 'rec-undated',
      startMonth: '2026-03',
      amounts: [
        { from: '2026-03', amount: 1000 },
        { from: '2026-06', amount: 1200 },
      ],
      dueDay: null,
    })
    setData(
      makeData({
        settings: settingsWith({ monthStartDay: 10 }),
        recurring: [undated],
        months: { '2026-06': { overrides: { 'rec-undated': { paid: true } } } },
      }),
    )
    // 10 Mar – 9 Apr shares 16 days with 25 Mar – 24 Apr and 15 with 25 Feb – 24 Mar.
    const { before, after } = run(() => actions.setMonthStartDay(25))
    expect(recurringById('rec-undated')).toBe(undated)
    expectChangedBranches(before, after, 'settings')

    // 25 Mar – 24 Apr shares 24 days with 1–30 Apr.
    run(() => actions.setMonthStartDay(1))
    expect(recurringById('rec-undated')).toMatchObject({
      startMonth: '2026-04',
      amounts: [
        { from: '2026-04', amount: 1000 },
        { from: '2026-07', amount: 1200 },
      ],
    })
    expect(getData().months).toEqual({ '2026-07': { overrides: { 'rec-undated': { paid: true } } } })
  })

  it('leaves transactions alone', () => {
    const { before, after } = run(() => actions.setMonthStartDay(15))
    expect(after.transactions).toBe(before.transactions)
  })

  it('changes nothing for the current start day', () => {
    expect(outcome(() => actions.setMonthStartDay(1))).toBe('unchanged')
  })

  it.each([0, 29, 1.5, Number.NaN, '5'])('rejects the start day %j', (day) => {
    expect(outcome(() => actions.setMonthStartDay(day as number))).toBe('rejected')
  })

  it('rejects a change that would move a period out of the supported years', () => {
    const ancient = makeRecurring({ id: 'rec-old', startMonth: '1900-01', dueDay: 1 })
    setData(makeData({ recurring: [ancient] }))
    expect(outcome(() => actions.setMonthStartDay(25))).toBe('rejected')

    setData(makeData({ wallet: { ...createDefaultWallet(), startMonth: '1900-01' } }))
    expect(outcome(() => actions.setMonthStartDay(25))).toBe('rejected')

    setData(makeData({ settings: settingsWith({ lastReviewedMonth: '1900-01' }) }))
    expect(outcome(() => actions.setMonthStartDay(25))).toBe('rejected')

    setData(makeData({ settings: settingsWith({ monthStartDay: 25, lastReviewedMonth: '2999-12' }) }))
    expect(outcome(() => actions.setMonthStartDay(1))).toBe('rejected')
    // A change of less than 16 days moves no key without a date, so it goes through.
    expect(outcome(() => actions.setMonthStartDay(10))).toBe('changed')
    expect(getData().settings.lastReviewedMonth).toBe('2999-12')
  })

  // 784 pairs of start days × 32 items × 4 periods: allow for a busy machine.
  it('keeps every due date, override and amount for all start days and due days (property)', { timeout: 30_000 }, () => {
    // Across New Year, and the two periods holding overrides.
    const periods: MonthKey[] = ['2025-12', '2026-01', '2026-02', '2027-01']
    const items = [
      ...DUE_DAYS.map((dueDay) =>
        makeRecurring({
          id: `rec-${dueDay}`,
          startMonth: '2025-11',
          amounts: [{ from: '2025-11', amount: 1000 + dueDay }],
          everyMonths: dueDay % 4 === 0 ? 3 : 1,
          dueDay,
        }),
      ),
      makeRecurring({ id: 'rec-none', startMonth: '2025-11', dueDay: null }),
    ]
    const months: AppData['months'] = {
      '2026-01': { overrides: Object.fromEntries(items.map((item) => [item.id, { paid: true }])) },
      '2026-02': { overrides: Object.fromEntries(items.map((item) => [item.id, { amount: 777 }])) },
    }
    const problems: string[] = []
    for (const from of START_DAYS) {
      const data = makeData({ settings: settingsWith({ monthStartDay: from }), recurring: items, months })
      for (const to of START_DAYS) {
        const remapped = remapStartDay(data, to)
        for (const original of items) {
          const moved = recurringById(original.id, remapped)
          const shift =
            original.dueDay === null
              ? periodShiftForStartDayChange(from, to)
              : shiftForStartDayChange(original.dueDay, from, to)
          for (const month of periods) {
            const target = addMonths(month, shift)
            const was = lineFor(original, month, data.months, from)
            const is = lineFor(moved, target, remapped.months, to)
            const same =
              dueDateFor(moved, target, to) === dueDateFor(original, month, from) &&
              is?.amount === was?.amount &&
              is?.paid === was?.paid &&
              is?.isChargeMonth === was?.isChargeMonth
            if (!same) problems.push(`${original.id} ${month} from ${from} to ${to}`)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })
})

describe('setSavingsGoal', () => {
  it('keeps the old goal for past periods (§5.4 test)', () => {
    setData(makeData())
    run(() => actions.setSavingsGoal(20000, '2026-10-18'))
    const data = getData()
    expect(data.settings.savingsGoal).toBe(20000)
    expect(data.months).toEqual({ '2026-08': { savingsGoal: 0 }, '2026-09': { savingsGoal: 0 } })
    expect(computeMonthSummary(data, '2026-10', '2026-10-18').savings).toBe(20000)
    expect(computeMonthSummary(data, '2026-09', '2026-10-18').savings).toBe(0)
    expect(computeMonthSummary(data, '2026-11', '2026-10-18').savings).toBe(20000)
  })

  it('leaves periods with a goal of their own alone and keeps their overrides', () => {
    setData(
      makeData({
        recurring: [makeRecurring()],
        months: { '2026-08': { overrides: { 'rec-1': { paid: true } } }, '2026-09': { savingsGoal: 3000 } },
      }),
    )
    run(() => actions.setSavingsGoal(10000, TODAY))
    expect(getData().months).toEqual({
      '2026-08': { overrides: { 'rec-1': { paid: true } }, savingsGoal: 0 },
      '2026-09': { savingsGoal: 3000 },
    })
  })

  it('freezes at most 60 periods back', () => {
    setData(makeData({ settings: settingsWith({ createdAt: Date.UTC(2015, 0, 1), savingsGoal: 4000 }) }))
    run(() => actions.setSavingsGoal(0, TODAY))
    const keys = Object.keys(getData().months).toSorted()
    expect(keys).toHaveLength(60)
    expect(keys.at(0)).toBe('2021-10')
    expect(keys.at(-1)).toBe('2026-09')
    expect(getData().months['2021-10']).toEqual({ savingsGoal: 4000 })
  })

  it('follows the start day when finding the current period', () => {
    setData(makeData({ settings: settingsWith({ monthStartDay: 25 }) }))
    // 14 Oct lies in the period that started on 25 Sep.
    run(() => actions.setSavingsGoal(5000, TODAY))
    expect(Object.keys(getData().months).toSorted()).toEqual(['2026-07', '2026-08'])
  })

  it('changes nothing for the current goal, and accepts 0', () => {
    expect(outcome(() => actions.setSavingsGoal(20000, TODAY))).toBe('unchanged')
    run(() => actions.setSavingsGoal(0, TODAY))
    expect(getData().settings.savingsGoal).toBe(0)
  })

  it.each([-1, 1.5, MAX_CENTS + 1, Number.NaN])('rejects the amount %j', (amount) => {
    expect(outcome(() => actions.setSavingsGoal(amount, TODAY))).toBe('rejected')
  })

  it('rejects an invalid date', () => {
    expect(outcome(() => actions.setSavingsGoal(100, '2026-02-30'))).toBe('rejected')
  })
})

describe('setMonthSavings', () => {
  it('sets and clears one period’s goal', () => {
    setData(makeData())
    const { before, after } = run(() => actions.setMonthSavings('2026-10', 15000))
    expect(after.months).toEqual({ '2026-10': { savingsGoal: 15000 } })
    expectChangedBranches(before, after, 'months')

    run(() => actions.setMonthSavings('2026-10', 0))
    expect(getData().months).toEqual({ '2026-10': { savingsGoal: 0 } })
    run(() => actions.setMonthSavings('2026-10', null))
    expect(getData().months).toEqual({})
  })

  it('keeps the period’s overrides when the goal is cleared', () => {
    run(() => actions.setMonthSavings('2026-11', null))
    expect(getData().months['2026-11']).toEqual({ overrides: { 'rec-rundfunk': { skipped: true } } })
  })

  it('changes nothing when the goal is already set or already absent', () => {
    expect(outcome(() => actions.setMonthSavings('2026-11', 30000))).toBe('unchanged')
    expect(outcome(() => actions.setMonthSavings('2026-12', null))).toBe('unchanged')
  })

  it('rejects invalid months and amounts', () => {
    expect(outcome(() => actions.setMonthSavings('2026-13', 100))).toBe('rejected')
    expect(outcome(() => actions.setMonthSavings('2026-10', -5))).toBe('rejected')
    expect(outcome(() => actions.setMonthSavings('2026-10', MAX_CENTS + 1))).toBe('rejected')
  })
})

describe('addCategory', () => {
  it('adds a category at the end with a new id and the next free colour', () => {
    const expectedColor = nextFreeCategoryColor(getData().categories)
    let created: ReturnType<typeof actions.addCategory> | undefined
    const { before, after } = run(() => {
      created = actions.addCategory({ name: '  Pets  ', icon: 'paw-print', kind: 'daily' })
    })
    expect(created).toEqual({
      id: expect.stringMatching(ID_PATTERN),
      name: 'Pets',
      icon: 'paw-print',
      color: expectedColor,
      kind: 'daily',
      budget: null,
      order: 14,
      archived: false,
    })
    expect(after.categories.at(-1)).toBe(created)
    expectChangedBranches(before, after, 'categories')
  })

  it('takes an explicit colour, an emoji icon and a limit', () => {
    const category = actions.addCategory({ name: 'Plants', icon: '🌱', kind: 'both', color: 'green', budget: 2500 })
    expect(category).toMatchObject({ icon: '🌱', color: 'green', budget: 2500 })
    expectNormalized(getData())
  })

  it('goes after the highest order, also when orders have gaps', () => {
    setData(makeData({ categories: [makeCategory('a', { order: 3 }), makeCategory('b', { order: 9 })] }))
    expect(actions.addCategory({ name: 'C', icon: 'circle', kind: 'both' }).order).toBe(10)
  })

  it.each<[string, Record<string, unknown>]>([
    ['an empty name', { name: '   ', icon: 'circle', kind: 'both' }],
    ['an unknown icon', { name: 'X', icon: 'not-an-icon', kind: 'both' }],
    ['an unknown kind', { name: 'X', icon: 'circle', kind: 'monthly' }],
    ['an unknown colour', { name: 'X', icon: 'circle', kind: 'both', color: 'pink' }],
    ['a limit of 0', { name: 'X', icon: 'circle', kind: 'both', budget: 0 }],
    ['a fractional limit', { name: 'X', icon: 'circle', kind: 'both', budget: 10.5 }],
  ])('rejects %s', (_name, input) => {
    expect(outcome(() => actions.addCategory(input as unknown as NewCategory))).toBe('rejected')
  })
})

describe('updateCategory and setCategoryArchived', () => {
  it('changes the given fields of one category only', () => {
    const { before, after } = run(() =>
      actions.updateCategory(DEFAULT_CATEGORY_IDS.coffee, { name: 'Coffee', budget: 3000, color: 'brown' }),
    )
    const index = before.categories.findIndex((c) => c.id === DEFAULT_CATEGORY_IDS.coffee)
    expect(after.categories[index]).toEqual({ ...before.categories[index], name: 'Coffee', budget: 3000, color: 'brown' })
    const replaced = after.categories.flatMap((category, i) => (category === before.categories[i] ? [] : [i]))
    expect(replaced).toEqual([index])
    expectChangedBranches(before, after, 'categories')
  })

  it('clears a limit with null', () => {
    run(() => actions.updateCategory('cat-books', { budget: null }))
    expect(getData().categories.find((c) => c.id === 'cat-books')?.budget).toBeNull()
  })

  it('archives and unarchives', () => {
    run(() => actions.setCategoryArchived(DEFAULT_CATEGORY_IDS.health, true))
    expect(getData().categories.find((c) => c.id === DEFAULT_CATEGORY_IDS.health)?.archived).toBe(true)
    expect(outcome(() => actions.setCategoryArchived(DEFAULT_CATEGORY_IDS.health, true))).toBe('unchanged')
    run(() => actions.setCategoryArchived(DEFAULT_CATEGORY_IDS.health, false))
    expect(getData().categories.find((c) => c.id === DEFAULT_CATEGORY_IDS.health)?.archived).toBe(false)
  })

  it('changes nothing when the values are already set', () => {
    expect(outcome(() => actions.updateCategory(DEFAULT_CATEGORY_IDS.rent, { name: 'Rent', kind: 'fixed' }))).toBe('unchanged')
  })

  it('rejects unknown ids, fields that never change and invalid values', () => {
    expect(outcome(() => actions.updateCategory('cat-unknown', { name: 'X' }))).toBe('rejected')
    expect(outcome(() => actions.updateCategory(DEFAULT_CATEGORY_IDS.rent, { id: 'x' } as never))).toBe('rejected')
    expect(outcome(() => actions.updateCategory(DEFAULT_CATEGORY_IDS.rent, { order: 3 } as never))).toBe('rejected')
    expect(outcome(() => actions.updateCategory(DEFAULT_CATEGORY_IDS.rent, { name: '' }))).toBe('rejected')
    expect(outcome(() => actions.updateCategory(DEFAULT_CATEGORY_IDS.rent, { budget: 0 }))).toBe('rejected')
    expect(outcome(() => actions.setCategoryArchived(DEFAULT_CATEGORY_IDS.rent, 'yes' as never))).toBe('rejected')
  })
})

describe('reorderCategories', () => {
  beforeEach(() => {
    setData(
      makeData({
        categories: [
          makeCategory('a', { order: 0 }),
          makeCategory('b', { order: 1 }),
          makeCategory('c', { order: 2, archived: true }),
          makeCategory('d', { order: 3 }),
        ],
      }),
    )
  })

  it('puts the listed ids first and the others after them in their old order', () => {
    const { before, after } = run(() => actions.reorderCategories(['d', 'a']))
    expect(after.categories.map(({ id, order }) => [id, order])).toEqual([
      ['d', 0],
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
    expect(after.categories[1]).not.toBe(before.categories[0])
    expectChangedBranches(before, after, 'categories')
  })

  it('keeps categories whose order stays the same', () => {
    const { before, after } = run(() => actions.reorderCategories(['b', 'a']))
    expect(after.categories.map(({ id }) => id)).toEqual(['b', 'a', 'c', 'd'])
    expect(after.categories[2]).toBe(before.categories[2])
    expect(after.categories[3]).toBe(before.categories[3])
  })

  it('rewrites orders with gaps to 0..n-1', () => {
    setData(makeData({ categories: [makeCategory('x', { order: 5 }), makeCategory('y', { order: 10 })] }))
    run(() => actions.reorderCategories([]))
    expect(getData().categories.map(({ order }) => order)).toEqual([0, 1])
  })

  it('changes nothing when the order stays', () => {
    expect(outcome(() => actions.reorderCategories(['a', 'b', 'c', 'd']))).toBe('unchanged')
    expect(outcome(() => actions.reorderCategories(['a']))).toBe('unchanged')
  })

  it('rejects unknown and repeated ids', () => {
    expect(outcome(() => actions.reorderCategories(['a', 'zzz']))).toBe('rejected')
    expect(outcome(() => actions.reorderCategories(['a', 'a']))).toBe('rejected')
  })
})

describe('deleteCategory', () => {
  it('deletes an unused category', () => {
    const { before, after } = run(() => actions.deleteCategory(DEFAULT_CATEGORY_IDS.health, null))
    expect(after.categories.map(({ id }) => id)).not.toContain(DEFAULT_CATEGORY_IDS.health)
    expect(after.categories).toHaveLength(before.categories.length - 1)
    expectChangedBranches(before, after, 'categories')
  })

  it('moves transactions, recurring items and quick adds to another category', () => {
    vi.setSystemTime(NOW + 60_000)
    const { before, after } = run(() => actions.deleteCategory(DEFAULT_CATEGORY_IDS.coffee, DEFAULT_CATEGORY_IDS.eating))
    const coffee = after.transactions.find((tx) => tx.id === 'tx-coffee')
    expect(coffee).toMatchObject({ categoryId: DEFAULT_CATEGORY_IDS.eating, updatedAt: NOW + 60_000 })
    expect(after.quickAdds.filter((q) => q.categoryId === DEFAULT_CATEGORY_IDS.coffee)).toEqual([])
    expect(after.quickAdds.find((q) => q.id === 'qa-coffee')?.categoryId).toBe(DEFAULT_CATEGORY_IDS.eating)
    // Records of other categories keep their identity.
    expect(after.transactions.find((tx) => tx.id === 'tx-mensa')).toBe(before.transactions.find((tx) => tx.id === 'tx-mensa'))
    expectChangedBranches(before, after, 'categories', 'transactions', 'quickAdds')
  })

  it('moves fixed costs', () => {
    const { after } = run(() => actions.deleteCategory(DEFAULT_CATEGORY_IDS.rent, DEFAULT_CATEGORY_IDS.other))
    expect(recurringById('rec-rent', after).categoryId).toBe(DEFAULT_CATEGORY_IDS.other)
  })

  it('rejects deleting a used category without a target', () => {
    expect(outcome(() => actions.deleteCategory(DEFAULT_CATEGORY_IDS.coffee, null))).toBe('rejected')
  })

  it('rejects moving into itself or into an unknown category, used or not', () => {
    expect(outcome(() => actions.deleteCategory(DEFAULT_CATEGORY_IDS.coffee, DEFAULT_CATEGORY_IDS.coffee))).toBe('rejected')
    expect(outcome(() => actions.deleteCategory(DEFAULT_CATEGORY_IDS.coffee, 'cat-unknown'))).toBe('rejected')
    expect(outcome(() => actions.deleteCategory(DEFAULT_CATEGORY_IDS.health, 'cat-unknown'))).toBe('rejected')
    expect(outcome(() => actions.deleteCategory(DEFAULT_CATEGORY_IDS.coffee, UNCATEGORIZED_ID))).toBe('rejected')
  })

  it('rejects an unknown id', () => {
    expect(outcome(() => actions.deleteCategory('cat-unknown', null))).toBe('rejected')
  })
})

describe('addTransaction', () => {
  it('adds an expense with a new id, timestamps and a cleaned note', () => {
    let created: ReturnType<typeof actions.addTransaction> | undefined
    const { before, after } = run(() => {
      created = actions.addTransaction({
        kind: 'expense',
        amount: 350,
        categoryId: DEFAULT_CATEGORY_IDS.coffee,
        date: TODAY,
        note: `  ${'n'.repeat(90)}`,
      })
    })
    expect(created).toEqual({
      id: expect.stringMatching(ID_PATTERN),
      kind: 'expense',
      amount: 350,
      categoryId: DEFAULT_CATEGORY_IDS.coffee,
      date: TODAY,
      note: 'n'.repeat(MAX_LENGTHS.note),
      fromWallet: false,
      splits: [],
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(after.transactions.at(-1)).toBe(created)
    after.transactions.slice(0, -1).forEach((tx, i) => expect(tx).toBe(before.transactions[i]))
    expectChangedBranches(before, after, 'transactions')
  })

  it('stores income without a category and an empty note by default', () => {
    const tx = actions.addTransaction({ kind: 'income', amount: 5000, categoryId: DEFAULT_CATEGORY_IDS.other, date: TODAY })
    expect(tx).toMatchObject({ kind: 'income', categoryId: null, note: '', fromWallet: false, splits: [] })
    expectNormalized(getData())
  })

  it('stores income without wallet payment or splits when they are said out loud', () => {
    const input: NewTransaction = { kind: 'income', amount: 5000, categoryId: null, date: TODAY, fromWallet: false, splits: [] }
    let created: Transaction | undefined
    run(() => {
      created = actions.addTransaction(input)
    })
    expect(created).toMatchObject({ fromWallet: false, splits: [] })
  })

  it('pays an expense from the wallet (§3.13)', () => {
    let created: Transaction | undefined
    const { before, after } = run(() => {
      created = actions.addTransaction({ kind: 'expense', amount: 12000, categoryId: 'cat-shopping', date: TODAY, fromWallet: true })
    })
    expect(created).toMatchObject({ amount: 12000, fromWallet: true, splits: [] })
    // It leaves the month alone and comes out of the wallet instead.
    expect(computeMonthSummary(after, '2026-10', TODAY).daily).toBe(computeMonthSummary(before, '2026-10', TODAY).daily)
    expect(walletSummary(after, TODAY).balance).toBe(walletSummary(before, TODAY).balance - 12000)
  })

  it('stores splits with new ids and trimmed names, open unless a status is given (§3.16)', () => {
    let created: Transaction | undefined
    const { after } = run(() => {
      created = actions.addTransaction({
        kind: 'expense',
        amount: 3200,
        categoryId: 'cat-eating',
        date: TODAY,
        note: 'Pizza night',
        splits: [
          { person: '  Lea ', amount: 800 },
          { person: 'Max', amount: 800, status: 'open' },
          { person: 'Sam', amount: 500, status: 'paid' },
          { person: 'Kim', amount: 100, status: 'forgiven' },
        ],
      })
    })
    if (created === undefined) throw new Error('Nothing was created')
    expect(created.splits).toEqual([
      { id: expect.stringMatching(ID_PATTERN), person: 'Lea', amount: 800, status: 'open', settledAt: null },
      { id: expect.stringMatching(ID_PATTERN), person: 'Max', amount: 800, status: 'open', settledAt: null },
      { id: expect.stringMatching(ID_PATTERN), person: 'Sam', amount: 500, status: 'paid', settledAt: NOW },
      { id: expect.stringMatching(ID_PATTERN), person: 'Kim', amount: 100, status: 'forgiven', settledAt: NOW },
    ])
    expect(new Set(created.splits.map(({ id }) => id)).size).toBe(4)
    expect(after.transactions.at(-1)).toBe(created)
    // Your share: everything not owed by others; a forgiven split is yours again (§4.9).
    expect(myShare(created)).toBe(1100)
  })

  it('cuts names in splits to 24 characters, keeping whole emoji', () => {
    const tx = actions.addTransaction(splitExpense([{ person: `${'x'.repeat(23)}👩‍💻👩‍💻 `, amount: 100 }]))
    expect(tx.splits[0]?.person).toBe(`${'x'.repeat(23)}👩‍💻`)
    expectNormalized(getData())
  })

  it('lets others owe the whole amount but never more (§4.9)', () => {
    const whole = actions.addTransaction(
      splitExpense(
        [
          { person: 'Max', amount: 900 },
          { person: 'Lea', amount: 900 },
        ],
        1800,
      ),
    )
    expect(myShare(whole)).toBe(0)
    expectNormalized(getData())
    const over = [
      { person: 'Max', amount: 900 },
      { person: 'Lea', amount: 901 },
    ]
    expect(outcome(() => actions.addTransaction(splitExpense(over, 1800)))).toBe('rejected')
    expect(outcome(() => actions.addTransaction(splitExpense([{ person: 'Max', amount: MAX_CENTS }], MAX_CENTS)))).toBe('changed')
    const overMax = [
      { person: 'Max', amount: MAX_CENTS },
      { person: 'Lea', amount: 1 },
    ]
    expect(outcome(() => actions.addTransaction(splitExpense(overMax, MAX_CENTS)))).toBe('rejected')
  })

  it('accepts every even split that leaves each person at least a cent ("Split evenly", §3.16)', () => {
    for (const amount of [1, 2, 3, 99, 100, 101, 3200, 99_999, MAX_CENTS]) {
      for (let people = 1; people <= 5; people += 1) {
        const each = Math.floor(amount / (people + 1))
        const splits = Array.from({ length: people }, (_, i) => ({ person: `Person ${i + 1}`, amount: each }))
        expect(outcome(() => actions.addTransaction(splitExpense(splits, amount)))).toBe(each >= 1 ? 'changed' : 'rejected')
      }
    }
  })

  it('pays a split expense from the wallet: the wallet pays your share', () => {
    const before = getData()
    const tx = actions.addTransaction({
      kind: 'expense',
      amount: 1800,
      categoryId: 'cat-going-out',
      date: TODAY,
      fromWallet: true,
      splits: [{ person: 'Max', amount: 900 }],
    })
    expect(tx).toMatchObject({ fromWallet: true, splits: [{ person: 'Max', amount: 900, status: 'open' }] })
    expectNormalized(getData())
    expect(walletSummary(getData(), TODAY).balance).toBe(walletSummary(before, TODAY).balance - 900)
  })

  it('accepts unknown category ids and Uncategorized for expenses', () => {
    expect(
      outcome(() => actions.addTransaction({ kind: 'expense', amount: 1, categoryId: UNCATEGORIZED_ID, date: TODAY })),
    ).toBe('changed')
    expect(
      outcome(() =>
        actions.addTransaction({ kind: 'expense', amount: MAX_CENTS, categoryId: 'cat-gone', date: '2999-12-31' }),
      ),
    ).toBe('changed')
  })

  it.each<[string, object]>([
    ['an expense without a category', { kind: 'expense', amount: 350, categoryId: null, date: TODAY }],
    ['an amount of 0', { kind: 'expense', amount: 0, categoryId: 'cat-coffee', date: TODAY }],
    ['a fractional amount', { kind: 'expense', amount: 3.5, categoryId: 'cat-coffee', date: TODAY }],
    ['an amount over the maximum', { kind: 'expense', amount: MAX_CENTS + 1, categoryId: 'cat-coffee', date: TODAY }],
    ['an amount as text', { kind: 'expense', amount: '350', categoryId: 'cat-coffee', date: TODAY }],
    ['a date that does not exist', { kind: 'expense', amount: 350, categoryId: 'cat-coffee', date: '2026-02-30' }],
    ['a date in another format', { kind: 'expense', amount: 350, categoryId: 'cat-coffee', date: '14.10.2026' }],
    ['an unknown kind', { kind: 'refund', amount: 350, categoryId: 'cat-coffee', date: TODAY }],
    ['a reserved category id', { kind: 'expense', amount: 350, categoryId: 'constructor', date: TODAY }],
    ['a malformed category id', { kind: 'expense', amount: 350, categoryId: 'cat coffee', date: TODAY }],
    ['a note that is not text', { kind: 'expense', amount: 350, categoryId: 'cat-coffee', date: TODAY, note: 5 }],
    ['income paid from the wallet', { kind: 'income', amount: 5000, categoryId: null, date: TODAY, fromWallet: true }],
    [
      'income with a split',
      { kind: 'income', amount: 5000, categoryId: null, date: TODAY, splits: [{ person: 'Max', amount: 100 }] },
    ],
    ['a wallet flag that is not boolean', { kind: 'expense', amount: 350, categoryId: 'cat-coffee', date: TODAY, fromWallet: 'yes' }],
    ['splits that are no list', splitExpense({ person: 'Max', amount: 100 })],
    ['a split that is no object', splitExpense(['Max'])],
    ['a split that is null', splitExpense([null])],
    ['a split without a person', splitExpense([{ amount: 100 }])],
    ['a split with a blank person', splitExpense([{ person: '   ', amount: 100 }])],
    ['a split whose person is not text', splitExpense([{ person: 7, amount: 100 }])],
    ['a split without an amount', splitExpense([{ person: 'Max' }])],
    ['a split of 0', splitExpense([{ person: 'Max', amount: 0 }])],
    ['a negative split', splitExpense([{ person: 'Max', amount: -100 }])],
    ['a fractional split', splitExpense([{ person: 'Max', amount: 1.5 }])],
    ['a split as text', splitExpense([{ person: 'Max', amount: '100' }])],
    ['a split with an unknown status', splitExpense([{ person: 'Max', amount: 100, status: 'pending' }])],
    ['a split with an id on a new expense', splitExpense([{ id: 'split-mia', person: 'Mia', amount: 100 }])],
    [
      'splits that add up to more than the amount',
      splitExpense([
        { person: 'Max', amount: 200 },
        { person: 'Lea', amount: 151 },
      ]),
    ],
  ])('rejects %s', (_name, input) => {
    expect(outcome(() => actions.addTransaction(input as unknown as NewTransaction))).toBe('rejected')
  })
})

describe('updateTransaction', () => {
  it('changes the given fields and sets updatedAt', () => {
    vi.setSystemTime(NOW + 5000)
    const { before, after } = run(() =>
      actions.updateTransaction('tx-coffee', { amount: 420, note: ' Flat white ', date: '2026-10-13', categoryId: 'cat-eating' }),
    )
    const index = before.transactions.findIndex((tx) => tx.id === 'tx-coffee')
    expect(after.transactions[index]).toEqual({
      ...before.transactions[index],
      amount: 420,
      note: 'Flat white',
      date: '2026-10-13',
      categoryId: 'cat-eating',
      updatedAt: NOW + 5000,
    })
    expectChangedBranches(before, after, 'transactions')
  })

  it('keeps income without a category', () => {
    run(() => actions.updateTransaction('tx-gift', { categoryId: DEFAULT_CATEGORY_IDS.other, amount: 6000 }))
    expect(getData().transactions.find((tx) => tx.id === 'tx-gift')).toMatchObject({ categoryId: null, amount: 6000 })
  })

  it('changes nothing, not even updatedAt, when every value is already set', () => {
    expect(outcome(() => actions.updateTransaction('tx-coffee', { amount: 350, note: 'Coffee' }))).toBe('unchanged')
  })

  it('rejects a change of kind, an expense without a category, unknown ids and invalid values', () => {
    expect(outcome(() => actions.updateTransaction('tx-coffee', { kind: 'income' } as never))).toBe('rejected')
    expect(outcome(() => actions.updateTransaction('tx-coffee', { categoryId: null }))).toBe('rejected')
    expect(outcome(() => actions.updateTransaction('tx-unknown', { amount: 100 }))).toBe('rejected')
    expect(outcome(() => actions.updateTransaction('tx-coffee', { amount: -1 }))).toBe('rejected')
    expect(outcome(() => actions.updateTransaction('tx-coffee', { date: '2026-10-32' }))).toBe('rejected')
    expect(outcome(() => actions.updateTransaction('tx-coffee', { createdAt: 1 } as never))).toBe('rejected')
    expect(outcome(() => actions.updateTransaction('tx-coffee', { fromWallet: 'yes' } as never))).toBe('rejected')
    expect(outcome(() => actions.updateTransaction('tx-coffee', { splits: 'Max' } as never))).toBe('rejected')
    expect(outcome(() => actions.updateTransaction('tx-coffee', { splits: [{ person: '', amount: 100 }] }))).toBe('rejected')
  })

  it('moves an expense to the wallet and back to the budget (§3.13)', () => {
    vi.setSystemTime(NOW + 5000)
    const { before, after } = run(() => actions.updateTransaction('tx-coffee', { fromWallet: true }))
    expect(txById('tx-coffee', after)).toEqual({ ...txById('tx-coffee', before), fromWallet: true, updatedAt: NOW + 5000 })
    expectChangedBranches(before, after, 'transactions')
    run(() => actions.updateTransaction('tx-coffee', { fromWallet: false }))
    expect(txById('tx-coffee').fromWallet).toBe(false)
  })

  it('replaces the splits: one named by id stays, the others go, new ones are added (§3.16)', () => {
    vi.setSystemTime(NOW + 5000)
    const [jonas] = txById('tx-book').splits
    const { before, after } = run(() =>
      actions.updateTransaction('tx-book', {
        splits: [
          { id: 'split-jonas', person: 'Jonas', amount: 800 },
          { person: 'Max', amount: 600 },
        ],
      }),
    )
    const book = txById('tx-book', after)
    expect(book.splits).toEqual([
      jonas,
      { id: expect.stringMatching(ID_PATTERN), person: 'Max', amount: 600, status: 'open', settledAt: null },
    ])
    expect(book.splits[0]).toBe(jonas)
    expect(book.splits[1]?.id).not.toBe('split-lena')
    expect(book.updatedAt).toBe(NOW + 5000)
    expectChangedBranches(before, after, 'transactions')
  })

  it('keeps stored splits given back without their ids, settled times included', () => {
    const groceries = txById('tx-groceries')
    const [mia] = groceries.splits
    // The transaction sheet may pass the splits back as stored, or only their person and amount.
    expect(outcome(() => actions.updateTransaction('tx-groceries', { splits: groceries.splits }))).toBe('unchanged')
    expect(outcome(() => actions.updateTransaction('tx-groceries', { splits: [{ person: 'Mia', amount: 1643 }] }))).toBe(
      'unchanged',
    )
    const paid: NewSplit = { person: 'Mia', amount: 1643, status: 'paid' }
    expect(outcome(() => actions.updateTransaction('tx-groceries', { splits: [paid] }))).toBe('unchanged')
    run(() => actions.updateTransaction('tx-groceries', { note: 'Weekly shop', splits: [{ person: ' Mia ', amount: 1643 }] }))
    expect(txById('tx-groceries').splits[0]).toBe(mia)
  })

  it('makes a split given without an id that differs from every stored one a new split', () => {
    vi.setSystemTime(NOW + 5000)
    run(() => actions.updateTransaction('tx-groceries', { splits: [{ person: 'Mia', amount: 1643, status: 'open' }] }))
    const [reopened] = txById('tx-groceries').splits
    expect(reopened).toEqual({ id: expect.stringMatching(ID_PATTERN), person: 'Mia', amount: 1643, status: 'open', settledAt: null })
    expect(reopened?.id).not.toBe('split-mia')
    run(() => actions.updateTransaction('tx-groceries', { splits: [{ person: 'Mia', amount: 1600, status: 'paid' }] }))
    expect(txById('tx-groceries').splits[0]).toMatchObject({ person: 'Mia', amount: 1600, status: 'paid', settledAt: NOW + 5000 })
  })

  it('changes a split named by id in place, keeping its settled time while its status stays', () => {
    vi.setSystemTime(NOW + 5000)
    run(() => actions.updateTransaction('tx-groceries', { splits: [{ id: 'split-mia', person: ' Mia R. ', amount: 1500 }] }))
    expect(txById('tx-groceries').splits).toEqual([
      { id: 'split-mia', person: 'Mia R.', amount: 1500, status: 'paid', settledAt: daysAfterInstall(42) },
    ])
    run(() => actions.updateTransaction('tx-groceries', { splits: [{ id: 'split-mia', person: 'Mia R.', amount: 1500, status: 'open' }] }))
    expect(txById('tx-groceries').splits).toEqual([
      { id: 'split-mia', person: 'Mia R.', amount: 1500, status: 'open', settledAt: null },
    ])
    vi.setSystemTime(NOW + 9000)
    run(() =>
      actions.updateTransaction('tx-groceries', { splits: [{ id: 'split-mia', person: 'Mia R.', amount: 1500, status: 'forgiven' }] }),
    )
    expect(txById('tx-groceries').splits[0]).toMatchObject({ status: 'forgiven', settledAt: NOW + 9000 })
  })

  it('keeps the given order of the splits', () => {
    const [jonas, lena] = txById('tx-book').splits
    run(() =>
      actions.updateTransaction('tx-book', {
        splits: [
          { id: 'split-lena', person: 'Lena', amount: 800 },
          { id: 'split-jonas', person: 'Jonas', amount: 800 },
        ],
      }),
    )
    const { splits } = txById('tx-book')
    expect(splits).toHaveLength(2)
    expect(splits[0]).toBe(lena)
    expect(splits[1]).toBe(jonas)
  })

  it('removes every split with an empty list', () => {
    run(() => actions.updateTransaction('tx-book', { splits: [] }))
    expect(txById('tx-book').splits).toEqual([])
  })

  it('keeps what others owe within the amount, also when only the amount changes (§4.9)', () => {
    // Jonas owes 800 and Lena's forgiven 800 is still part of the bill of 2400.
    expect(outcome(() => actions.updateTransaction('tx-book', { amount: 1599 }))).toBe('rejected')
    expect(outcome(() => actions.updateTransaction('tx-book', { amount: 1600 }))).toBe('changed')
    expect(outcome(() => actions.updateTransaction('tx-book', { splits: [{ person: 'Jonas', amount: 1601 }] }))).toBe('rejected')
    expect(
      outcome(() => actions.updateTransaction('tx-book', { amount: 3000, splits: [{ person: 'Jonas', amount: 3000 }] })),
    ).toBe('changed')
  })

  it('rejects split ids the expense does not have and ids listed twice', () => {
    // split-mia belongs to another expense.
    expect(outcome(() => actions.updateTransaction('tx-book', { splits: [{ id: 'split-mia', person: 'Mia', amount: 100 }] }))).toBe(
      'rejected',
    )
    expect(
      outcome(() => actions.updateTransaction('tx-book', { splits: [{ id: 'split-unknown', person: 'Mia', amount: 100 }] })),
    ).toBe('rejected')
    const twice: NewSplit[] = [
      { id: 'split-jonas', person: 'Jonas', amount: 100 },
      { id: 'split-jonas', person: 'Jonas', amount: 100 },
    ]
    expect(outcome(() => actions.updateTransaction('tx-book', { splits: twice }))).toBe('rejected')
    expect(outcome(() => actions.updateTransaction('tx-book', { splits: [{ id: 42, person: 'Jonas', amount: 100 }] } as never))).toBe(
      'rejected',
    )
  })

  it('changes nothing when the wallet flag and the splits stay', () => {
    const book = txById('tx-book')
    expect(outcome(() => actions.updateTransaction('tx-book', { fromWallet: false, splits: book.splits }))).toBe('unchanged')
    expect(outcome(() => actions.updateTransaction('tx-sale', { fromWallet: true, splits: [] }))).toBe('unchanged')
  })

  it('keeps income without wallet payment and splits', () => {
    expect(outcome(() => actions.updateTransaction('tx-gift', { fromWallet: false, splits: [] }))).toBe('unchanged')
    expect(outcome(() => actions.updateTransaction('tx-gift', { fromWallet: true }))).toBe('rejected')
    expect(outcome(() => actions.updateTransaction('tx-gift', { splits: [{ person: 'Max', amount: 100 }] }))).toBe('rejected')
  })
})

describe('splits under random changes', () => {
  it('always fit the expense, keep the splits they name and normalise to themselves (property)', () => {
    const random = seededRandom(20_261_014)
    const int = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1))
    const pick = <T>(list: readonly T[]): T => {
      const item = list[int(0, list.length - 1)]
      if (item === undefined) throw new Error('Nothing to pick from')
      return item
    }
    const people = ['Max', 'Lea', ' Sam ', 'Kim', 'max']
    const statuses = ['none given', 'open', 'paid', 'forgiven'] as const
    const newSplits = (): NewSplit[] =>
      Array.from({ length: int(0, 3) }, () => {
        const status = pick(statuses)
        const split: NewSplit = { person: pick(people), amount: int(1, 2000) }
        return status === 'none given' ? split : { ...split, status }
      })
    // Amounts near what others owe, where the rule bites, or anywhere.
    const amountNear = (owed: number): number => Math.max(1, pick([owed - 1, owed, owed + 1, int(1, 5000)]))
    const counts: Record<Outcome, number> = { changed: 0, unchanged: 0, rejected: 0 }
    // outcome() checks normalisation and the single setState of every step; this collects the rest.
    const problems: string[] = []
    const counted = (action: () => unknown): Outcome => {
      const result = outcome(action)
      counts[result] += 1
      return result
    }
    const report = (step: number, ok: boolean, what: string): void => {
      if (!ok) problems.push(`step ${step}: ${what}`)
    }

    for (let step = 0; step < 400; step += 1) {
      const now = NOW + step * 1000
      vi.setSystemTime(now)
      const operation = int(0, 3)
      if (operation === 0) {
        // A new expense with random splits: accepted exactly when they fit.
        const splits = newSplits()
        const amount = amountNear(totalOf(splits))
        const result = counted(() => actions.addTransaction({ kind: 'expense', amount, categoryId: 'cat-eating', date: TODAY, splits }))
        const expected: Outcome = totalOf(splits) > amount ? 'rejected' : 'changed'
        report(step, result === expected, `adding ${amount} with ${JSON.stringify(splits)}: ${result}, not ${expected}`)
      } else if (operation === 1) {
        // New splits for an expense: some stored ones dropped, some passed back as stored, some
        // as person and amount only, some changed by id, plus new ones.
        const tx = pick(expensesOf(getData()))
        const given: NewSplit[] = []
        const withoutId = new Set<NewSplit>()
        for (const split of tx.splits) {
          const way = int(0, 3)
          if (way === 1) {
            given.push(split)
          } else if (way === 2) {
            const copy = { person: split.person, amount: split.amount }
            withoutId.add(copy)
            given.push(copy)
          } else if (way === 3) {
            given.push({ id: split.id, person: split.person, amount: int(1, 2000) })
          }
        }
        given.push(...newSplits())
        const result = counted(() => actions.updateTransaction(tx.id, { splits: given }))
        const fits = totalOf(given) <= tx.amount
        report(step, (result !== 'rejected') === fits, `splits ${JSON.stringify(given)} on ${tx.amount}: ${result}`)
        if (result === 'rejected') continue
        const { splits } = txById(tx.id)
        report(
          step,
          JSON.stringify(splits.map(({ person, amount }) => [person, amount])) ===
            JSON.stringify(given.map(({ person, amount }) => [person.trim(), amount])),
          `splits ${JSON.stringify(splits)} for ${JSON.stringify(given)}`,
        )
        given.forEach((split, i) => {
          const stored = tx.splits.find(({ id }) => id === split.id)
          const saved = splits[i]
          // A given status always applies; a split named by id keeps its own.
          const status = split.status ?? stored?.status
          report(step, status === undefined || saved?.status === status, `split ${i} has status ${saved?.status}, not ${status}`)
          // Passed back as person and amount only: one of the stored splits, unchanged.
          report(
            step,
            !withoutId.has(split) || (saved !== undefined && tx.splits.includes(saved)),
            `split ${i} (${split.person}, ${split.amount}) is not a stored split`,
          )
          if (stored === undefined) return
          // Named by id: the same split, its status and settled time kept, the very object when nothing changed.
          report(
            step,
            saved?.id === stored.id && saved.status === stored.status && saved.settledAt === stored.settledAt,
            `split ${stored.id} became ${JSON.stringify(saved)}`,
          )
          report(step, split.amount !== stored.amount || saved === stored, `split ${stored.id} is not the stored object`)
        })
      } else if (operation === 2) {
        // A new amount must still hold every split.
        const tx = pick(expensesOf(getData()))
        const amount = amountNear(totalOf(tx.splits))
        const result = counted(() => actions.updateTransaction(tx.id, { amount }))
        const expected: Outcome = totalOf(tx.splits) > amount ? 'rejected' : amount === tx.amount ? 'unchanged' : 'changed'
        report(step, result === expected, `amount ${amount} with splits ${totalOf(tx.splits)}: ${result}, not ${expected}`)
      } else {
        const expenses = expensesOf(getData())
        const tx = expenses.find((expense) => expense.splits.length > 0 && random() < 0.3) ?? pick(expenses)
        const split = tx.splits[0]
        if (split === undefined) continue
        const status = pick(['open', 'paid', 'forgiven'] as const)
        const result = counted(() => actions.setSplitStatus(tx.id, split.id, status))
        const saved = txById(tx.id).splits[0]
        const settledAt = status === 'open' ? null : split.status === status ? split.settledAt : now
        report(
          step,
          result === (split.status === status ? 'unchanged' : 'changed') && saved?.status === status && saved.settledAt === settledAt,
          `${split.status} → ${status}: ${result}, ${JSON.stringify(saved)}`,
        )
      }
    }
    expect(problems).toEqual([])
    // The run exercised every outcome.
    expect(counts.changed).toBeGreaterThan(50)
    expect(counts.unchanged).toBeGreaterThan(5)
    expect(counts.rejected).toBeGreaterThan(20)
  })
})

describe('setSplitStatus', () => {
  it('marks a split paid back now, and only that split (§3.16)', () => {
    vi.setSystemTime(NOW + 5000)
    const { before, after } = run(() => actions.setSplitStatus('tx-book', 'split-jonas', 'paid'))
    const old = txById('tx-book', before)
    const book = txById('tx-book', after)
    expect(book).toEqual({
      ...old,
      splits: [{ ...old.splits[0], status: 'paid', settledAt: NOW + 5000 }, old.splits[1]],
      updatedAt: NOW + 5000,
    })
    expect(book.splits[1]).toBe(old.splits[1])
    const others = before.transactions.filter((tx) => tx.id !== 'tx-book')
    after.transactions.filter((tx) => tx.id !== 'tx-book').forEach((tx, i) => expect(tx).toBe(others[i]))
    expectChangedBranches(before, after, 'transactions')
    // Jonas was the only one who still owed anything.
    expect(owedSummary(before).total).toBe(800)
    expect(owedSummary(after).total).toBe(0)
  })

  it('opens a settled split again, and forgives one so it counts as your own spending (§4.9)', () => {
    vi.setSystemTime(NOW + 5000)
    run(() => actions.setSplitStatus('tx-groceries', 'split-mia', 'open'))
    expect(txById('tx-groceries').splits[0]).toMatchObject({ status: 'open', settledAt: null })

    const daily = computeMonthSummary(getData(), '2026-10', TODAY).daily
    run(() => actions.setSplitStatus('tx-book', 'split-jonas', 'forgiven'))
    expect(txById('tx-book').splits[0]).toMatchObject({ status: 'forgiven', settledAt: NOW + 5000 })
    expect(computeMonthSummary(getData(), '2026-10', TODAY).daily).toBe(daily + 800)
  })

  it('gives a split that moves from paid to forgiven a new settled time', () => {
    vi.setSystemTime(NOW + 7000)
    run(() => actions.setSplitStatus('tx-groceries', 'split-mia', 'forgiven'))
    expect(txById('tx-groceries').splits[0]).toMatchObject({ status: 'forgiven', settledAt: NOW + 7000 })
  })

  it('changes nothing when the split already has the status', () => {
    expect(outcome(() => actions.setSplitStatus('tx-book', 'split-lena', 'forgiven'))).toBe('unchanged')
    expect(outcome(() => actions.setSplitStatus('tx-book', 'split-jonas', 'open'))).toBe('unchanged')
    expect(txById('tx-book').splits[1]?.settledAt).toBe(daysAfterInstall(70))
  })

  it('rejects unknown transactions and splits, splits of another expense and unknown statuses', () => {
    expect(outcome(() => actions.setSplitStatus('tx-unknown', 'split-jonas', 'paid'))).toBe('rejected')
    expect(outcome(() => actions.setSplitStatus('tx-book', 'split-unknown', 'paid'))).toBe('rejected')
    expect(outcome(() => actions.setSplitStatus('tx-book', 'split-mia', 'paid'))).toBe('rejected')
    expect(outcome(() => actions.setSplitStatus('tx-gift', 'split-jonas', 'paid'))).toBe('rejected')
    expect(outcome(() => actions.setSplitStatus('tx-book', 'split-jonas', 'settled' as never))).toBe('rejected')
  })
})

describe('deleteTransaction', () => {
  it('removes the transaction', () => {
    const { before, after } = run(() => actions.deleteTransaction('tx-sale'))
    expect(after.transactions.map(({ id }) => id)).toEqual(before.transactions.filter((tx) => tx.id !== 'tx-sale').map(({ id }) => id))
    expectChangedBranches(before, after, 'transactions')
  })

  it('rejects an unknown id', () => {
    expect(outcome(() => actions.deleteTransaction('tx-unknown'))).toBe('rejected')
  })
})

describe('addRecurring', () => {
  it('adds an item with defaults, an amount history from its start and the next order', () => {
    let created: ReturnType<typeof actions.addRecurring> | undefined
    const { before, after } = run(() => {
      created = actions.addRecurring({
        kind: 'expense',
        name: ' Spotify ',
        categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
        amount: 1199,
        startMonth: '2026-10',
      })
    })
    expect(created).toEqual({
      id: expect.stringMatching(ID_PATTERN),
      kind: 'expense',
      name: 'Spotify',
      categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
      amounts: [{ from: '2026-10', amount: 1199 }],
      everyMonths: 1,
      spread: false,
      startMonth: '2026-10',
      endMonth: null,
      dueDay: null,
      note: '',
      order: 6,
      createdAt: NOW,
    })
    expect(after.recurring.at(-1)).toBe(created)
    expectChangedBranches(before, after, 'recurring')
  })

  it('stores every given field', () => {
    const item = actions.addRecurring({
      kind: 'expense',
      name: 'Insurance',
      categoryId: DEFAULT_CATEGORY_IDS.insurance,
      amount: 12000,
      everyMonths: 12,
      spread: true,
      startMonth: '2026-03',
      endMonth: '2030-02',
      dueDay: 15,
      note: 'Direct debit',
    })
    expect(item).toMatchObject({ everyMonths: 12, spread: true, endMonth: '2030-02', dueDay: 15, note: 'Direct debit' })
    expectNormalized(getData())
  })

  it('stores income without a category and never spreads monthly items', () => {
    const income = actions.addRecurring({ kind: 'income', name: 'Job', categoryId: 'cat-other', amount: 90000, startMonth: '2026-10' })
    const monthly = actions.addRecurring({
      kind: 'expense',
      name: 'Gym',
      categoryId: 'cat-subscriptions',
      amount: 2990,
      startMonth: '2026-10',
      spread: true,
    })
    expect(income.categoryId).toBeNull()
    expect(monthly.spread).toBe(false)
    expectNormalized(getData())
  })

  it.each<[string, Record<string, unknown>]>([
    ['an empty name', { name: ' ' }],
    ['an expense without a category', { categoryId: null }],
    ['an amount of 0', { amount: 0 }],
    ['an unknown interval', { everyMonths: 4 }],
    ['an invalid start month', { startMonth: '2026-13' }],
    ['an end before the start', { endMonth: '2026-09' }],
    ['a due day of 32', { dueDay: 32 }],
    ['a due day of 0', { dueDay: 0 }],
    ['spread that is not boolean', { spread: 1 }],
  ])('rejects %s', (_name, patch) => {
    const input = { kind: 'expense', name: 'Rent', categoryId: 'cat-rent', amount: 65000, startMonth: '2026-10', ...patch }
    expect(outcome(() => actions.addRecurring(input as unknown as NewRecurring))).toBe('rejected')
  })
})

describe('updateRecurring', () => {
  /** An item with the amount history of the §4.4 normalizeRecurring tests. */
  const history = makeRecurring({
    id: 'rec-h',
    startMonth: '2026-01',
    amounts: [
      { from: '2026-01', amount: 1000 },
      { from: '2026-06', amount: 1200 },
    ],
  })

  beforeEach(() => {
    setData(makeData({ recurring: [history] }))
  })

  it.each<[string, Parameters<typeof actions.updateRecurring>[1], Recurring['amounts']]>([
    [
      'start moved earlier',
      { startMonth: '2025-10' },
      [
        { from: '2025-10', amount: 1000 },
        { from: '2026-06', amount: 1200 },
      ],
    ],
    ['start moved later', { startMonth: '2026-08' }, [{ from: '2026-08', amount: 1200 }]],
    ['an end before the change', { endMonth: '2026-03' }, [{ from: '2026-01', amount: 1000 }]],
  ])('normalises the amount history (§4.4 test: %s)', (_name, patch, amounts) => {
    run(() => actions.updateRecurring('rec-h', patch))
    expect(recurringById('rec-h').amounts).toEqual(amounts)
  })

  it('changes the given fields', () => {
    const { before, after } = run(() =>
      actions.updateRecurring('rec-h', { name: 'Flat', everyMonths: 3, spread: true, dueDay: 3, note: ' n ', categoryId: 'cat-other' }),
    )
    expect(recurringById('rec-h', after)).toMatchObject({
      name: 'Flat',
      everyMonths: 3,
      spread: true,
      dueDay: 3,
      note: 'n',
      categoryId: 'cat-other',
    })
    expectChangedBranches(before, after, 'recurring')
  })

  it('stops an item after a month and clears a due day', () => {
    run(() => actions.updateRecurring('rec-h', { endMonth: '2026-10', dueDay: null }))
    expect(recurringById('rec-h')).toMatchObject({ endMonth: '2026-10', dueDay: null })
    run(() => actions.updateRecurring('rec-h', { endMonth: null }))
    expect(recurringById('rec-h').endMonth).toBeNull()
  })

  it('ignores a category for income', () => {
    const salary = makeRecurring({ id: 'rec-s', kind: 'income' })
    setData(makeData({ recurring: [salary] }))
    expect(outcome(() => actions.updateRecurring('rec-s', { categoryId: 'cat-other' }))).toBe('unchanged')
  })

  it('changes nothing when the result is the same item', () => {
    expect(outcome(() => actions.updateRecurring('rec-h', { name: 'Rent', startMonth: '2026-01' }))).toBe('unchanged')
    // Spreading a monthly item means nothing, so it normalises back to the same item.
    expect(outcome(() => actions.updateRecurring('rec-h', { spread: true }))).toBe('unchanged')
  })

  it('rejects an end before the start, fields that never change and invalid values', () => {
    expect(outcome(() => actions.updateRecurring('rec-h', { endMonth: '2025-12' }))).toBe('rejected')
    expect(outcome(() => actions.updateRecurring('rec-h', { startMonth: '2027-01', endMonth: '2026-12' }))).toBe('rejected')
    expect(outcome(() => actions.updateRecurring('rec-h', { amounts: [] } as never))).toBe('rejected')
    expect(outcome(() => actions.updateRecurring('rec-h', { kind: 'income' } as never))).toBe('rejected')
    expect(outcome(() => actions.updateRecurring('rec-h', { categoryId: null }))).toBe('rejected')
    expect(outcome(() => actions.updateRecurring('rec-h', { name: '' }))).toBe('rejected')
    expect(outcome(() => actions.updateRecurring('rec-h', { everyMonths: 5 as never }))).toBe('rejected')
    expect(outcome(() => actions.updateRecurring('rec-unknown', { name: 'X' }))).toBe('rejected')
  })
})

describe('setRecurringAmount', () => {
  const item = makeRecurring({ id: 'rec-a', startMonth: '2026-01', amounts: [{ from: '2026-01', amount: 1000 }] })

  it('changes the amount from a period on', () => {
    setData(makeData({ recurring: [item] }))
    const { before, after } = run(() => actions.setRecurringAmount('rec-a', 1200, '2026-05'))
    expect(recurringById('rec-a', after).amounts).toEqual([
      { from: '2026-01', amount: 1000 },
      { from: '2026-05', amount: 1200 },
    ])
    expectChangedBranches(before, after, 'recurring')
  })

  it('changes every period with "all"', () => {
    setData(makeData({ recurring: [{ ...item, amounts: [...item.amounts, { from: '2026-05', amount: 1200 }] }] }))
    run(() => actions.setRecurringAmount('rec-a', 1500, 'all'))
    expect(recurringById('rec-a').amounts).toEqual([{ from: '2026-01', amount: 1500 }])
  })

  it('follows withAmountFrom (§4.4 tests)', () => {
    setData(makeData({ recurring: [item] }))
    expect(outcome(() => actions.setRecurringAmount('rec-a', 1000, '2026-05'))).toBe('unchanged')

    setData(makeData({ recurring: [{ ...item, amounts: [...item.amounts, { from: '2026-05', amount: 1200 }] }] }))
    run(() => actions.setRecurringAmount('rec-a', 1000, '2026-03'))
    expect(recurringById('rec-a').amounts).toEqual([{ from: '2026-01', amount: 1000 }])
  })

  it('clears the amount override in that period and keeps its flags', () => {
    setData(
      makeData({
        recurring: [item],
        months: {
          '2026-05': { overrides: { 'rec-a': { amount: 900, paid: true } } },
          '2026-06': { overrides: { 'rec-a': { amount: 950 } }, savingsGoal: 100 },
        },
      }),
    )
    run(() => actions.setRecurringAmount('rec-a', 1200, '2026-05'))
    expect(getData().months['2026-05']).toEqual({ overrides: { 'rec-a': { paid: true } } })
    run(() => actions.setRecurringAmount('rec-a', 1300, '2026-06'))
    expect(getData().months['2026-06']).toEqual({ savingsGoal: 100 })
  })

  it('clears an amount override even when the amount stays', () => {
    setData(makeData({ recurring: [item], months: { '2026-05': { overrides: { 'rec-a': { amount: 900 } } } } }))
    const { before, after } = run(() => actions.setRecurringAmount('rec-a', 1000, '2026-05'))
    expect(after.months).toEqual({})
    expectChangedBranches(before, after, 'months')
  })

  it('clears the override in the start month for "all"', () => {
    setData(
      makeData({
        recurring: [item],
        months: {
          '2026-01': { overrides: { 'rec-a': { amount: 900 } } },
          '2026-04': { overrides: { 'rec-a': { amount: 800 } } },
        },
      }),
    )
    run(() => actions.setRecurringAmount('rec-a', 1100, 'all'))
    expect(getData().months).toEqual({ '2026-04': { overrides: { 'rec-a': { amount: 800 } } } })
  })

  it('rejects invalid amounts, months and ids', () => {
    setData(makeData({ recurring: [item] }))
    expect(outcome(() => actions.setRecurringAmount('rec-a', 0, '2026-05'))).toBe('rejected')
    expect(outcome(() => actions.setRecurringAmount('rec-a', 1000.5, '2026-05'))).toBe('rejected')
    expect(outcome(() => actions.setRecurringAmount('rec-a', 1000, '2026-5' as MonthKey))).toBe('rejected')
    expect(outcome(() => actions.setRecurringAmount('rec-unknown', 1000, 'all'))).toBe('rejected')
  })
})

describe('deleteRecurring', () => {
  it('removes the item and every override of it', () => {
    const { before, after } = run(() => actions.deleteRecurring('rec-netflix'))
    expect(after.recurring.map(({ id }) => id)).not.toContain('rec-netflix')
    expect(after.months).toEqual({
      '2026-09': { savingsGoal: 0 },
      '2026-10': { overrides: { 'rec-rent': { paid: true } } },
      '2026-11': { overrides: { 'rec-rundfunk': { skipped: true } }, savingsGoal: 30000 },
    })
    expectChangedBranches(before, after, 'recurring', 'months')
  })

  it('removes periods left empty and keeps the months object without overrides of the item', () => {
    const { before, after } = run(() => actions.deleteRecurring('rec-rundfunk'))
    expect(after.months['2026-11']).toEqual({ savingsGoal: 30000 })
    expect(before.months['2026-11']?.overrides).toBeDefined()

    const second = run(() => actions.deleteRecurring('rec-gym'))
    expect(second.after.months).toBe(second.before.months)
  })

  it('rejects an unknown id', () => {
    expect(outcome(() => actions.deleteRecurring('rec-unknown'))).toBe('rejected')
  })
})

describe('setOverride', () => {
  const rent = makeRecurring({ id: 'rec-1' })

  beforeEach(() => {
    setData(makeData({ recurring: [rent] }))
  })

  it('adds, changes and removes fields as the §5.4 tests say', () => {
    run(() => actions.setOverride('2026-10', 'rec-1', { paid: true }))
    expect(overrideOf('2026-10', 'rec-1')).toEqual({ paid: true })

    run(() => actions.setOverride('2026-10', 'rec-1', { amount: 900 }))
    expect(overrideOf('2026-10', 'rec-1')).toEqual({ paid: true, amount: 900 })

    run(() => actions.setOverride('2026-10', 'rec-1', { amount: null }))
    expect(overrideOf('2026-10', 'rec-1')).toEqual({ paid: true })

    run(() => actions.setOverride('2026-10', 'rec-1', { paid: false }))
    expect(getData().months).toEqual({})
    expect(Object.hasOwn(getData().months, '2026-10')).toBe(false)
  })

  it('clears paid when skipping (§5.4 test)', () => {
    run(() => actions.setOverride('2026-10', 'rec-1', { paid: true, amount: 900 }))
    run(() => actions.setOverride('2026-10', 'rec-1', { skipped: true }))
    expect(overrideOf('2026-10', 'rec-1')).toEqual({ amount: 900, skipped: true })
    run(() => actions.setOverride('2026-10', 'rec-1', { skipped: false }))
    expect(overrideOf('2026-10', 'rec-1')).toEqual({ amount: 900 })
  })

  it('skips rather than pays when a patch asks for both', () => {
    run(() => actions.setOverride('2026-10', 'rec-1', { skipped: true, paid: true }))
    expect(overrideOf('2026-10', 'rec-1')).toEqual({ skipped: true })
  })

  it('removes the whole override with null, keeping the period’s savings goal', () => {
    setData(makeData({ recurring: [rent], months: { '2026-10': { overrides: { 'rec-1': { amount: 900, paid: true } }, savingsGoal: 50 } } }))
    const { before, after } = run(() => actions.setOverride('2026-10', 'rec-1', null))
    expect(after.months).toEqual({ '2026-10': { savingsGoal: 50 } })
    expectChangedBranches(before, after, 'months')
  })

  it('keeps the overrides of other items', () => {
    const other = makeRecurring({ id: 'rec-2', name: 'Phone', categoryId: 'cat-phone' })
    setData(makeData({ recurring: [rent, other], months: { '2026-10': { overrides: { 'rec-2': { paid: true } } } } }))
    run(() => actions.setOverride('2026-10', 'rec-1', { amount: 70000 }))
    expect(getData().months['2026-10']?.overrides).toEqual({ 'rec-2': { paid: true }, 'rec-1': { amount: 70000 } })
  })

  it('changes nothing when the override already says so', () => {
    run(() => actions.setOverride('2026-10', 'rec-1', { paid: true }))
    expect(outcome(() => actions.setOverride('2026-10', 'rec-1', { paid: true }))).toBe('unchanged')
    expect(outcome(() => actions.setOverride('2026-11', 'rec-1', { paid: false, amount: null }))).toBe('unchanged')
    expect(outcome(() => actions.setOverride('2026-11', 'rec-1', null))).toBe('unchanged')
  })

  it('rejects periods without a line', () => {
    expect(outcome(() => actions.setOverride('2026-07', 'rec-1', { paid: true }))).toBe('rejected')
    const quarterly = makeRecurring({ id: 'rec-q', everyMonths: 3 })
    setData(makeData({ recurring: [quarterly] }))
    expect(outcome(() => actions.setOverride('2026-09', 'rec-q', { paid: true }))).toBe('rejected')
    run(() => actions.setOverride('2026-11', 'rec-q', { paid: true }))
  })

  it('accepts spread items only in their charge period, where the override covers the cycle', () => {
    const insurance = makeRecurring({
      id: 'rec-ins',
      startMonth: '2026-03',
      amounts: [{ from: '2026-03', amount: 10000 }],
      everyMonths: 12,
      spread: true,
    })
    setData(makeData({ recurring: [insurance] }))
    expect(outcome(() => actions.setOverride('2026-04', 'rec-ins', { amount: 11000 }))).toBe('rejected')
    run(() => actions.setOverride('2026-03', 'rec-ins', { amount: 11000 }))
    const { months } = getData()
    expect(lineFor(insurance, '2026-03', months, 1)?.amount).toBe(924)
    expect(lineFor(insurance, '2026-04', months, 1)?.amount).toBe(916)
  })

  it('rejects invalid amounts, unknown fields, unknown items and invalid months', () => {
    expect(outcome(() => actions.setOverride('2026-10', 'rec-1', { amount: 0 }))).toBe('rejected')
    expect(outcome(() => actions.setOverride('2026-10', 'rec-1', { amount: MAX_CENTS + 1 }))).toBe('rejected')
    expect(outcome(() => actions.setOverride('2026-10', 'rec-1', { paid: 'yes' } as never))).toBe('rejected')
    expect(outcome(() => actions.setOverride('2026-10', 'rec-1', { note: 'x' } as never))).toBe('rejected')
    expect(outcome(() => actions.setOverride('2026-10', 'rec-unknown', { paid: true }))).toBe('rejected')
    expect(outcome(() => actions.setOverride('2026-13', 'rec-1', { paid: true }))).toBe('rejected')
  })
})

describe('quick adds', () => {
  it('adds one at the end', () => {
    let created: ReturnType<typeof actions.addQuickAdd> | undefined
    const { before, after } = run(() => {
      created = actions.addQuickAdd({ label: ' Döner ', icon: '🥙', amount: 700, categoryId: 'cat-eating' })
    })
    expect(created).toEqual({ id: expect.stringMatching(ID_PATTERN), label: 'Döner', icon: '🥙', amount: 700, categoryId: 'cat-eating', order: 4 })
    expect(after.quickAdds.at(-1)).toBe(created)
    expectChangedBranches(before, after, 'quickAdds')
  })

  it('cuts labels to 16 characters', () => {
    expect(actions.addQuickAdd({ label: 'Coffee with oat milk', icon: 'coffee', amount: 450, categoryId: 'cat-coffee' }).label).toBe(
      'Coffee with oat',
    )
    expectNormalized(getData())
  })

  it('updates, deletes and reorders', () => {
    run(() => actions.updateQuickAdd('qa-coffee', { amount: 380, label: 'Espresso' }))
    expect(getData().quickAdds.find((q) => q.id === 'qa-coffee')).toMatchObject({ amount: 380, label: 'Espresso' })

    run(() => actions.reorderQuickAdds(['qa-mensa', 'qa-coffee']))
    expect(getData().quickAdds.map(({ id, order }) => [id, order])).toEqual([
      ['qa-mensa', 0],
      ['qa-coffee', 1],
      ['qa-bakery', 2],
      ['qa-doener', 3],
    ])

    const { before, after } = run(() => actions.deleteQuickAdd('qa-bakery'))
    expect(after.quickAdds.map(({ id }) => id)).toEqual(['qa-mensa', 'qa-coffee', 'qa-doener'])
    expectChangedBranches(before, after, 'quickAdds')
  })

  it('changes nothing when nothing differs', () => {
    expect(outcome(() => actions.updateQuickAdd('qa-coffee', { amount: 350 }))).toBe('unchanged')
    expect(outcome(() => actions.reorderQuickAdds(['qa-coffee', 'qa-bakery']))).toBe('unchanged')
  })

  describe(`at most ${MAX_QUICK_ADDS} (§3.7)`, () => {
    const pizza = { label: 'Pizza', icon: 'pizza', amount: 900, categoryId: 'cat-eating' } as const

    /** Adds quick adds until there are MAX_QUICK_ADDS. */
    function fillUp(): void {
      while (getData().quickAdds.length < MAX_QUICK_ADDS) run(() => actions.addQuickAdd(pizza))
    }

    it('throws a RangeError for the ninth and leaves the data as it was', () => {
      fillUp()
      const full = getData()
      expect(full.quickAdds).toHaveLength(MAX_QUICK_ADDS)
      // outcome() also checks that nothing was set: the same data object, no store update.
      expect(outcome(() => actions.addQuickAdd(pizza))).toBe('rejected')
      expect(() => actions.addQuickAdd(pizza)).toThrow(RangeError)
      expect(getData()).toBe(full)
    })

    it('rejects the ninth before looking at its input', () => {
      fillUp()
      expect(() => actions.addQuickAdd({ ...pizza, amount: 0 })).toThrow(/at most 8 quick adds/)
    })

    it('still edits, reorders and deletes a full list, and adds again once one is deleted', () => {
      fillUp()
      run(() => actions.updateQuickAdd('qa-coffee', { amount: 380 }))
      run(() => actions.reorderQuickAdds(['qa-mensa']))
      run(() => actions.deleteQuickAdd('qa-bakery'))
      expect(outcome(() => actions.addQuickAdd(pizza))).toBe('changed')
      expect(getData().quickAdds).toHaveLength(MAX_QUICK_ADDS)
    })

    it('rejects adding to data that came with more than the limit, but lets you delete', () => {
      const extra = Array.from({ length: MAX_QUICK_ADDS + 1 - sampleData().quickAdds.length }, (_, i) => ({
        ...pizza,
        id: `qa-extra-${i}`,
        order: 10 + i,
      }))
      setData({ ...sampleData(), quickAdds: [...sampleData().quickAdds, ...extra] })
      expect(getData().quickAdds).toHaveLength(MAX_QUICK_ADDS + 1)
      expect(outcome(() => actions.addQuickAdd(pizza))).toBe('rejected')
      run(() => actions.deleteQuickAdd('qa-extra-0'))
      run(() => actions.deleteQuickAdd('qa-extra-1'))
      expect(outcome(() => actions.addQuickAdd(pizza))).toBe('changed')
    })
  })

  it('rejects invalid input', () => {
    expect(outcome(() => actions.addQuickAdd({ label: '', icon: 'coffee', amount: 350, categoryId: 'cat-coffee' }))).toBe('rejected')
    expect(outcome(() => actions.addQuickAdd({ label: 'X', icon: 'nope', amount: 350, categoryId: 'cat-coffee' }))).toBe('rejected')
    expect(outcome(() => actions.addQuickAdd({ label: 'X', icon: 'coffee', amount: 0, categoryId: 'cat-coffee' }))).toBe('rejected')
    expect(outcome(() => actions.addQuickAdd({ label: 'X', icon: 'coffee', amount: 350, categoryId: '' }))).toBe('rejected')
    expect(outcome(() => actions.updateQuickAdd('qa-unknown', { amount: 1 }))).toBe('rejected')
    expect(outcome(() => actions.updateQuickAdd('qa-coffee', { order: 9 } as never))).toBe('rejected')
    expect(outcome(() => actions.deleteQuickAdd('qa-unknown'))).toBe('rejected')
    expect(outcome(() => actions.reorderQuickAdds(['qa-coffee', 'qa-coffee']))).toBe('rejected')
  })
})

describe('markBackupDone', () => {
  it('records the time of the backup', () => {
    vi.setSystemTime(NOW + 1000)
    const { before, after } = run(() => actions.markBackupDone())
    expect(after.settings.lastBackupAt).toBe(NOW + 1000)
    expectChangedBranches(before, after, 'settings')
  })
})

describe('savings goals', () => {
  it('adds a goal at the end of the fill order, after done goals too (§3.14)', () => {
    let created: SavingsGoal | undefined
    const { before, after } = run(() => {
      created = actions.addGoal({ name: '  Winter coat ', icon: '🧥', target: 25000 })
    })
    expect(created).toEqual({
      id: expect.stringMatching(ID_PATTERN),
      name: 'Winter coat',
      icon: '🧥',
      target: 25000,
      order: 3,
      createdAt: NOW,
      doneAt: null,
    })
    expect(after.wallet.goals.at(-1)).toBe(created)
    after.wallet.goals.slice(0, -1).forEach((goal, i) => expect(goal).toBe(before.wallet.goals[i]))
    expect(after.wallet.entries).toBe(before.wallet.entries)
    expectChangedBranches(before, after, 'wallet')
    expect(fillOrder(after)).toEqual(['goal-laptop', 'goal-trip', created?.id])
  })

  it('starts the fill order at 0 and cuts names to 24 characters', () => {
    setData(makeData())
    const name = 'A very long name for a goal indeed'
    const goal = actions.addGoal({ name, icon: 'piggy-bank', target: 1 })
    expect(goal).toMatchObject({ name: name.slice(0, MAX_LENGTHS.name).trimEnd(), order: 0 })
    expectNormalized(getData())
  })

  it.each<[string, Record<string, unknown>]>([
    ['an empty name', { name: '  ', icon: 'laptop', target: 100 }],
    ['a name that is not text', { name: 5, icon: 'laptop', target: 100 }],
    ['an unknown icon', { name: 'Laptop', icon: 'not-an-icon', target: 100 }],
    ['a target of 0', { name: 'Laptop', icon: 'laptop', target: 0 }],
    ['a fractional target', { name: 'Laptop', icon: 'laptop', target: 99.5 }],
    ['a target over the maximum', { name: 'Laptop', icon: 'laptop', target: MAX_CENTS + 1 }],
    ['a target as text', { name: 'Laptop', icon: 'laptop', target: '100' }],
  ])('rejects a goal with %s', (_name, input) => {
    expect(outcome(() => actions.addGoal(input as unknown as NewGoal))).toBe('rejected')
  })

  it('changes a goal’s name, icon and target, and nothing else', () => {
    const { before, after } = run(() => actions.updateGoal('goal-trip', { name: ' Trip to Tirana ', icon: '🏔️', target: 45000 }))
    expect(goalById('goal-trip', after)).toEqual({
      ...goalById('goal-trip', before),
      name: 'Trip to Tirana',
      icon: '🏔️',
      target: 45000,
    })
    expect(goalById('goal-laptop', after)).toBe(goalById('goal-laptop', before))
    expect(after.wallet.entries).toBe(before.wallet.entries)
    expectChangedBranches(before, after, 'wallet')
  })

  it('changes nothing when a goal already says so', () => {
    expect(outcome(() => actions.updateGoal('goal-trip', { name: 'Trip home', target: 30000 }))).toBe('unchanged')
    expect(outcome(() => actions.updateGoal('goal-trip', {}))).toBe('unchanged')
  })

  it('rejects unknown goals, fields that do not change here and invalid values', () => {
    expect(outcome(() => actions.updateGoal('goal-unknown', { target: 100 }))).toBe('rejected')
    expect(outcome(() => actions.updateGoal('goal-trip', { order: 5 } as never))).toBe('rejected')
    expect(outcome(() => actions.updateGoal('goal-trip', { doneAt: NOW } as never))).toBe('rejected')
    expect(outcome(() => actions.updateGoal('goal-trip', { name: '' }))).toBe('rejected')
    expect(outcome(() => actions.updateGoal('goal-trip', { icon: 'not-an-icon' }))).toBe('rejected')
    expect(outcome(() => actions.updateGoal('goal-trip', { target: 0 }))).toBe('rejected')
  })

  it('reorders the fill order, with unlisted goals after the listed ones', () => {
    const { before, after } = run(() => actions.reorderGoals(['goal-trip', 'goal-laptop']))
    expect(after.wallet.goals.map(({ id, order }) => [id, order])).toEqual([
      ['goal-trip', 0],
      ['goal-laptop', 1],
      ['goal-bike', 2],
    ])
    expect(goalById('goal-bike', after)).toBe(goalById('goal-bike', before))
    expect(fillOrder(after)).toEqual(['goal-trip', 'goal-laptop'])
    expectChangedBranches(before, after, 'wallet')
  })

  it('changes nothing when the order stays, and rejects unknown and repeated ids', () => {
    expect(outcome(() => actions.reorderGoals(['goal-laptop', 'goal-trip']))).toBe('unchanged')
    expect(outcome(() => actions.reorderGoals([]))).toBe('unchanged')
    expect(outcome(() => actions.reorderGoals(['goal-unknown']))).toBe('rejected')
    expect(outcome(() => actions.reorderGoals(['goal-trip', 'goal-trip']))).toBe('rejected')
  })

  it('marks a goal done: it leaves the fill order and keeps its place in the list', () => {
    vi.setSystemTime(NOW + 5000)
    const { before, after } = run(() => actions.setGoalDone('goal-laptop', true))
    expect(goalById('goal-laptop', after)).toEqual({ ...goalById('goal-laptop', before), doneAt: NOW + 5000 })
    const wallet = walletSummary(after, TODAY)
    expect(wallet.goals.map(({ goal }) => goal.id)).toEqual(['goal-trip'])
    expect(wallet.doneGoals.map(({ id }) => id)).toEqual(['goal-laptop', 'goal-bike'])
    expectChangedBranches(before, after, 'wallet')
  })

  it('puts a done goal back in its place in the fill order, so marking it done by mistake changes nothing (§5.4)', () => {
    const original = getData()
    expect(goalFills()).toEqual([
      ['goal-laptop', 116421],
      ['goal-trip', 0],
    ])
    run(() => actions.setGoalDone('goal-laptop', true))
    expect(goalFills()).toEqual([['goal-trip', 30000]])

    const { before, after } = run(() => actions.setGoalDone('goal-laptop', false))
    // Put back only clears doneAt: the goal keeps its order, so it fills first again.
    expect(goalById('goal-laptop', after)).toEqual({ ...goalById('goal-laptop', before), doneAt: null })
    expect(after.wallet.goals).toEqual(original.wallet.goals)
    expect(goalById('goal-trip', after)).toBe(goalById('goal-trip', before))
    expect(goalById('goal-bike', after)).toBe(goalById('goal-bike', before))
    expect(goalFills(after)).toEqual([
      ['goal-laptop', 116421],
      ['goal-trip', 0],
    ])
    expectChangedBranches(before, after, 'wallet')
  })

  it('fills a goal put back from the place its order gives it: before goals added later, after a new order', () => {
    run(() => actions.setGoalDone('goal-laptop', true))
    const coat = actions.addGoal({ name: 'Winter coat', icon: '🧥', target: 25000 })
    run(() => actions.setGoalDone('goal-laptop', false))
    expect(fillOrder()).toEqual(['goal-laptop', 'goal-trip', coat.id])

    // Ordering the active goals while it is done puts the done goals after them.
    run(() => actions.setGoalDone('goal-laptop', true))
    run(() => actions.reorderGoals([coat.id, 'goal-trip']))
    run(() => actions.setGoalDone('goal-laptop', false))
    expect(goalById('goal-laptop').order).toBe(2)
    expect(fillOrder()).toEqual([coat.id, 'goal-trip', 'goal-laptop'])
  })

  it('changes nothing for a goal already in that state', () => {
    expect(outcome(() => actions.setGoalDone('goal-bike', true))).toBe('unchanged')
    expect(goalById('goal-bike').doneAt).toBe(daysAfterInstall(30))
    expect(outcome(() => actions.setGoalDone('goal-laptop', false))).toBe('unchanged')
  })

  it('rejects unknown goals and flags that are not boolean', () => {
    expect(outcome(() => actions.setGoalDone('goal-unknown', true))).toBe('rejected')
    expect(outcome(() => actions.setGoalDone('goal-laptop', 'yes' as never))).toBe('rejected')
  })

  it('deletes a goal', () => {
    const { before, after } = run(() => actions.deleteGoal('goal-trip'))
    expect(after.wallet.goals.map(({ id }) => id)).toEqual(['goal-laptop', 'goal-bike'])
    expect(after.wallet.goals[0]).toBe(before.wallet.goals[0])
    expectChangedBranches(before, after, 'wallet')
    expect(outcome(() => actions.deleteGoal('goal-trip'))).toBe('rejected')
  })
})

describe('markReviewed', () => {
  it('records the reviewed period, which ends the month-end banner (§3.15)', () => {
    const data = sampleData()
    setData({ ...data, settings: { ...data.settings, lastReviewedMonth: null } })
    expect(unreviewedClosedMonth(getData(), TODAY)).toBe('2026-09')
    const { before, after } = run(() => actions.markReviewed('2026-09'))
    expect(after.settings).toEqual({ ...before.settings, lastReviewedMonth: '2026-09' })
    expect(after.settings.homeCards).toBe(before.settings.homeCards)
    expectChangedBranches(before, after, 'settings')
    expect(unreviewedClosedMonth(after, TODAY)).toBeNull()
  })

  it('only moves forward, so reviewing an older period again never brings a banner back', () => {
    expect(getData().settings.lastReviewedMonth).toBe('2026-09')
    expect(outcome(() => actions.markReviewed('2026-08'))).toBe('unchanged')
    expect(outcome(() => actions.markReviewed('2026-09'))).toBe('unchanged')
    run(() => actions.markReviewed('2026-10'))
    expect(getData().settings.lastReviewedMonth).toBe('2026-10')
  })

  it.each(['2026-13', '2026-9', '2026-10-01', '', null, 202609, '1899-12'])('rejects the month %j', (month) => {
    expect(outcome(() => actions.markReviewed(month as never))).toBe('rejected')
  })
})

describe('wallet', () => {
  it('sets the opening balance, 0 and the maximum included (§4.8)', () => {
    const { before, after } = run(() => actions.setWalletOpening(0))
    expect(after.wallet).toEqual({ ...before.wallet, opening: 0 })
    expect(after.wallet.entries).toBe(before.wallet.entries)
    expect(after.wallet.goals).toBe(before.wallet.goals)
    expectChangedBranches(before, after, 'wallet')
    expect(walletSummary(after, TODAY).balance).toBe(walletSummary(before, TODAY).balance - 50000)

    run(() => actions.setWalletOpening(MAX_CENTS))
    expect(getData().wallet.opening).toBe(MAX_CENTS)
    expect(outcome(() => actions.setWalletOpening(MAX_CENTS))).toBe('unchanged')
  })

  it.each([-1, 1.5, MAX_CENTS + 1, Number.NaN, '100', null])('rejects the opening balance %j', (amount) => {
    expect(outcome(() => actions.setWalletOpening(amount as never))).toBe('rejected')
  })

  it('sets the first period and goes back to the set-up period with null', () => {
    const { before, after } = run(() => actions.setWalletStart('2026-09'))
    expect(after.wallet).toEqual({ ...before.wallet, startMonth: '2026-09' })
    expect(after.wallet.entries).toBe(before.wallet.entries)
    expectChangedBranches(before, after, 'wallet')
    expect(walletSummary(after, TODAY).start).toBe('2026-09')
    expect(outcome(() => actions.setWalletStart('2026-09'))).toBe('unchanged')

    run(() => actions.setWalletStart(null))
    expect(getData().wallet.startMonth).toBeNull()
    expect(outcome(() => actions.setWalletStart(null))).toBe('unchanged')
  })

  it.each(['2026-13', '2026-10-01', '', undefined, 202610])('rejects the first period %j', (month) => {
    expect(outcome(() => actions.setWalletStart(month as never))).toBe('rejected')
  })

  it('adds money and takes money out with entries (§3.12)', () => {
    let created: WalletEntry | undefined
    const { before, after } = run(() => {
      created = actions.addWalletEntry({ kind: 'deposit', amount: 2500, date: TODAY, note: `  ${'n'.repeat(90)}` })
    })
    expect(created).toEqual({
      id: expect.stringMatching(ID_PATTERN),
      kind: 'deposit',
      amount: 2500,
      date: TODAY,
      note: 'n'.repeat(MAX_LENGTHS.note),
      createdAt: NOW,
    })
    expect(after.wallet.entries.at(-1)).toBe(created)
    after.wallet.entries.slice(0, -1).forEach((entry, i) => expect(entry).toBe(before.wallet.entries[i]))
    expect(after.wallet.goals).toBe(before.wallet.goals)
    expectChangedBranches(before, after, 'wallet')
    expect(walletSummary(after, TODAY).balance).toBe(walletSummary(before, TODAY).balance + 2500)

    const taken = actions.addWalletEntry({ kind: 'withdrawal', amount: 1000, date: TODAY })
    expect(taken).toMatchObject({ kind: 'withdrawal', amount: 1000, note: '' })
    expectNormalized(getData())
    expect(walletSummary(getData(), TODAY).balance).toBe(walletSummary(after, TODAY).balance - 1000)
  })

  it.each<[string, Record<string, unknown>]>([
    ['an unknown kind', { kind: 'transfer', amount: 100, date: TODAY }],
    ['an amount of 0', { kind: 'deposit', amount: 0, date: TODAY }],
    ['an amount over the maximum', { kind: 'deposit', amount: MAX_CENTS + 1, date: TODAY }],
    ['a fractional amount', { kind: 'deposit', amount: 2.5, date: TODAY }],
    ['a date that does not exist', { kind: 'deposit', amount: 100, date: '2026-02-29' }],
    ['a note that is not text', { kind: 'deposit', amount: 100, date: TODAY, note: 1 }],
  ])('rejects an entry with %s', (_name, input) => {
    expect(outcome(() => actions.addWalletEntry(input as unknown as NewWalletEntry))).toBe('rejected')
  })

  it('changes an entry and nothing else', () => {
    const { before, after } = run(() =>
      actions.updateWalletEntry('wal-gift', { kind: 'withdrawal', amount: 4000, date: '2026-09-13', note: ' Lent to Max ' }),
    )
    expect(entryById('wal-gift', after)).toEqual({
      ...entryById('wal-gift', before),
      kind: 'withdrawal',
      amount: 4000,
      date: '2026-09-13',
      note: 'Lent to Max',
    })
    expect(entryById('wal-savings', after)).toBe(entryById('wal-savings', before))
    expect(after.wallet.goals).toBe(before.wallet.goals)
    expectChangedBranches(before, after, 'wallet')
  })

  it('changes nothing when an entry already says so, and rejects invalid changes', () => {
    expect(outcome(() => actions.updateWalletEntry('wal-gift', { amount: 5000, note: '' }))).toBe('unchanged')
    expect(outcome(() => actions.updateWalletEntry('wal-unknown', { amount: 1 }))).toBe('rejected')
    expect(outcome(() => actions.updateWalletEntry('wal-gift', { createdAt: 1 } as never))).toBe('rejected')
    expect(outcome(() => actions.updateWalletEntry('wal-gift', { kind: 'gift' } as never))).toBe('rejected')
    expect(outcome(() => actions.updateWalletEntry('wal-gift', { date: '2026-9-12' } as never))).toBe('rejected')
    expect(outcome(() => actions.updateWalletEntry('wal-gift', { amount: 0 }))).toBe('rejected')
  })

  it('deletes an entry', () => {
    const { before, after } = run(() => actions.deleteWalletEntry('wal-savings'))
    expect(after.wallet.entries).toEqual([entryById('wal-gift', before)])
    expect(after.wallet.entries[0]).toBe(entryById('wal-gift', before))
    expectChangedBranches(before, after, 'wallet')
    expect(outcome(() => actions.deleteWalletEntry('wal-savings'))).toBe('rejected')
  })
})

describe('restore', () => {
  it('puts back the very object from before (undo)', () => {
    const before = getData()
    actions.addTransaction({ kind: 'expense', amount: 100, categoryId: 'cat-coffee', date: TODAY })
    run(() => actions.restore(before))
    expect(getData()).toBe(before)
  })

  it('changes nothing for the current data', () => {
    expect(outcome(() => actions.restore(getData()))).toBe('unchanged')
  })

  it('rejects anything that is not app data', () => {
    expect(outcome(() => actions.restore(null as never))).toBe('rejected')
    expect(outcome(() => actions.restore({ settings: {} } as never))).toBe('rejected')
    expect(outcome(() => actions.restore({ ...getData(), settings: null } as never))).toBe('rejected')
  })
})

describe('a session of changes', () => {
  it('normalises to itself after every step', () => {
    setData(makeData())
    const steps: (() => unknown)[] = [
      () => actions.updateSettings({ name: 'Ana', avatar: '🦊', onboarded: true }),
      () => actions.addRecurring({ kind: 'income', name: 'Parents', categoryId: null, amount: 50000, startMonth: '2026-10', dueDay: 1 }),
      () => actions.addRecurring({ kind: 'expense', name: 'Rent', categoryId: 'cat-rent', amount: 45000, startMonth: '2026-10', dueDay: 3 }),
      () => actions.addTransaction({ kind: 'expense', amount: 350, categoryId: 'cat-coffee', date: TODAY, note: 'Coffee' }),
      () =>
        actions.addTransaction({
          kind: 'expense',
          amount: 3200,
          categoryId: 'cat-eating',
          date: TODAY,
          note: 'Pizza night',
          splits: [
            { person: 'Lea', amount: 1066 },
            { person: 'Max', amount: 1066 },
          ],
        }),
      () => actions.setSplitStatus(lastTx().id, lastTx().splits[0]?.id ?? '', 'paid'),
      () => actions.updateTransaction(lastTx().id, { fromWallet: true, splits: [...lastTx().splits, { person: 'Sam', amount: 500 }] }),
      () => actions.setOverride('2026-10', recurringById(getData().recurring[1]?.id ?? '').id, { paid: true }),
      () => actions.setWalletOpening(50000),
      () => actions.setWalletStart('2026-09'),
      () => actions.addWalletEntry({ kind: 'withdrawal', amount: 20000, date: TODAY, note: 'Savings account' }),
      () => actions.addGoal({ name: 'Laptop', icon: 'laptop', target: 120000 }),
      () => actions.addGoal({ name: 'Trip home', icon: '✈️', target: 30000 }),
      () => actions.reorderGoals([goalId(1)]),
      () => actions.setGoalDone(goalId(0), true),
      () => actions.setMonthStartDay(25),
      () => actions.setSavingsGoal(10000, TODAY),
      () => actions.addCategory({ name: 'Pets', icon: '🐶', kind: 'daily', budget: 4000 }),
      () => actions.deleteCategory('cat-coffee', 'cat-eating'),
      () => actions.markReviewed('2026-09'),
      () => actions.setMonthStartDay(1),
      () => actions.setGoalDone(goalId(0), false),
      () => actions.updateWalletEntry(getData().wallet.entries[0]?.id ?? '', { amount: 15000 }),
      () => actions.deleteGoal(goalId(1)),
      () => actions.markBackupDone(),
    ]
    expect(steps.map((step) => outcome(step))).toEqual(steps.map(() => 'changed'))
  })
})
