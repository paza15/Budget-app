import { afterEach, describe, expect, it } from 'vitest'
import { CATEGORY_ICONS, CURRENCIES, HOME_CARDS } from '@/domain/catalog'
import { MAX_CENTS, MAX_LENGTHS } from '@/domain/constants'
import { createDefaultSettings, createInitialData, CURRENT_SCHEMA_VERSION } from '@/domain/defaults'
import { ID_PATTERN } from '@/domain/ids'
import {
  DataError,
  droppedCount,
  isRecord,
  MIGRATIONS,
  normalizeAppData,
  ownValue,
  type NormalizeReport,
} from '@/domain/normalize'
import { computeMonthSummary, UNCATEGORIZED_ID } from '@/domain/summary'
import {
  appDataProblems,
  makeCategory,
  makeData,
  makeGoal,
  makeQuickAdd,
  makeRecurring,
  makeSplit,
  makeTransaction,
  NOW,
  sampleData,
  TODAY,
  toRaw,
} from '@/domain/test-helpers/dataFixtures'
import { withoutAlbanianLocaleData } from '@/domain/test-helpers/intlFixtures'
import type {
  AppData,
  Category,
  QuickAdd,
  Recurring,
  SavingsGoal,
  Settings,
  Split,
  Transaction,
  Wallet,
  WalletEntry,
} from '@/domain/types'

type Raw = Record<string, unknown>
type Result = { data: AppData; report: NormalizeReport }

const NO_DROPS: NormalizeReport['dropped'] = { transactions: 0, recurring: 0, categories: 0, quickAdds: 0, overrides: 0 }
const CLEAN_REPORT: NormalizeReport = { migratedFrom: null, dropped: NO_DROPS, repaired: 0 }

const DAMAGED_MESSAGE = "This data is damaged and can't be opened."
const NEWER_MESSAGE = 'This data was saved by a newer version of the app. Reload to update.'

/** Object.prototype's own names before any test ran, to prove that nothing polluted it. */
const PROTOTYPE_NAMES = Object.getOwnPropertyNames(Object.prototype).toSorted()

/**
 * Normalises `raw` like the store does, then checks that the result keeps every invariant and
 * that normalising it again (at another time, so no fallback can sneak in) changes and reports
 * nothing (§4.7).
 */
function normalize(raw: unknown, now = NOW): Result {
  const result = normalizeAppData(raw, now)
  expect(appDataProblems(result.data)).toEqual([])
  const again = normalizeAppData(result.data, now + 1)
  expect(again.data).toStrictEqual(result.data)
  expect(again.report).toStrictEqual(CLEAN_REPORT)
  return result
}

/** The DataError `run` throws; fails the test when it throws nothing or something else. */
function dataErrorOf(run: () => unknown): DataError {
  try {
    run()
  } catch (error) {
    if (error instanceof DataError) return error
    throw error
  }
  throw new Error('Expected a DataError')
}

/** A copy of `record` without `keys`. */
function without(record: Raw, ...keys: string[]): Raw {
  const copy: Raw = { ...record }
  for (const key of keys) delete copy[key]
  return copy
}

/** The record at `path` (keys and indexes) inside raw data; throws when there is none. */
function recordAt(value: unknown, ...path: (string | number)[]): Raw {
  let current = value
  for (const key of path) current = (current as Record<string | number, unknown> | undefined)?.[key]
  if (typeof current !== 'object' || current === null) throw new Error(`No record at ${path.join('.')}`)
  return current as Raw
}

/** Freezes `value` and everything inside it. */
function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
}

/** A Proxy trap that refuses every access. */
function trap(): never {
  throw new Error('trap')
}

/** First-run data as storage returns it (a JSON copy), with top-level `fields` replaced. */
function rawData(fields: Raw = {}): Raw {
  return { ...toRaw(makeData()), ...fields }
}

/** A row as storage returns it: the JSON copy of `row` with `fields` replaced. */
function rawRow(row: object, fields: Raw = {}): Raw {
  return { ...toRaw(row), ...fields }
}

/** Normalises data whose only transactions are `rows`. */
function withTransactions(...rows: unknown[]): { transactions: Transaction[]; report: NormalizeReport } {
  const { data, report } = normalize(rawData({ transactions: rows }))
  return { transactions: data.transactions, report }
}

/** The single transaction `fields` make of a valid one, or undefined when it was dropped. */
function oneTransaction(fields: Raw): { tx: Transaction | undefined; report: NormalizeReport } {
  const { transactions, report } = withTransactions(rawRow(makeTransaction(), fields))
  return { tx: transactions[0], report }
}

/** The single recurring item `fields` make of a valid one, or undefined when it was dropped. */
function oneRecurring(fields: Raw): { item: Recurring | undefined; report: NormalizeReport } {
  const { data, report } = normalize(rawData({ recurring: [rawRow(makeRecurring(), fields)] }))
  return { item: data.recurring[0], report }
}

/** The single category `fields` make of a valid one, or undefined when it was dropped. */
function oneCategory(fields: Raw): { category: Category | undefined; report: NormalizeReport } {
  const { data, report } = normalize(rawData({ categories: [rawRow(makeCategory('cat-1'), fields)] }))
  return { category: data.categories[0], report }
}

/** The single quick add `fields` make of a valid one, or undefined when it was dropped. */
function oneQuickAdd(fields: Raw): { quickAdd: QuickAdd | undefined; report: NormalizeReport } {
  const { data, report } = normalize(rawData({ quickAdds: [rawRow(makeQuickAdd(), fields)] }))
  return { quickAdd: data.quickAdds[0], report }
}

/** The settings `fields` make of valid first-run settings. */
function settingsWith(fields: Raw): { settings: Settings; report: NormalizeReport } {
  const raw = rawData()
  const { data, report } = normalize({ ...raw, settings: { ...(raw.settings as Raw), ...fields } })
  return { settings: data.settings, report }
}

/** Normalises `months` next to one recurring item, 'rec-1'. */
function withMonths(months: unknown): Result {
  return normalize(rawData({ recurring: [toRaw(makeRecurring())], months }))
}

/** A split as storage returns it: Mia's open 1,00 with `fields` replaced. */
function rawSplit(fields: Raw = {}): Raw {
  return rawRow(makeSplit(), fields)
}

/** The splits that a valid expense of 10,00 (with `fields` replaced) keeps of `splits`. */
function splitsOf(splits: unknown, fields: Raw = {}): { splits: Split[]; report: NormalizeReport } {
  const { tx, report } = oneTransaction({ amount: 1000, ...fields, splits })
  if (tx === undefined) throw new Error('The expense was dropped')
  return { splits: tx.splits, report }
}

/** Raw splits s1, s2, … of the given amounts. */
function splitsOfAmounts(...values: number[]): Raw[] {
  return values.map((amount, i) => rawSplit({ id: `s${i + 1}`, amount }))
}

/** The single split a valid expense of 10,00 keeps of the split `fields` make, or undefined. */
function oneSplit(fields: Raw): { split: Split | undefined; report: NormalizeReport } {
  const { splits, report } = splitsOf([rawSplit(fields)])
  return { split: splits[0], report }
}

/** The wallet `fields` make of the empty first-run wallet. */
function walletWith(fields: Raw): { wallet: Wallet; report: NormalizeReport } {
  const raw = rawData()
  const { data, report } = normalize({ ...raw, wallet: { ...(raw.wallet as Raw), ...fields } })
  return { wallet: data.wallet, report }
}

/** The single savings goal `fields` make of a valid one, or undefined when it was dropped. */
function oneGoal(fields: Raw): { goal: SavingsGoal | undefined; report: NormalizeReport } {
  const { wallet, report } = walletWith({ goals: [rawRow(makeGoal(), fields)] })
  return { goal: wallet.goals[0], report }
}

/** A deposit of 50,00 on TODAY as storage returns it, with `fields` replaced. */
function rawEntry(fields: Raw = {}): Raw {
  const entry: WalletEntry = { id: 'wal-1', kind: 'deposit', amount: 5000, date: TODAY, note: '', createdAt: NOW }
  return rawRow(entry, fields)
}

/** The single wallet entry `fields` make of a valid one, or undefined when it was dropped. */
function oneEntry(fields: Raw): { entry: WalletEntry | undefined; report: NormalizeReport } {
  const { wallet, report } = walletWith({ entries: [rawEntry(fields)] })
  return { entry: wallet.entries[0], report }
}

/** `data` as the build before split bills, wallet payments, goals and reviews saved it. */
function withoutExtras(data: AppData): Raw {
  const raw = toRaw(data)
  delete recordAt(raw, 'settings').lastReviewedMonth
  delete recordAt(raw, 'wallet').goals
  for (const tx of raw.transactions as Raw[]) {
    delete tx.fromWallet
    delete tx.splits
  }
  return raw
}

/** Ids that §4.7 replaces, for split and goal ids. */
const BAD_IDS = [undefined, null, '', 42, 'a b', '-split', 'a'.repeat(65), UNCATEGORIZED_ID, '__proto__', 'constructor']

describe('DataError', () => {
  it('is an Error with a code, a message for the user and its own name', () => {
    const error = new DataError('damaged', DAMAGED_MESSAGE)
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(DataError)
    expect(error.name).toBe('DataError')
    expect(error.code).toBe('damaged')
    expect(error.message).toBe(DAMAGED_MESSAGE)
  })

  it('keeps the cause', () => {
    const cause = new TypeError('boom')
    expect(new DataError('not-backup', 'x', { cause }).cause).toBe(cause)
  })
})

describe('isRecord', () => {
  it.each([{}, { a: 1 }, Object.create(null) as object, new Date(0)])('accepts the object %j', (value) => {
    expect(isRecord(value)).toBe(true)
  })

  it.each([null, undefined, [], [1], 'x', 0, true, () => 1])('rejects %j', (value) => {
    expect(isRecord(value)).toBe(false)
  })
})

describe('ownValue', () => {
  it('reads own properties', () => {
    expect(ownValue({ a: 1 }, 'a')).toBe(1)
    expect(ownValue({ a: undefined }, 'a')).toBeUndefined()
  })

  it('reads inherited members as missing', () => {
    const child = Object.create({ theme: 'dark' }) as Raw
    expect(ownValue(child, 'theme')).toBeUndefined()
    expect(ownValue({}, 'constructor')).toBeUndefined()
    expect(ownValue({}, 'toString')).toBeUndefined()
    expect(ownValue({}, '__proto__')).toBeUndefined()
  })

  it('reads a __proto__ key that JSON.parse created as data', () => {
    const parsed = JSON.parse('{"__proto__": {"theme": "dark"}}') as Raw
    expect(ownValue(parsed, '__proto__')).toEqual({ theme: 'dark' })
    expect(ownValue(parsed, 'theme')).toBeUndefined()
  })
})

describe('MIGRATIONS', () => {
  afterEach(() => {
    delete MIGRATIONS[0]
  })

  it('has no steps yet: schema 1 is the first', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(1)
    expect(Object.keys(MIGRATIONS)).toEqual([])
  })

  it('runs before validation, and the report says where the data came from', () => {
    // A pretend schema 0 that called transactions "entries".
    MIGRATIONS[0] = (raw) => ({ ...without(raw, 'entries'), schemaVersion: 1, transactions: raw.entries })
    const raw = without(rawData({ schemaVersion: 0, entries: [toRaw(makeTransaction())] }), 'transactions')
    const { data, report } = normalize(raw)
    expect(report.migratedFrom).toBe(0)
    expect(data.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(data.transactions).toEqual([makeTransaction()])
  })

  it('treats a step that returns no object as damaged data', () => {
    MIGRATIONS[0] = () => [] as unknown as Raw
    expect(dataErrorOf(() => normalizeAppData(rawData({ schemaVersion: 0 }), NOW)).code).toBe('damaged')
  })

  it('treats a step that throws as damaged data', () => {
    const failure = new TypeError('no such field')
    MIGRATIONS[0] = () => {
      throw failure
    }
    const error = dataErrorOf(() => normalizeAppData(rawData({ schemaVersion: 0 }), NOW))
    expect(error.code).toBe('damaged')
    expect(error.cause).toBe(failure)
  })

  it.each([0, -1, -1e15])('treats schema %d, which no step migrates, as damaged', (schemaVersion) => {
    expect(dataErrorOf(() => normalizeAppData(rawData({ schemaVersion }), NOW)).code).toBe('damaged')
  })
})

describe('normalizeAppData refuses', () => {
  it.each([null, undefined, 0, 'data', true, [], [rawData()]])('%j as damaged', (raw) => {
    const error = dataErrorOf(() => normalizeAppData(raw, NOW))
    expect(error.code).toBe('damaged')
    expect(error.message).toBe(DAMAGED_MESSAGE)
  })

  it('a function as damaged', () => {
    expect(dataErrorOf(() => normalizeAppData(() => rawData(), NOW)).code).toBe('damaged')
  })

  it.each([undefined, '1', 1.5, Number.NaN, Number.POSITIVE_INFINITY, null, 2 ** 53])(
    'schemaVersion %j as damaged',
    (schemaVersion) => {
      expect(dataErrorOf(() => normalizeAppData(rawData({ schemaVersion }), NOW)).code).toBe('damaged')
    },
  )

  it.each([2, 99])('schemaVersion %d as newer-version', (schemaVersion) => {
    const error = dataErrorOf(() => normalizeAppData(rawData({ schemaVersion }), NOW))
    expect(error.code).toBe('newer-version')
    expect(error.message).toBe(NEWER_MESSAGE)
  })

  it('a newer schema before looking at anything else, since it may have changed every field', () => {
    expect(dataErrorOf(() => normalizeAppData({ schemaVersion: 2 }, NOW)).code).toBe('newer-version')
  })

  it.each(['categories', 'recurring', 'transactions', 'quickAdds'])('data without a %s array as damaged', (key) => {
    const codes = [undefined, {}, 'x', null, 0].map((value) => {
      const raw = value === undefined ? without(rawData(), key) : rawData({ [key]: value })
      return dataErrorOf(() => normalizeAppData(raw, NOW)).code
    })
    expect(codes).toEqual(['damaged', 'damaged', 'damaged', 'damaged', 'damaged'])
  })

  it('top-level fields that are only inherited', () => {
    const raw = Object.create(rawData()) as Raw
    expect(dataErrorOf(() => normalizeAppData(raw, NOW)).code).toBe('damaged')
  })

  it('input that throws while being read, as damaged with the cause kept', () => {
    const failure = new Error('getter')
    const raw = rawData()
    Object.defineProperty(raw, 'settings', {
      enumerable: true,
      get() {
        throw failure
      },
    })
    const error = dataErrorOf(() => normalizeAppData(raw, NOW))
    expect(error.code).toBe('damaged')
    expect(error.cause).toBe(failure)
  })

  it('a Proxy whose every trap throws, as damaged', () => {
    const hostile = new Proxy({}, { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap })
    expect(dataErrorOf(() => normalizeAppData(hostile, NOW)).code).toBe('damaged')
    expect(dataErrorOf(() => normalizeAppData(rawData({ transactions: [hostile] }), NOW)).code).toBe('damaged')
  })

  it('a revoked Proxy among the rows, as damaged', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    expect(dataErrorOf(() => normalizeAppData(rawData({ categories: [proxy] }), NOW)).code).toBe('damaged')
  })
})

describe('normalizeAppData on clean data', () => {
  it('leaves first-run data as it is and reports nothing', () => {
    const data = makeData()
    const { data: normalized, report } = normalize(toRaw(data))
    expect(normalized).toStrictEqual(data)
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it('leaves realistic data as it is and reports nothing', () => {
    const data = sampleData()
    const { data: normalized, report } = normalize(toRaw(data))
    expect(normalized).toStrictEqual(data)
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it('accepts the in-memory objects the store holds, not just JSON', () => {
    const data = sampleData()
    expect(normalize(data).data).toStrictEqual(data)
  })

  it('builds new objects, so later changes to the input never reach the output', () => {
    const raw = toRaw(sampleData())
    const { data } = normalize(raw)
    expect(data).not.toBe(raw)
    expect(data.settings).not.toBe(raw.settings)
    expect(data.categories[0]).not.toBe((raw.categories as unknown[])[0])
    expect(data.transactions[0]).not.toBe((raw.transactions as unknown[])[0])
    expect(data.recurring[0]?.amounts[0]).not.toBe(recordAt(raw, 'recurring', 0, 'amounts', 0))
    expect(data.months['2026-10']).not.toBe((raw.months as Raw)['2026-10'])
    expect(data.transactions[2]?.splits).not.toBe(recordAt(raw, 'transactions', 2).splits)
    expect(data.transactions[2]?.splits[0]).not.toBe(recordAt(raw, 'transactions', 2, 'splits', 0))
    expect(data.wallet).not.toBe(raw.wallet)
    expect(data.wallet.goals[0]).not.toBe(recordAt(raw, 'wallet', 'goals', 0))
    expect(data.wallet.entries[0]).not.toBe(recordAt(raw, 'wallet', 'entries', 0))
  })

  it('never changes its input, even when the input is frozen', () => {
    const raw = toRaw(sampleData())
    const before = JSON.stringify(raw)
    deepFreeze(raw)
    normalize(raw)
    expect(JSON.stringify(raw)).toBe(before)
  })

  it('leaves out fields it does not know, at every level', () => {
    const raw = toRaw(sampleData())
    raw.extra = 1
    recordAt(raw, 'settings').pinHash = 'secret'
    recordAt(raw, 'categories', 0).extra = true
    recordAt(raw, 'transactions', 0).extra = { nested: true }
    recordAt(raw, 'quickAdds', 0).extra = 'x'
    recordAt(raw, 'recurring', 0).extra = null
    recordAt(raw, 'recurring', 0, 'amounts', 0).extra = 'y'
    recordAt(raw, 'months', '2026-09').extra = 3
    recordAt(raw, 'months', '2026-10', 'overrides', 'rec-rent').extra = 4
    recordAt(raw, 'transactions', 2, 'splits', 0).extra = 'owes me a coffee'
    recordAt(raw, 'wallet').extra = 5
    recordAt(raw, 'wallet', 'entries', 0).extra = 6
    recordAt(raw, 'wallet', 'goals', 0).extra = 7
    const { data, report } = normalize(raw)
    expect(data).toStrictEqual(sampleData())
    expect(report.dropped).toEqual(NO_DROPS)
  })

  it('reads realistic data with every extra: splits, wallet payments, goals and the reviewed month', () => {
    const data = normalize(toRaw(sampleData())).data
    const statuses = data.transactions.flatMap((tx) => tx.splits.map(({ status }) => status))
    expect(statuses.toSorted()).toEqual(['forgiven', 'open', 'paid'])
    expect(data.transactions.filter(({ fromWallet }) => fromWallet).map(({ id }) => id)).toEqual(['tx-sale'])
    expect(data.wallet.goals.map(({ id, doneAt }) => [id, doneAt === null])).toEqual([
      ['goal-laptop', true],
      ['goal-trip', true],
      ['goal-bike', false],
    ])
    expect(data.settings.lastReviewedMonth).toBe('2026-09')
  })

  it('writes the current schema version', () => {
    expect(normalize(rawData()).data.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })
})

describe('data saved before split bills, wallet payments, goals and reviews existed (§5.9)', () => {
  it('gets the defaults false, [], [] and null, and reports no damage', () => {
    const data = sampleData()
    const { data: normalized, report } = normalize(withoutExtras(data))
    expect(normalized).toStrictEqual({
      ...data,
      settings: { ...data.settings, lastReviewedMonth: null },
      transactions: data.transactions.map((tx) => ({ ...tx, fromWallet: false, splits: [] })),
      wallet: { ...data.wallet, goals: [] },
    })
    expect(report.dropped).toStrictEqual(NO_DROPS)
    expect(droppedCount(report)).toBe(0)
    expect(report.migratedFrom).toBeNull()
    // Each field filled in counts once: two per transaction, the goals and the reviewed month.
    expect(report.repaired).toBe(2 * data.transactions.length + 2)
  })

  it('fills in first-run data of that build without touching anything else', () => {
    const { data, report } = normalize(withoutExtras(makeData()))
    expect(data).toStrictEqual(makeData())
    expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 2 })
  })

  it('counts each missing field of a transaction once', () => {
    const expense = without(toRaw(makeTransaction()), 'fromWallet', 'splits')
    const income = without(toRaw(makeTransaction({ id: 'tx-2', kind: 'income' })), 'fromWallet', 'splits')
    const { transactions, report } = withTransactions(expense, income)
    expect(transactions).toStrictEqual([makeTransaction(), makeTransaction({ id: 'tx-2', kind: 'income' })])
    expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 4 })
  })

  it('gives a wallet without goals none, as one repair', () => {
    const { wallet, report } = walletWith({ goals: undefined })
    expect(wallet.goals).toEqual([])
    expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
  })

  it('treats settings without a reviewed month as never reviewed, as one repair', () => {
    const { settings, report } = settingsWith({ lastReviewedMonth: undefined })
    expect(settings.lastReviewedMonth).toBeNull()
    expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
  })
})

describe('ids', () => {
  const INVALID_IDS = [
    undefined,
    '',
    ' cat',
    '-cat',
    '_cat',
    'a b',
    'ä',
    'a/b',
    'a'.repeat(65),
    42,
    null,
    UNCATEGORIZED_ID,
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    'valueOf',
  ]

  it.each(INVALID_IDS)('replaces the id %j with a new valid one in every collection', (id) => {
    const raw = rawData({
      categories: [rawRow(makeCategory('cat-1'), { id })],
      recurring: [rawRow(makeRecurring(), { id })],
      transactions: [rawRow(makeTransaction(), { id })],
      quickAdds: [rawRow(makeQuickAdd(), { id })],
    })
    const { data, report } = normalize(raw)
    const ids = [data.categories, data.recurring, data.transactions, data.quickAdds].map((rows) => rows[0]?.id)
    for (const newId of ids) {
      expect(newId).toMatch(ID_PATTERN)
      expect(newId).not.toBe(id)
    }
    expect(new Set(ids).size).toBe(4)
    expect(report.repaired).toBe(4)
    expect(report.dropped).toEqual(NO_DROPS)
  })

  it.each(['a', '0', 'A_b-1', 'cat-rent', 'a'.repeat(64), '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'])(
    'keeps the valid id %s',
    (id) => {
      const { tx, report } = oneTransaction({ id })
      expect(tx?.id).toBe(id)
      expect(report.repaired).toBe(0)
    },
  )

  it('removes an exact duplicate, which loses nothing, as a repair', () => {
    const row = toRaw(makeTransaction())
    const { transactions, report } = withTransactions(row, { ...row })
    expect(transactions).toEqual([makeTransaction()])
    expect(report.dropped).toEqual(NO_DROPS)
    expect(report.repaired).toBe(1)
  })

  it('compares duplicates after repairs, so rows that differ only in padding are the same', () => {
    const { transactions, report } = withTransactions(
      rawRow(makeTransaction(), { note: 'Coffee' }),
      rawRow(makeTransaction(), { note: '  Coffee ' }),
    )
    expect(transactions).toHaveLength(1)
    expect(report.repaired).toBe(2)
  })

  it('gives a different row with a taken id a new id and keeps both', () => {
    const { transactions, report } = withTransactions(
      rawRow(makeTransaction(), { amount: 350 }),
      rawRow(makeTransaction(), { amount: 400 }),
    )
    expect(transactions.map(({ amount }) => amount)).toEqual([350, 400])
    expect(transactions[0]?.id).toBe('tx-1')
    expect(transactions[1]?.id).toMatch(ID_PATTERN)
    expect(transactions[1]?.id).not.toBe('tx-1')
    expect(report.repaired).toBe(1)
  })

  it('keeps the first of three rows with one id, renames the different one and removes the copy', () => {
    const first = toRaw(makeTransaction({ note: 'first' }))
    const { transactions } = withTransactions(first, rawRow(makeTransaction({ note: 'second' })), { ...first })
    expect(transactions.map(({ note }) => note)).toEqual(['first', 'second'])
    expect(transactions[0]?.id).toBe('tx-1')
  })

  it.each([
    ['categories', makeCategory('cat-books', { name: 'Books' }), makeCategory('cat-films', { name: 'Films' })],
    ['recurring', makeRecurring({ id: 'rec-rent' }), makeRecurring({ id: 'rec-gym', name: 'Gym' })],
    ['quickAdds', makeQuickAdd({ id: 'qa-coffee' }), makeQuickAdd({ id: 'qa-doener', label: 'Döner' })],
  ] as const)('removes an exact duplicate among %s without an order, whose order comes from the position', (collection, row, other) => {
    const copy = without(toRaw(row), 'order')
    const { data, report } = normalize(rawData({ [collection]: [toRaw(other), copy, { ...copy }] }))
    const rows: readonly { id: string; order: number }[] = data[collection]
    // Both copies take the position of the first: index 1.
    expect(rows.map(({ id, order }) => [id, order])).toEqual([
      [other.id, 0],
      [row.id, 1],
    ])
    // Two orders taken from the position, and the copy removed.
    expect(report.repaired).toBe(3)
    expect(report.dropped).toEqual(NO_DROPS)
  })

  it('counts a fixed cost stored twice without an order once', () => {
    const rent = without(toRaw(makeRecurring({ id: 'rec-rent' })), 'order')
    const { data } = normalize(rawData({ recurring: [rent, { ...rent }] }))
    expect(data.recurring.map(({ id }) => id)).toEqual(['rec-rent'])
    const summary = computeMonthSummary(data, '2026-10', TODAY)
    expect(summary.fixedLines.map((line) => line.recurring.id)).toEqual(['rec-rent'])
    expect(summary.fixed).toBe(65000)
  })

  it('gives a different row with a taken id and no order the first row’s position and a new id', () => {
    const books = toRaw(makeCategory('cat-books', { name: 'Books' }))
    const { data } = normalize(
      rawData({
        categories: [
          toRaw(makeCategory('cat-films', { name: 'Films' })),
          without(books, 'order'),
          toRaw(makeCategory('cat-music', { name: 'Music', order: 2 })),
          without({ ...books, name: 'Comics' }, 'order'),
        ],
      }),
    )
    expect(data.categories.map(({ name, order }) => [name, order])).toEqual([
      ['Films', 0],
      ['Books', 1],
      ['Music', 2],
      ['Comics', 1],
    ])
    expect(data.categories.map(({ id }) => id).slice(0, 3)).toEqual(['cat-films', 'cat-books', 'cat-music'])
    expect(data.categories[3]?.id).toMatch(ID_PATTERN)
    expect(data.categories[3]?.id).not.toBe('cat-books')
  })

  it('takes the position of the first row it keeps, not of a dropped one with the same id', () => {
    const books = toRaw(makeCategory('cat-books', { name: 'Books' }))
    const { data, report } = normalize(
      rawData({
        categories: [without(books, 'name'), toRaw(makeCategory('cat-films', { name: 'Films', order: 1 })), without(books, 'order')],
      }),
    )
    expect(data.categories.map(({ id, order }) => [id, order])).toEqual([
      ['cat-films', 1],
      ['cat-books', 2],
    ])
    expect(report.dropped).toEqual({ ...NO_DROPS, categories: 1 })
  })

  it('makes ids unique per collection only', () => {
    const { data, report } = normalize(
      rawData({
        categories: [toRaw(makeCategory('shared'))],
        recurring: [rawRow(makeRecurring(), { id: 'shared' })],
        transactions: [rawRow(makeTransaction(), { id: 'shared' })],
        quickAdds: [rawRow(makeQuickAdd(), { id: 'shared' })],
      }),
    )
    expect([data.categories, data.recurring, data.transactions, data.quickAdds].map((rows) => rows[0]?.id)).toEqual([
      'shared',
      'shared',
      'shared',
      'shared',
    ])
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it('accepts __none__ as a category reference, never as a record id', () => {
    const { tx, report } = oneTransaction({ categoryId: UNCATEGORIZED_ID })
    expect(tx?.categoryId).toBe(UNCATEGORIZED_ID)
    expect(report).toStrictEqual(CLEAN_REPORT)
    expect(oneCategory({ id: UNCATEGORIZED_ID }).category?.id).not.toBe(UNCATEGORIZED_ID)
  })
})

describe('text', () => {
  it('trims every text field', () => {
    const raw = rawData({
      categories: [rawRow(makeCategory('cat-1'), { name: '  Books ' })],
      recurring: [rawRow(makeRecurring(), { name: ' Rent\n', note: '\tFlat ' })],
      transactions: [rawRow(makeTransaction(), { note: ' Coffee ' })],
      quickAdds: [rawRow(makeQuickAdd(), { label: ' Coffee  ' })],
    })
    ;(raw.settings as Raw).name = '  Alex '
    const { data, report } = normalize(raw)
    expect(data.settings.name).toBe('Alex')
    expect(data.categories[0]?.name).toBe('Books')
    expect([data.recurring[0]?.name, data.recurring[0]?.note]).toEqual(['Rent', 'Flat'])
    expect(data.transactions[0]?.note).toBe('Coffee')
    expect(data.quickAdds[0]?.label).toBe('Coffee')
    expect(report.repaired).toBe(6)
  })

  const LIMITS: [string, number, (text: string) => string | undefined][] = [
    ['settings name', MAX_LENGTHS.name, (text) => settingsWith({ name: text }).settings.name],
    ['category name', MAX_LENGTHS.category, (text) => oneCategory({ name: text }).category?.name],
    ['quick add label', MAX_LENGTHS.quickAdd, (text) => oneQuickAdd({ label: text }).quickAdd?.label],
    ['recurring name', MAX_LENGTHS.recurring, (text) => oneRecurring({ name: text }).item?.name],
    ['recurring note', MAX_LENGTHS.note, (text) => oneRecurring({ note: text }).item?.note],
    ['transaction note', MAX_LENGTHS.note, (text) => oneTransaction({ note: text }).tx?.note],
  ]

  it.each(LIMITS)('cuts a %s to %d characters', (_field, limit, read) => {
    expect(read('x'.repeat(limit + 5))).toBe('x'.repeat(limit))
    expect(read('y'.repeat(limit))).toBe('y'.repeat(limit))
  })

  it.each(LIMITS)('counts a %s in characters, so emoji are never split', (_field, limit, read) => {
    const coder = '👩‍💻'
    expect(read(coder.repeat(limit))).toBe(coder.repeat(limit))
    expect(read(coder.repeat(limit + 3))).toBe(coder.repeat(limit))
    expect(read('e\u{301}'.repeat(limit + 1))).toBe('e\u{301}'.repeat(limit))
  })

  it('trims the end again after a cut', () => {
    const { tx } = oneTransaction({ note: `${'a'.repeat(79)} ${'b'.repeat(10)}` })
    expect(tx?.note).toBe('a'.repeat(79))
  })

  it('counts a cut as one repair and an exact fit as none', () => {
    expect(oneTransaction({ note: 'n'.repeat(81) }).report.repaired).toBe(1)
    expect(oneTransaction({ note: 'n'.repeat(80) }).report.repaired).toBe(0)
  })

  it('cuts even very long text quickly', () => {
    expect(oneTransaction({ note: 'z'.repeat(1_000_000) }).tx?.note).toBe('z'.repeat(80))
  })

  it.each([42, null, undefined, ['Coffee'], { text: 'Coffee' }, true])('turns the note %j into empty text', (note) => {
    const { tx, report } = oneTransaction({ note })
    expect(tx?.note).toBe('')
    expect(report.repaired).toBe(1)
  })
})

describe('transactions', () => {
  it.each([undefined, 'Expense', 'expense ', 'refund', 'fixed', 1, null, true])('drops one with the kind %j', (kind) => {
    const { tx, report } = oneTransaction({ kind })
    expect(tx).toBeUndefined()
    expect(report.dropped).toEqual({ ...NO_DROPS, transactions: 1 })
    expect(droppedCount(report)).toBe(1)
  })

  it.each([0, -350, 3.5, '350', MAX_CENTS + 1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, 2 ** 53])(
    'drops one with the amount %j',
    (amount) => {
      const { tx, report } = oneTransaction({ amount })
      expect(tx).toBeUndefined()
      expect(report.dropped.transactions).toBe(1)
    },
  )

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-10-1',
    '14.10.2026',
    '2026-10-14T10:00',
    ' 2026-10-14',
    20261014,
    '1899-12-31',
    '3000-01-01',
    null,
    undefined,
  ])('drops one with the date %j', (date) => {
    const { tx, report } = oneTransaction({ date })
    expect(tx).toBeUndefined()
    expect(report.dropped.transactions).toBe(1)
  })

  it.each([
    [1, '1900-01-01'],
    [MAX_CENTS, '2999-12-31'],
    [350, '2028-02-29'],
  ])('keeps the edge values amount %d and date %s', (amount, date) => {
    const { tx, report } = oneTransaction({ amount, date })
    expect([tx?.amount, tx?.date]).toEqual([amount, date])
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it('drops rows that are not objects, and keeps the rest in order', () => {
    const { transactions, report } = withTransactions(
      null,
      rawRow(makeTransaction({ id: 'tx-a' })),
      'tx',
      42,
      [],
      rawRow(makeTransaction({ id: 'tx-b' })),
      true,
    )
    expect(transactions.map(({ id }) => id)).toEqual(['tx-a', 'tx-b'])
    expect(report.dropped.transactions).toBe(5)
  })

  it('removes the category of income', () => {
    const income = makeTransaction({ kind: 'income' })
    expect(oneTransaction(rawRow(income, { categoryId: 'cat-coffee' }))).toEqual({
      tx: income,
      report: { ...CLEAN_REPORT, repaired: 1 },
    })
    expect(oneTransaction(rawRow(income)).report).toStrictEqual(CLEAN_REPORT)
  })

  it.each([null, undefined, 'a b', 5, 'constructor', ''])('files an expense with the category %j as uncategorized', (categoryId) => {
    const { tx, report } = oneTransaction({ categoryId })
    expect(tx?.categoryId).toBe(UNCATEGORIZED_ID)
    expect(report.repaired).toBe(1)
  })

  it('keeps the ids of categories that no longer exist', () => {
    const { tx, report } = oneTransaction({ categoryId: 'cat-gone' })
    expect(tx?.categoryId).toBe('cat-gone')
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it.each([undefined, null, -1, 1.5, '1760428800000', Date.UTC(3000, 0, 1), Number.NaN])(
    'uses now for the createdAt %j, and createdAt for a missing updatedAt',
    (createdAt) => {
      const { tx, report } = oneTransaction({ createdAt, updatedAt: undefined })
      expect([tx?.createdAt, tx?.updatedAt]).toEqual([NOW, NOW])
      expect(report.repaired).toBe(2)
    },
  )

  it('falls back to createdAt for an invalid updatedAt', () => {
    const createdAt = NOW - 1000
    const { tx, report } = oneTransaction({ createdAt, updatedAt: 'later' })
    expect(tx?.updatedAt).toBe(createdAt)
    expect(report.repaired).toBe(1)
  })
})

describe('paying from the wallet (§3.13)', () => {
  it.each([true, false])('keeps fromWallet %s on an expense', (fromWallet) => {
    const { tx, report } = oneTransaction({ fromWallet })
    expect(tx?.fromWallet).toBe(fromWallet)
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it.each([undefined, null, 'true', 'yes', 1, 0, {}, [true]])('treats the expense fromWallet %j as paid from the budget', (fromWallet) => {
    const { tx, report } = oneTransaction({ fromWallet })
    expect(tx?.fromWallet).toBe(false)
    expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
  })

  it('never pays income from the wallet', () => {
    const income = makeTransaction({ kind: 'income' })
    expect(oneTransaction(rawRow(income, { fromWallet: true }))).toEqual({
      tx: income,
      report: { ...CLEAN_REPORT, repaired: 1 },
    })
    expect(oneTransaction(rawRow(income, { fromWallet: 'yes' })).tx?.fromWallet).toBe(false)
    expect(oneTransaction(rawRow(income)).report).toStrictEqual(CLEAN_REPORT)
  })

  it('keeps a wallet payment that is split too', () => {
    const tx = makeTransaction({ amount: 5000, fromWallet: true, splits: [makeSplit({ amount: 2000 })] })
    const { transactions, report } = withTransactions(toRaw(tx))
    expect(transactions).toStrictEqual([tx])
    expect(report).toStrictEqual(CLEAN_REPORT)
  })
})

describe('split bills (§3.16, §4.9)', () => {
  const settled = { settledAt: NOW - 60_000 }

  it('keeps open, paid and forgiven splits as they are', () => {
    const splits = [
      makeSplit({ id: 'split-mia', amount: 300 }),
      makeSplit({ id: 'split-jonas', person: 'Jonas', amount: 300, status: 'paid', ...settled }),
      makeSplit({ id: 'split-lena', person: 'Lena', amount: 300, status: 'forgiven', ...settled }),
    ]
    const result = splitsOf(splits.map((split) => toRaw(split)))
    expect(result.splits).toStrictEqual(splits)
    expect(result.report).toStrictEqual(CLEAN_REPORT)
  })

  it('keeps an expense split in full, and the edge amounts 1 and MAX_CENTS', () => {
    const full = [rawSplit({ id: 's1', amount: 999 }), rawSplit({ id: 's2', amount: 1 })]
    expect(splitsOf(full).splits.map(({ amount }) => amount)).toEqual([999, 1])
    const huge = splitsOf([rawSplit({ amount: MAX_CENTS })], { amount: MAX_CENTS })
    expect(huge.splits.map(({ amount }) => amount)).toEqual([MAX_CENTS])
    expect(huge.report).toStrictEqual(CLEAN_REPORT)
  })

  it.each([undefined, null, 'Mia', 5, true, { 0: makeSplit() }])('treats the splits %j as none, as one repair', (splits) => {
    const result = splitsOf(splits)
    expect(result.splits).toEqual([])
    expect(result.report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
  })

  it('removes the splits of income as one repair', () => {
    const income = { kind: 'income', categoryId: null }
    expect(splitsOf([rawSplit(), rawSplit({ id: 'split-2' })], income)).toStrictEqual({
      splits: [],
      report: { ...CLEAN_REPORT, repaired: 1 },
    })
    expect(splitsOf('splits', income).report.repaired).toBe(1)
    expect(splitsOf([], income).report).toStrictEqual(CLEAN_REPORT)
  })

  it('removes splits that are not objects, each as a repair, and keeps the rest in order', () => {
    const result = splitsOf([null, rawSplit({ id: 's1' }), 'Mia', 7, [], rawSplit({ id: 's2' }), true])
    expect(result.splits.map(({ id }) => id)).toEqual(['s1', 's2'])
    expect(result.report).toStrictEqual({ ...CLEAN_REPORT, repaired: 5 })
  })

  it('trims the name of the person', () => {
    const { split, report } = oneSplit({ person: '  Mia\n' })
    expect(split?.person).toBe('Mia')
    expect(report.repaired).toBe(1)
  })

  it('cuts the name of the person to 24 characters, never splitting an emoji', () => {
    expect(oneSplit({ person: 'x'.repeat(30) }).split?.person).toBe('x'.repeat(24))
    expect(oneSplit({ person: 'y'.repeat(24) }).report).toStrictEqual(CLEAN_REPORT)
    expect(oneSplit({ person: '👩‍💻'.repeat(30) }).split?.person).toBe('👩‍💻'.repeat(24))
  })

  it.each(['', '   ', '\n\t', 42, null, undefined, ['Mia'], { name: 'Mia' }])(
    'removes a split whose person is %j, as a repair of the expense',
    (person) => {
      const { tx, report } = oneTransaction({ amount: 1000, splits: [rawSplit({ person })] })
      expect(tx?.splits).toEqual([])
      expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
    },
  )

  it.each([0, -100, 1.5, '100', MAX_CENTS + 1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, 2 ** 53])(
    'removes a split whose amount is %j',
    (amount) => {
      const { split, report } = oneSplit({ amount })
      expect(split).toBeUndefined()
      expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
    },
  )

  it.each(BAD_IDS)('gives a split with the id %j a new valid one', (id) => {
    const { split, report } = oneSplit({ id })
    expect(split?.id).toMatch(ID_PATTERN)
    expect(split?.id).not.toBe(id)
    expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
  })

  it('gives every split that needs a new id its own', () => {
    const { splits } = splitsOf([rawSplit({ id: 'x y', amount: 100 }), rawSplit({ id: 'x y', amount: 200 }), rawSplit({ id: null })])
    expect(new Set(splits.map(({ id }) => id)).size).toBe(3)
  })

  it('removes an exact copy of a split, which loses nothing, as a repair', () => {
    const result = splitsOf([rawSplit({ id: 's1', amount: 600 }), rawSplit({ id: 's1', amount: 600 }), rawSplit({ id: 's2', amount: 400 })])
    expect(result.splits.map(({ id, amount }) => [id, amount])).toEqual([
      ['s1', 600],
      ['s2', 400],
    ])
    expect(result.report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
  })

  it('compares copies after repairs, so splits that differ only in padding are the same', () => {
    const result = splitsOf([rawSplit({ id: 's1', person: 'Mia' }), rawSplit({ id: 's1', person: ' Mia ' })])
    expect(result.splits).toHaveLength(1)
    expect(result.report.repaired).toBe(2)
  })

  it('gives a different split with a taken id a new id and keeps both', () => {
    const result = splitsOf([rawSplit({ id: 's1', amount: 600 }), rawSplit({ id: 's1', person: 'Jonas', amount: 300 })])
    expect(result.splits.map(({ person, amount }) => [person, amount])).toEqual([
      ['Mia', 600],
      ['Jonas', 300],
    ])
    expect(result.splits[0]?.id).toBe('s1')
    expect(result.splits[1]?.id).toMatch(ID_PATTERN)
    expect(result.splits[1]?.id).not.toBe('s1')
    expect(result.report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
  })

  it('makes split ids unique within an expense only', () => {
    const { transactions, report } = withTransactions(
      rawRow(makeTransaction({ id: 'tx-a', splits: [makeSplit({ id: 'split-1' })] })),
      rawRow(makeTransaction({ id: 'tx-b', splits: [makeSplit({ id: 'split-1' })] })),
    )
    expect(transactions.map(({ splits }) => splits[0]?.id)).toEqual(['split-1', 'split-1'])
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it('still removes an exact copy of an expense whose split needed a new id', () => {
    const row = rawRow(makeTransaction({ amount: 1000 }), { splits: [rawSplit({ id: 'not valid' })] })
    const { transactions, report } = withTransactions(row, toRaw(row))
    expect(transactions).toHaveLength(1)
    expect(transactions[0]?.splits[0]?.id).toMatch(ID_PATTERN)
    // The split id of each copy, then the copy itself.
    expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 3 })
  })

  it('still keeps a different expense with a taken id, splits and all', () => {
    const first = rawRow(makeTransaction({ amount: 1000 }), { splits: [rawSplit({ id: 'not valid' })] })
    const second = { ...first, note: 'Other' }
    const { transactions } = withTransactions(first, second)
    expect(transactions.map(({ note, splits }) => [note, splits.length])).toEqual([
      ['', 1],
      ['Other', 1],
    ])
    expect(transactions[1]?.id).not.toBe(transactions[0]?.id)
  })

  it.each(['Open', 'PAID', 'settled', 'owed', '', 0, null, undefined])('treats the status %j as open', (status) => {
    const { split, report } = oneSplit({ status })
    expect([split?.status, split?.settledAt]).toEqual(['open', null])
    expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
  })

  it('clears the time of a split that turned out open', () => {
    const { split, report } = oneSplit({ status: 'settled', settledAt: NOW })
    expect([split?.status, split?.settledAt]).toEqual(['open', null])
    expect(report.repaired).toBe(2)
  })

  it.each([NOW, 0, 'yesterday', -1])('removes the settled time %j of an open split', (settledAt) => {
    const { split, report } = oneSplit({ status: 'open', settledAt })
    expect(split?.settledAt).toBeNull()
    expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
  })

  it.each(['paid', 'forgiven'])('keeps the settled time of a %s split', (status) => {
    const { split, report } = oneSplit({ status, settledAt: 0 })
    expect(split?.settledAt).toBe(0)
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it.each([
    ['paid', null],
    ['paid', undefined],
    ['forgiven', -1],
    ['forgiven', 1.5],
    ['paid', '2026-10-14'],
    ['forgiven', Date.UTC(3000, 0, 1)],
  ])('dates a %s split settled at %j to the last change of its expense', (status, settledAt) => {
    const updatedAt = NOW - 5000
    const { splits, report } = splitsOf([rawSplit({ status, settledAt })], { updatedAt })
    expect(splits[0]?.settledAt).toBe(updatedAt)
    expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
  })

  it('dates it to the repaired last change when that was invalid too', () => {
    const createdAt = NOW - 9000
    const { splits, report } = splitsOf([rawSplit({ status: 'paid', settledAt: null })], { createdAt, updatedAt: 'later' })
    expect(splits[0]?.settledAt).toBe(createdAt)
    expect(report.repaired).toBe(2)
  })

  describe('never more than the amount', () => {
    it('keeps splits that add up to the amount exactly', () => {
      const result = splitsOf(splitsOfAmounts(600, 400))
      expect(result.splits).toHaveLength(2)
      expect(result.report).toStrictEqual(CLEAN_REPORT)
    })

    it('drops the last split when they add up to more, as a repair', () => {
      const result = splitsOf(splitsOfAmounts(600, 300, 200))
      expect(result.splits.map(({ id }) => id)).toEqual(['s1', 's2'])
      expect(result.report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
    })

    it('drops from the end until the rest fits, last first, each as a repair', () => {
      const result = splitsOf(splitsOfAmounts(600, 500, 100))
      expect(result.splits.map(({ id }) => id)).toEqual(['s1'])
      expect(result.report).toStrictEqual({ ...CLEAN_REPORT, repaired: 2 })
    })

    it('drops a split larger than the expense', () => {
      const result = splitsOf(splitsOfAmounts(1001))
      expect(result.splits).toEqual([])
      expect(result.report.repaired).toBe(1)
    })

    it('counts paid and forgiven splits towards the amount too', () => {
      const result = splitsOf([
        rawSplit({ id: 's1', amount: 800, status: 'forgiven', ...settled }),
        rawSplit({ id: 's2', amount: 300, status: 'paid', ...settled }),
      ])
      expect(result.splits.map(({ id }) => id)).toEqual(['s1'])
      expect(result.report.repaired).toBe(1)
    })

    it('removes copies before it adds up', () => {
      const result = splitsOf([rawSplit({ id: 's1', amount: 600 }), rawSplit({ id: 's1', amount: 600 }), rawSplit({ id: 's2', amount: 400 })])
      expect(result.splits.map(({ id }) => id)).toEqual(['s1', 's2'])
    })

    it('stays exact and quick with very many splits', () => {
      const many = Array.from({ length: 10_000 }, (_, i) => rawSplit({ id: `s${i}`, amount: MAX_CENTS }))
      const result = splitsOf(many, { amount: MAX_CENTS })
      expect(result.splits.map(({ id }) => id)).toEqual(['s0'])
      expect(result.report.repaired).toBe(9_999)
    })
  })

  it('leaves out split fields it does not know, without counting a repair', () => {
    const { split, report } = oneSplit({ note: 'pizza', currency: 'EUR' })
    expect(split).toStrictEqual(makeSplit())
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it('reads a split only from its own fields', () => {
    const inherited = Object.create(toRaw(makeSplit())) as Raw
    expect(splitsOf([inherited]).splits).toEqual([])
    const bare = Object.assign(Object.create(null) as Raw, toRaw(makeSplit()))
    expect(splitsOf([bare]).splits).toStrictEqual([makeSplit()])
  })
})

describe('recurring items', () => {
  it.each([undefined, '2026-13', '2026-1', '2026-10-01', 202610, '1899-12', null])(
    'drops one with the startMonth %j',
    (startMonth) => {
      const { item, report } = oneRecurring({ startMonth })
      expect(item).toBeUndefined()
      expect(report.dropped).toEqual({ ...NO_DROPS, recurring: 1 })
    },
  )

  it.each([
    undefined,
    [],
    'monthly',
    [{}],
    [null, 5],
    [{ from: '2026-08', amount: 0 }],
    [{ from: 'August', amount: 1000 }],
    [{ from: '2026-08', amount: '1000' }],
    { from: '2026-08', amount: 1000 },
  ])('drops one with the amount history %j', (amounts) => {
    const { item, report } = oneRecurring({ amounts })
    expect(item).toBeUndefined()
    expect(report.dropped.recurring).toBe(1)
  })

  it('keeps the valid entries of a partly damaged history', () => {
    const { item, report } = oneRecurring({
      amounts: [{ from: '2026-08', amount: 65000 }, { from: '2026-13', amount: 70000 }, null, { from: '2026-12', amount: 68000, note: 'x' }],
    })
    expect(item?.amounts).toEqual([
      { from: '2026-08', amount: 65000 },
      { from: '2026-12', amount: 68000 },
    ])
    expect(report.repaired).toBe(1)
  })

  describe('puts the amount history in shape with normalizeRecurring (§4.4)', () => {
    const history = [
      { from: '2026-01', amount: 1000 },
      { from: '2026-06', amount: 1200 },
    ]

    it('anchors the first amount at an earlier startMonth', () => {
      expect(oneRecurring({ amounts: history, startMonth: '2025-10' }).item?.amounts).toEqual([
        { from: '2025-10', amount: 1000 },
        { from: '2026-06', amount: 1200 },
      ])
    })

    it('starts with the amount in force at a later startMonth', () => {
      expect(oneRecurring({ amounts: history, startMonth: '2026-08' }).item?.amounts).toEqual([
        { from: '2026-08', amount: 1200 },
      ])
    })

    it('drops amounts after the endMonth', () => {
      const { item, report } = oneRecurring({ amounts: history, startMonth: '2026-01', endMonth: '2026-03' })
      expect(item?.amounts).toEqual([{ from: '2026-01', amount: 1000 }])
      expect(report.repaired).toBe(1)
    })

    it('sorts the history, keeps the last of equal months and merges equal neighbours', () => {
      const { item } = oneRecurring({
        startMonth: '2026-01',
        amounts: [
          { from: '2026-06', amount: 1200 },
          { from: '2026-01', amount: 1000 },
          { from: '2026-06', amount: 1300 },
          { from: '2026-09', amount: 1300 },
        ],
      })
      expect(item?.amounts).toEqual([
        { from: '2026-01', amount: 1000 },
        { from: '2026-06', amount: 1300 },
      ])
    })
  })

  it.each([4, 0, '12', null, 1.5, undefined, 24])('treats the interval %j as monthly and stops spreading', (everyMonths) => {
    const { item, report } = oneRecurring({ everyMonths, spread: true })
    expect([item?.everyMonths, item?.spread]).toEqual([1, false])
    expect(report.repaired).toBeGreaterThanOrEqual(2)
  })

  it.each([2, 3, 6, 12])('keeps the interval %d and its spread flag', (everyMonths) => {
    const { item, report } = oneRecurring({ everyMonths, spread: true })
    expect([item?.everyMonths, item?.spread]).toEqual([everyMonths, true])
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it('never spreads a monthly item', () => {
    const { item, report } = oneRecurring({ everyMonths: 1, spread: true })
    expect(item?.spread).toBe(false)
    expect(report.repaired).toBe(1)
  })

  it.each([0, 32, 1.5, '5', -1, Number.NaN])('removes the due day %j', (dueDay) => {
    const { item, report } = oneRecurring({ dueDay })
    expect(item?.dueDay).toBeNull()
    expect(report.repaired).toBe(1)
  })

  it.each([1, 31, null])('keeps the due day %j', (dueDay) => {
    expect(oneRecurring({ dueDay }).item?.dueDay).toBe(dueDay)
  })

  it.each(['2026-13', 5, 'never', ''])('treats the endMonth %j as ongoing', (endMonth) => {
    const { item, report } = oneRecurring({ endMonth })
    expect(item?.endMonth).toBeNull()
    expect(report.repaired).toBe(1)
  })

  it('moves an endMonth before the startMonth up to the startMonth', () => {
    expect(oneRecurring({ startMonth: '2026-08', endMonth: '2026-05' }).item?.endMonth).toBe('2026-08')
  })

  it('treats an unknown kind as an expense', () => {
    const { item, report } = oneRecurring({ kind: 'cost' })
    expect([item?.kind, item?.categoryId]).toEqual(['expense', 'cat-rent'])
    expect(report.repaired).toBe(1)
  })

  it('removes the category of recurring income', () => {
    const { item, report } = oneRecurring({ kind: 'income', categoryId: 'cat-rent' })
    expect(item?.categoryId).toBeNull()
    expect(report.repaired).toBe(1)
  })

  it('files a fixed cost without a category as uncategorized', () => {
    expect(oneRecurring({ categoryId: null }).item?.categoryId).toBe(UNCATEGORIZED_ID)
    expect(oneRecurring({ categoryId: 'cat-gone' }).item?.categoryId).toBe('cat-gone')
  })

  it('repairs order and createdAt', () => {
    const { data } = normalize(
      rawData({
        recurring: [
          rawRow(makeRecurring({ id: 'rec-a' }), { order: 'first', createdAt: -5 }),
          rawRow(makeRecurring({ id: 'rec-b' }), { order: Number.POSITIVE_INFINITY }),
        ],
      }),
    )
    expect(data.recurring.map(({ order }) => order)).toEqual([0, 1])
    expect(data.recurring[0]?.createdAt).toBe(NOW)
  })
})

describe('categories', () => {
  it.each(['pink', '', 'Blue', null, 3])('paints a category with the colour %j slate', (color) => {
    const { category, report } = oneCategory({ color })
    expect(category?.color).toBe('slate')
    expect(report.repaired).toBe(1)
  })

  it.each(['weekly', '', 'Both', null])('offers a category with the kind %j everywhere', (kind) => {
    expect(oneCategory({ kind }).category?.kind).toBe('both')
  })

  it.each([0, -1, 1.5, '5000', MAX_CENTS + 1, Number.NaN, undefined, false])('removes the limit %j', (budget) => {
    const { category, report } = oneCategory({ budget })
    expect(category?.budget).toBeNull()
    expect(report.repaired).toBe(1)
  })

  it.each([1, 50000, MAX_CENTS, null])('keeps the limit %j', (budget) => {
    const { category, report } = oneCategory({ budget })
    expect(category?.budget).toBe(budget)
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it.each(['not-an-icon', '', 'House', 'house ', 'ab', '1', '😀😀', '😀 x', ' ', 42, null, undefined])(
    'replaces the icon %j with circle',
    (icon) => {
      const { category, report } = oneCategory({ icon })
      expect(category?.icon).toBe('circle')
      expect(report.repaired).toBe(1)
    },
  )

  it.each([...CATEGORY_ICONS.map(({ key }) => key), '🍕', '👍🏽', '🇩🇪', '👩‍💻', '❤️‍🔥', '#️⃣', '€', '♥'])(
    'keeps the icon %s',
    (icon) => {
      const { category, report } = oneCategory({ icon })
      expect(category?.icon).toBe(icon)
      expect(report).toStrictEqual(CLEAN_REPORT)
    },
  )

  it.each(['yes', 1, null])('unarchives a category with archived %j', (archived) => {
    expect(oneCategory({ archived }).category?.archived).toBe(false)
  })

  it('orders categories with an invalid order by their position', () => {
    const { data } = normalize(
      rawData({
        categories: [
          rawRow(makeCategory('cat-a'), { order: 5 }),
          rawRow(makeCategory('cat-b'), { order: '1' }),
          rawRow(makeCategory('cat-c'), { order: Number.NaN }),
          rawRow(makeCategory('cat-d'), { order: -2.5 }),
        ],
      }),
    )
    expect(data.categories.map(({ order }) => order)).toEqual([5, 1, 2, -2.5])
  })

  it.each([undefined, 42, null, ['Books'], { name: 'Books' }])('drops a category with the name %j', (name) => {
    const { category, report } = oneCategory({ name })
    expect(category).toBeUndefined()
    expect(report.dropped).toEqual({ ...NO_DROPS, categories: 1 })
  })

  it('keeps a category whose name is empty, so its limit and history stay', () => {
    const { category, report } = oneCategory({ name: '   ' })
    expect(category?.name).toBe('')
    expect(report.dropped).toEqual(NO_DROPS)
  })
})

describe('quick adds', () => {
  it.each([
    ['label', undefined],
    ['label', 42],
    ['amount', 0],
    ['amount', 3.5],
    ['amount', MAX_CENTS + 1],
    ['amount', '350'],
    ['categoryId', undefined],
    ['categoryId', null],
    ['categoryId', 'a b'],
    ['categoryId', 'constructor'],
    ['categoryId', 7],
  ])('drops one with the %s %j', (field, value) => {
    const { quickAdd, report } = oneQuickAdd({ [field]: value })
    expect(quickAdd).toBeUndefined()
    expect(report.dropped).toEqual({ ...NO_DROPS, quickAdds: 1 })
  })

  it.each(['no-such-icon', '', 'ab', 5])('replaces the icon %j with circle', (icon) => {
    expect(oneQuickAdd({ icon }).quickAdd?.icon).toBe('circle')
  })

  it('keeps an emoji icon and references to missing or no categories', () => {
    expect(oneQuickAdd({ icon: '🥙' }).quickAdd?.icon).toBe('🥙')
    expect(oneQuickAdd({ categoryId: 'cat-gone' }).quickAdd?.categoryId).toBe('cat-gone')
    expect(oneQuickAdd({ categoryId: UNCATEGORIZED_ID }).quickAdd?.categoryId).toBe(UNCATEGORIZED_ID)
  })

  it('orders quick adds with an invalid order by their position', () => {
    const { data } = normalize(
      rawData({ quickAdds: [rawRow(makeQuickAdd({ id: 'qa-a' })), rawRow(makeQuickAdd({ id: 'qa-b' }), { order: null })] }),
    )
    expect(data.quickAdds.map(({ order }) => order)).toEqual([0, 1])
  })
})

describe('months and overrides', () => {
  it('keeps valid overrides and savings goals', () => {
    const months = {
      '2026-10': { overrides: { 'rec-1': { amount: 70000, paid: true } }, savingsGoal: 10000 },
      '2026-11': { overrides: { 'rec-1': { skipped: true } } },
      '2026-12': { savingsGoal: 0 },
    }
    const { data, report } = withMonths(months)
    expect(data.months).toEqual(months)
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it('drops overrides of unknown recurring items and counts them', () => {
    const { data, report } = withMonths({
      '2026-10': { overrides: { 'rec-1': { paid: true }, 'rec-gone': { paid: true }, 'rec-other': { skipped: true } } },
    })
    expect(data.months).toEqual({ '2026-10': { overrides: { 'rec-1': { paid: true } } } })
    expect(report.dropped).toEqual({ ...NO_DROPS, overrides: 2 })
  })

  it('drops the overrides of a dropped recurring item with it', () => {
    const { data, report } = normalize(
      rawData({
        recurring: [rawRow(makeRecurring(), { startMonth: 'soon' })],
        months: { '2026-10': { overrides: { 'rec-1': { paid: true } }, savingsGoal: 5000 } },
      }),
    )
    expect(data.months).toEqual({ '2026-10': { savingsGoal: 5000 } })
    expect(report.dropped).toEqual({ ...NO_DROPS, recurring: 1, overrides: 1 })
  })

  it.each([0, -5, 1.5, '900', MAX_CENTS + 1, null])('removes the override amount %j and keeps the rest', (amount) => {
    const { data, report } = withMonths({ '2026-10': { overrides: { 'rec-1': { amount, paid: true } } } })
    expect(data.months).toEqual({ '2026-10': { overrides: { 'rec-1': { paid: true } } } })
    expect(report.repaired).toBe(1)
  })

  it('removes skipped and paid unless they are true, then the empty override and period', () => {
    const { data, report } = withMonths({ '2026-10': { overrides: { 'rec-1': { skipped: false, paid: 'yes' } } } })
    expect(data.months).toEqual({})
    expect(report.dropped).toEqual(NO_DROPS)
    expect(report.repaired).toBeGreaterThanOrEqual(3)
  })

  it('keeps a period whose savings goal remains when its overrides go', () => {
    const { data } = withMonths({ '2026-10': { overrides: { 'rec-1': {} }, savingsGoal: 100 } })
    expect(data.months).toEqual({ '2026-10': { savingsGoal: 100 } })
  })

  it.each([true, 'paid', 1, null, ['paid']])('drops an override that is %j instead of an object', (override) => {
    const { data, report } = withMonths({ '2026-10': { overrides: { 'rec-1': override } } })
    expect(data.months).toEqual({})
    expect(report.dropped.overrides).toBe(1)
  })

  it('leaves out override fields it does not know', () => {
    const { data } = withMonths({ '2026-10': { overrides: { 'rec-1': { paid: true, note: 'cash' } } } })
    expect(data.months).toEqual({ '2026-10': { overrides: { 'rec-1': { paid: true } } } })
  })

  it.each(['2026-13', 'October', '2026-1', '', '2026-10-01', 'toString'])(
    'removes the period %j and counts the overrides it held as dropped',
    (key) => {
      const { data, report } = withMonths({ [key]: { overrides: { 'rec-1': { paid: true }, 'rec-x': { paid: true } } } })
      expect(data.months).toEqual({})
      expect(report.dropped.overrides).toBe(2)
    },
  )

  it('removes an invalid period without overrides as a repair', () => {
    const { data, report } = withMonths({ later: { savingsGoal: 100 }, '2026-10': 'nothing' })
    expect(data.months).toEqual({})
    expect(report.dropped).toEqual(NO_DROPS)
    expect(report.repaired).toBe(2)
  })

  it.each([
    [0, 0],
    [MAX_CENTS, MAX_CENTS],
    [-100, 0],
    [MAX_CENTS + 5, MAX_CENTS],
  ])('clamps the period savings goal %d to %d, like the settings goal', (savingsGoal, expected) => {
    expect(withMonths({ '2026-10': { savingsGoal } }).data.months['2026-10']).toEqual({ savingsGoal: expected })
  })

  it.each([1.5, '100', null, Number.NaN, undefined])('removes the period savings goal %j', (savingsGoal) => {
    const { data, report } = withMonths({ '2026-10': { savingsGoal } })
    expect(data.months).toEqual({})
    expect(report.repaired).toBe(2)
  })

  it.each([[[]], [null], ['months'], [5]])('replaces months %j with none', (months) => {
    const { data, report } = withMonths(months)
    expect(data.months).toEqual({})
    expect(report.repaired).toBe(1)
  })

  it('treats missing months as none', () => {
    const { data, report } = normalize(without(rawData(), 'months'))
    expect(data.months).toEqual({})
    expect(report.repaired).toBe(1)
  })

  it.each([[[]], ['all'], [null]])('removes overrides that are %j instead of a record', (overrides) => {
    const { data } = withMonths({ '2026-10': { overrides, savingsGoal: 500 } })
    expect(data.months).toEqual({ '2026-10': { savingsGoal: 500 } })
  })
})

describe('wallet (§4.8)', () => {
  it('keeps a valid wallet as it is', () => {
    const wallet = sampleData().wallet
    const { data, report } = normalize(rawData({ wallet: toRaw(wallet) }))
    expect(data.wallet).toStrictEqual(wallet)
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it.each([undefined, null, 'wallet', [], 5])('uses an empty wallet when the wallet is %j', (wallet) => {
    const raw = wallet === undefined ? without(rawData(), 'wallet') : rawData({ wallet })
    const { data, report } = normalize(raw)
    expect(data.wallet).toStrictEqual({ opening: 0, startMonth: null, entries: [], goals: [] })
    expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
  })

  it.each([
    [-100, 0],
    [MAX_CENTS + 5, MAX_CENTS],
    [1.5, 0],
    ['100', 0],
    [null, 0],
    [undefined, 0],
  ])('turns the opening balance %j into %d', (opening, expected) => {
    const { wallet, report } = walletWith({ opening })
    expect(wallet.opening).toBe(expected)
    expect(report.repaired).toBe(1)
  })

  it.each([0, 1, MAX_CENTS])('keeps the opening balance %d', (opening) => {
    expect(walletWith({ opening }).report).toStrictEqual(CLEAN_REPORT)
  })

  it.each(['2026-13', 'October', 202610, '2026-10-01', ''])('counts the wallet from the setup period when its start is %j', (startMonth) => {
    const { wallet, report } = walletWith({ startMonth })
    expect(wallet.startMonth).toBeNull()
    expect(report.repaired).toBe(1)
  })

  it.each(['2026-08', null])('keeps the start %j', (startMonth) => {
    const { wallet, report } = walletWith({ startMonth })
    expect(wallet.startMonth).toBe(startMonth)
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  describe('entries', () => {
    it.each([
      ['kind', 'Deposit'],
      ['kind', 'income'],
      ['kind', undefined],
      ['amount', 0],
      ['amount', -5000],
      ['amount', 50.5],
      ['amount', MAX_CENTS + 1],
      ['amount', '5000'],
      ['date', '2026-02-30'],
      ['date', '14.10.2026'],
      ['date', undefined],
    ])('drops one with the %s %j and counts it with the transactions', (field, value) => {
      const { entry, report } = oneEntry({ [field]: value })
      expect(entry).toBeUndefined()
      expect(report.dropped).toEqual({ ...NO_DROPS, transactions: 1 })
      expect(droppedCount(report)).toBe(1)
    })

    it('trims and cuts the note, and replaces an invalid id and creation time', () => {
      const { entry, report } = oneEntry({ id: 'a b', note: ` ${'n'.repeat(90)}`, createdAt: 'now' })
      expect(entry?.note).toBe('n'.repeat(80))
      expect(entry?.id).toMatch(ID_PATTERN)
      expect(entry?.createdAt).toBe(NOW)
      expect(report.repaired).toBe(3)
    })

    it.each([[{}], ['entries'], [null], [undefined]])('treats entries %j as none', (entries) => {
      const { wallet, report } = walletWith({ entries })
      expect(wallet.entries).toEqual([])
      expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
    })

    it('removes an exact copy and renames a different entry with a taken id', () => {
      const entry = rawEntry()
      const { wallet, report } = walletWith({ entries: [entry, { ...entry }, { ...entry, amount: 7000 }] })
      expect(wallet.entries.map(({ amount }) => amount)).toEqual([5000, 7000])
      expect(wallet.entries[1]?.id).not.toBe('wal-1')
      expect(report.repaired).toBe(2)
    })
  })

  describe('savings goals (§3.14)', () => {
    it('keeps active and done goals as they are', () => {
      const goals = sampleData().wallet.goals
      const { wallet, report } = walletWith({ goals: goals.map((goal) => toRaw(goal)) })
      expect(wallet.goals).toStrictEqual(goals)
      expect(report).toStrictEqual(CLEAN_REPORT)
    })

    it.each([[{}], ['goals'], [null], [5]])('treats goals %j as none, as one repair', (goals) => {
      const { wallet, report } = walletWith({ goals })
      expect(wallet.goals).toEqual([])
      expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
    })

    it('trims the name and cuts it to 24 characters, never splitting an emoji', () => {
      expect(oneGoal({ name: '  Trip home ' })).toEqual({
        goal: makeGoal({ name: 'Trip home' }),
        report: { ...CLEAN_REPORT, repaired: 1 },
      })
      expect(oneGoal({ name: 'x'.repeat(30) }).goal?.name).toBe('x'.repeat(24))
      expect(oneGoal({ name: '🚲'.repeat(25) }).goal?.name).toBe('🚲'.repeat(24))
      expect(oneGoal({ name: 'y'.repeat(24) }).report).toStrictEqual(CLEAN_REPORT)
    })

    it.each(['', '   ', 42, null, undefined, ['Laptop']])('drops a goal named %j and counts it as damaged', (name) => {
      const { goal, report } = oneGoal({ name })
      expect(goal).toBeUndefined()
      expect(report.dropped).toEqual({ ...NO_DROPS, transactions: 1 })
    })

    it.each([0, -1, 1.5, '120000', MAX_CENTS + 1, Number.NaN, null, undefined])(
      'drops a goal whose target is %j and counts it as damaged',
      (target) => {
        const { goal, report } = oneGoal({ target })
        expect(goal).toBeUndefined()
        expect(report.dropped).toEqual({ ...NO_DROPS, transactions: 1 })
      },
    )

    it.each([1, MAX_CENTS])('keeps the target %d', (target) => {
      const { goal, report } = oneGoal({ target })
      expect(goal?.target).toBe(target)
      expect(report).toStrictEqual(CLEAN_REPORT)
    })

    it.each(['not-an-icon', '', 'Laptop', 'ab', 5, null, undefined])('replaces the icon %j with circle', (icon) => {
      const { goal, report } = oneGoal({ icon })
      expect(goal?.icon).toBe('circle')
      expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
    })

    it.each(['laptop', 'piggy-bank', '🚲', '👩‍💻'])('keeps the icon %s', (icon) => {
      expect(oneGoal({ icon }).report).toStrictEqual(CLEAN_REPORT)
    })

    it('orders goals with an invalid order by their position', () => {
      const { wallet } = walletWith({
        goals: [
          rawRow(makeGoal({ id: 'goal-a', order: 5 })),
          rawRow(makeGoal({ id: 'goal-b' }), { order: '1' }),
          rawRow(makeGoal({ id: 'goal-c' }), { order: Number.NaN }),
          rawRow(makeGoal({ id: 'goal-d' }), { order: undefined }),
        ],
      })
      expect(wallet.goals.map(({ order }) => order)).toEqual([5, 1, 2, 3])
    })

    it.each([undefined, -1, 'today', Date.UTC(3000, 0, 1)])('uses now for the creation time %j', (createdAt) => {
      const { goal, report } = oneGoal({ createdAt })
      expect(goal?.createdAt).toBe(NOW)
      expect(report.repaired).toBe(1)
    })

    it.each([null, 0, NOW])('keeps the done time %j', (doneAt) => {
      const { goal, report } = oneGoal({ doneAt })
      expect(goal?.doneAt).toBe(doneAt)
      expect(report).toStrictEqual(CLEAN_REPORT)
    })

    it.each([undefined, true, 'yesterday', -1, 1.5, Date.UTC(3000, 0, 1)])('makes a goal done at %j active', (doneAt) => {
      const { goal, report } = oneGoal({ doneAt })
      expect(goal?.doneAt).toBeNull()
      expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
    })

    it.each(BAD_IDS)('gives a goal with the id %j a new valid one', (id) => {
      const { goal, report } = oneGoal({ id })
      expect(goal?.id).toMatch(ID_PATTERN)
      expect(goal?.id).not.toBe(id)
      expect(report).toStrictEqual({ ...CLEAN_REPORT, repaired: 1 })
    })

    it('removes an exact copy and renames a different goal with a taken id', () => {
      const goal = toRaw(makeGoal())
      const { wallet, report } = walletWith({ goals: [goal, { ...goal }, { ...goal, name: 'Phone' }] })
      expect(wallet.goals.map(({ name }) => name)).toEqual(['New laptop', 'Phone'])
      expect(wallet.goals[1]?.id).toMatch(ID_PATTERN)
      expect(wallet.goals[1]?.id).not.toBe('goal-1')
      expect(report.repaired).toBe(2)
    })

    it('removes a copy of a goal without an order, whose order comes from the first one’s position', () => {
      const goal = without(toRaw(makeGoal()), 'order')
      const { wallet, report } = walletWith({ goals: [toRaw(makeGoal({ id: 'goal-0' })), goal, { ...goal }] })
      expect(wallet.goals.map(({ id, order }) => [id, order])).toEqual([
        ['goal-0', 0],
        ['goal-1', 1],
      ])
      expect(report.repaired).toBe(3)
    })

    it('drops goals that are not objects, and keeps the rest in order', () => {
      const { wallet, report } = walletWith({
        goals: [null, rawRow(makeGoal({ id: 'goal-a' })), 'laptop', 7, [], rawRow(makeGoal({ id: 'goal-b' }))],
      })
      expect(wallet.goals.map(({ id }) => id)).toEqual(['goal-a', 'goal-b'])
      expect(report.dropped).toEqual({ ...NO_DROPS, transactions: 4 })
    })

    it('leaves out goal fields it does not know, without counting a repair', () => {
      const { goal, report } = oneGoal({ filled: 50000, balance: 3 })
      expect(goal).toStrictEqual(makeGoal())
      expect(report).toStrictEqual(CLEAN_REPORT)
    })
  })
})

describe('settings', () => {
  it.each([undefined, null, 'settings', [], 42])('uses the defaults when settings are %j', (settings) => {
    const { data, report } = normalize(rawData({ settings }))
    expect(data.settings).toEqual(createDefaultSettings(NOW))
    expect(report.repaired).toBe(1)
  })

  it.each<[keyof Settings, unknown, unknown]>([
    ['theme', 'blue', 'system'],
    ['theme', 'Dark', 'system'],
    ['accent', 'pink', 'navy'],
    ['showCents', 'yes', true],
    ['hideAmounts', 1, false],
    ['onboarded', null, false],
    ['lastBackupAt', -5, null],
    ['lastBackupAt', 'yesterday', null],
    ['lastBackupAt', 1.5, null],
    ['createdAt', 'x', NOW],
    ['createdAt', undefined, NOW],
    ['name', 7, ''],
    ['lastReviewedMonth', '2026-13', null],
    ['lastReviewedMonth', '2026-9', null],
    ['lastReviewedMonth', 'September', null],
    ['lastReviewedMonth', '2026-09-30', null],
    ['lastReviewedMonth', ' 2026-09', null],
    ['lastReviewedMonth', '1899-12', null],
    ['lastReviewedMonth', 202609, null],
    ['lastReviewedMonth', '', null],
    ['lastReviewedMonth', true, null],
    ['lastReviewedMonth', undefined, null],
  ])('replaces %s %j with %j, as one repair', (field, value, expected) => {
    const { settings, report } = settingsWith({ [field]: value })
    expect(settings[field]).toEqual(expected)
    expect(report.repaired).toBe(1)
  })

  it.each(['2026-09', '1900-01', '2999-12', null])('keeps the reviewed month %j (§3.15)', (lastReviewedMonth) => {
    const { settings, report } = settingsWith({ lastReviewedMonth })
    expect(settings.lastReviewedMonth).toBe(lastReviewedMonth)
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it('keeps the Owed to you card where it was put', () => {
    const { settings, report } = settingsWith({ homeCards: ['owed', 'equation', 'wallet'] })
    expect(settings.homeCards).toEqual(['owed', 'equation', 'wallet'])
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it('never adds cards to a saved Home layout, so a hidden card stays hidden', () => {
    const { settings, report } = settingsWith({ homeCards: ['equation', 'whereItWent', 'budgets', 'comingUp', 'trend', 'recent'] })
    expect(settings.homeCards).not.toContain('owed')
    expect(settings.homeCards).not.toContain('wallet')
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it.each([
    ['eur', 'EUR'],
    [' usd ', 'USD'],
  ])('repairs the currency %j to %s', (currency, expected) => {
    const { settings, report } = settingsWith({ currency })
    expect(settings.currency).toBe(expected)
    expect(report.repaired).toBe(1)
  })

  it.each(['EURO', 'E1R', 'EU', '', 5, null])('replaces the currency %j with the number format region currency', (currency) => {
    expect(settingsWith({ currency }).settings.currency).toBe('EUR')
    expect(settingsWith({ currency, locale: 'en-GB' }).settings.currency).toBe('GBP')
    expect(settingsWith({ currency, locale: 'de-CH' }).settings.currency).toBe('CHF')
  })

  it('keeps any currency code Intl can format', () => {
    const { settings, report } = settingsWith({ currency: 'MXN' })
    expect(settings.currency).toBe('MXN')
    expect(report).toStrictEqual(CLEAN_REPORT)
  })

  it('writes the locale in canonical form', () => {
    const { settings, report } = settingsWith({ locale: 'en-us' })
    expect(settings.locale).toBe('en-US')
    expect(report.repaired).toBe(1)
  })

  it.each(['', 'not a locale', 'en_US', 5, null, undefined])('replaces the locale %j with de-DE', (locale) => {
    const { settings } = settingsWith({ locale })
    expect(settings.locale).toBe('de-DE')
  })

  it('keeps every locale Intl supports, not only the offered ones', () => {
    expect(settingsWith({ locale: 'ja-JP', currency: 'JPY' }).report).toStrictEqual(CLEAN_REPORT)
  })

  describe('where the engine lacks the locale data of an offered format', () => {
    it.each(CURRENCIES.map(({ code }) => code))('keeps the saved format sq-AL, here with %s', (currency) => {
      withoutAlbanianLocaleData()
      expect(Intl.NumberFormat.supportedLocalesOf(['sq-AL'])).toEqual([])
      const initial = createInitialData(NOW, 'sq-AL', 'Europe/Berlin')
      const { data, report } = normalize(toRaw({ ...initial, settings: { ...initial.settings, currency } }))
      expect(data.settings.locale).toBe('sq-AL')
      expect(data.settings.currency).toBe(currency)
      expect(report).toStrictEqual(CLEAN_REPORT)
    })

    it('writes an offered format in its listed form', () => {
      withoutAlbanianLocaleData()
      const { settings, report } = settingsWith({ locale: 'SQ-al' })
      expect(settings.locale).toBe('sq-AL')
      expect(report.repaired).toBe(1)
    })

    it('still replaces a format that is neither offered nor supported', () => {
      withoutAlbanianLocaleData()
      // Albanian as written in Kosovo: valid, but not offered and, here, not supported.
      const { settings, report } = settingsWith({ locale: 'sq-XK' })
      expect(settings.locale).toBe('de-DE')
      expect(report.repaired).toBe(1)
    })
  })

  it('keeps valid Home cards in their order, without duplicates or unknown keys', () => {
    const { settings, report } = settingsWith({ homeCards: ['recent', 'nope', 'equation', 'recent', 7, 'trend'] })
    expect(settings.homeCards).toEqual(['recent', 'equation', 'trend'])
    expect(report.repaired).toBe(1)
  })

  it('keeps an empty Home layout', () => {
    expect(settingsWith({ homeCards: [] }).settings.homeCards).toEqual([])
  })

  it.each(['equation', null, { equation: true }])('shows every card when homeCards is %j', (homeCards) => {
    expect(settingsWith({ homeCards }).settings.homeCards).toEqual(HOME_CARDS.map(({ key }) => key))
  })

  it.each([
    [0, 1],
    [-3, 1],
    [29, 28],
    [31, 28],
    [12.6, 13],
    ['15', 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
    [null, 1],
  ])('turns the month start day %j into %d', (monthStartDay, expected) => {
    const { settings, report } = settingsWith({ monthStartDay })
    expect(settings.monthStartDay).toBe(expected)
    expect(report.repaired).toBe(1)
  })

  it.each([1, 15, 28])('keeps the month start day %d', (monthStartDay) => {
    expect(settingsWith({ monthStartDay }).report).toStrictEqual(CLEAN_REPORT)
  })

  it.each([
    [-100, 0],
    [MAX_CENTS + 5, MAX_CENTS],
    [1.5, 0],
    ['100', 0],
    [null, 0],
  ])('turns the savings goal %j into %d', (savingsGoal, expected) => {
    const { settings, report } = settingsWith({ savingsGoal })
    expect(settings.savingsGoal).toBe(expected)
    expect(report.repaired).toBe(1)
  })

  it.each([0, 20000, MAX_CENTS])('keeps the savings goal %d', (savingsGoal) => {
    expect(settingsWith({ savingsGoal }).report).toStrictEqual(CLEAN_REPORT)
  })

  it.each([
    ['', ''],
    ['🦊', '🦊'],
    ['👩‍💻', '👩‍💻'],
    [' 🦊 ', '🦊'],
    ['ab', ''],
    ['A', ''],
    ['🦊🦊', ''],
    [5, ''],
    [null, ''],
  ])('turns the avatar %j into %j', (avatar, expected) => {
    expect(settingsWith({ avatar }).settings.avatar).toBe(expected)
  })
})

describe('hostile input', () => {
  it('ignores __proto__ keys from JSON at every level and leaves Object.prototype alone', () => {
    const json = JSON.stringify(rawData({ recurring: [toRaw(makeRecurring())] }))
      .replace('"settings":{', '"settings":{"__proto__":{"theme":"dark","polluted":true},')
      .replace('"transactions":[]', '"transactions":[{"__proto__":{"kind":"expense","amount":350,"date":"2026-10-14"}}]')
      .replace('"months":{}', '"months":{"__proto__":{"savingsGoal":5},"2026-10":{"overrides":{"__proto__":{"paid":true},"rec-1":{"paid":true}}}}')
    const raw = JSON.parse(json) as Raw
    // The keys are really there, as own data properties.
    expect(Object.hasOwn(raw.settings as Raw, '__proto__')).toBe(true)
    expect(Object.hasOwn((raw.transactions as Raw[])[0] ?? {}, '__proto__')).toBe(true)
    expect(Object.hasOwn(raw.months as Raw, '__proto__')).toBe(true)
    const { data, report } = normalize(raw)
    expect(data.settings.theme).toBe('system')
    expect(data.transactions).toEqual([])
    expect(data.months).toEqual({ '2026-10': { overrides: { 'rec-1': { paid: true } } } })
    expect(Object.hasOwn(data.months, '__proto__')).toBe(false)
    expect(report.dropped).toEqual({ ...NO_DROPS, transactions: 1, overrides: 1 })
    expect(Object.getOwnPropertyNames(Object.prototype).toSorted()).toEqual(PROTOTYPE_NAMES)
    expect(({} as Raw).polluted).toBeUndefined()
  })

  it('ignores inherited fields', () => {
    const settings = Object.create({ theme: 'dark', name: 'Mallory' }) as Raw
    const tx = Object.create(toRaw(makeTransaction())) as Raw
    const { data, report } = normalize(rawData({ settings, transactions: [tx] }))
    expect([data.settings.theme, data.settings.name]).toEqual(['system', ''])
    expect(report.dropped.transactions).toBe(1)
  })

  it('never uses names of Object.prototype members as ids, so overrides cannot reach them', () => {
    const { data, report } = normalize(
      rawData({
        recurring: [rawRow(makeRecurring(), { id: 'constructor' })],
        months: { '2026-10': { overrides: { constructor: { paid: true } } } },
      }),
    )
    expect(data.recurring[0]?.id).not.toBe('constructor')
    expect(data.months).toEqual({})
    expect(report.dropped.overrides).toBe(1)
  })

  it('survives deeply nested values without overflowing the stack', () => {
    let deep: unknown = 'bottom'
    for (let i = 0; i < 100_000; i += 1) deep = [deep]
    const raw = rawData({
      transactions: [rawRow(makeTransaction(), { note: deep })],
      recurring: [rawRow(makeRecurring(), { amounts: deep })],
    })
    ;(raw.settings as Raw).homeCards = [deep]
    const { data, report } = normalize(raw)
    expect(data.transactions[0]?.note).toBe('')
    expect(data.settings.homeCards).toEqual([])
    expect(report.dropped.recurring).toBe(1)
  })

  it('accepts objects without a prototype', () => {
    const tx = Object.assign(Object.create(null) as Raw, toRaw(makeTransaction()))
    const { data } = normalize(rawData({ transactions: [tx] }))
    expect(data.transactions).toEqual([makeTransaction()])
  })

  it('ignores __proto__ keys from JSON in splits, goals and the wallet', () => {
    const tx = toRaw(makeTransaction({ amount: 1000, splits: [makeSplit()] }))
    const json = JSON.stringify(rawData({ transactions: [tx], wallet: toRaw(sampleData().wallet) }))
      .replace('"splits":[', '"splits":[{"__proto__":{"person":"Mallory","amount":100}},')
      .replace('"goals":[', '"goals":[{"__proto__":{"name":"Mallory","target":100}},')
      .replace('"wallet":{', '"wallet":{"__proto__":{"polluted":true},')
    const raw = JSON.parse(json) as Raw
    expect(Object.hasOwn(recordAt(raw, 'transactions', 0, 'splits', 0), '__proto__')).toBe(true)
    expect(Object.hasOwn(recordAt(raw, 'wallet', 'goals', 0), '__proto__')).toBe(true)
    const { data, report } = normalize(raw)
    expect(data.transactions[0]?.splits).toStrictEqual([makeSplit()])
    expect(data.wallet).toStrictEqual(sampleData().wallet)
    expect(report).toStrictEqual({ ...CLEAN_REPORT, dropped: { ...NO_DROPS, transactions: 1 }, repaired: 1 })
    expect(Object.getOwnPropertyNames(Object.prototype).toSorted()).toEqual(PROTOTYPE_NAMES)
    expect(({} as Raw).polluted).toBeUndefined()
  })

  it('never takes names of Object.prototype members as split or goal ids', () => {
    const { split } = oneSplit({ id: 'hasOwnProperty' })
    const { goal } = oneGoal({ id: 'toString' })
    expect(split?.id).not.toBe('hasOwnProperty')
    expect(goal?.id).not.toBe('toString')
  })

  it('survives deeply nested splits and goals without overflowing the stack', () => {
    let deep: unknown = 'bottom'
    for (let i = 0; i < 100_000; i += 1) deep = [deep]
    const raw = rawData({
      transactions: [rawRow(makeTransaction(), { splits: deep }), rawRow(makeTransaction({ id: 'tx-2' }), { splits: [rawSplit({ person: deep })] })],
    })
    raw.wallet = { ...recordAt(raw, 'wallet'), goals: deep, entries: [deep] }
    const { data, report } = normalize(raw)
    expect(data.transactions.map(({ splits }) => splits)).toEqual([[], []])
    expect(data.wallet.goals).toEqual([])
    expect(report.dropped).toEqual({ ...NO_DROPS, transactions: 2 })
  })
})

// ---------------------------------------------------------------------------------------------
// Fuzzing: random JSON-like values, from a seeded generator so every failure can be replayed.

type Random = () => number

/** Mulberry32, a small seeded generator. */
function seeded(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(random: Random, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)] as T
}

/** Field names, ids, keys and values the data uses, mixed with near misses and hostile names. */
const FUZZ_STRINGS = [
  '',
  ' ',
  'x',
  'expense',
  'income',
  'fixed',
  'daily',
  'both',
  'blue',
  'slate',
  'royal',
  'dark',
  'system',
  'EUR',
  'eur',
  'JPY',
  'de-DE',
  'en-us',
  'not a locale',
  '2026-10',
  '2026-13',
  '2026-10-14',
  '2026-02-30',
  'cat-rent',
  'cat-coffee',
  'rec-1',
  'tx-1',
  UNCATEGORIZED_ID,
  '__proto__',
  'constructor',
  'toString',
  'house',
  'coffee',
  '🍕',
  '👩‍💻',
  '😀😀',
  'equation',
  'recent',
  'owed',
  'wallet',
  'open',
  'paid',
  'forgiven',
  'deposit',
  'withdrawal',
  'Mia',
  'laptop',
  'split-1',
  'goal-1',
  'a'.repeat(100),
  ' padded ',
  '=SUM(A1)',
  '"quoted"',
  '\n',
  '\u0000',
]

const FUZZ_NUMBERS = [
  0,
  -0,
  1,
  -1,
  1.5,
  2,
  3,
  6,
  12,
  28,
  29,
  31,
  32,
  350,
  MAX_CENTS,
  MAX_CENTS + 1,
  2 ** 53,
  -(2 ** 53),
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  NOW,
  Date.UTC(3000, 0, 1),
]

const FUZZ_KEYS = [
  'schemaVersion',
  'settings',
  'categories',
  'recurring',
  'transactions',
  'quickAdds',
  'months',
  'id',
  'name',
  'kind',
  'amount',
  'amounts',
  'from',
  'categoryId',
  'date',
  'note',
  'label',
  'icon',
  'color',
  'budget',
  'order',
  'archived',
  'startMonth',
  'endMonth',
  'everyMonths',
  'spread',
  'dueDay',
  'createdAt',
  'updatedAt',
  'overrides',
  'savingsGoal',
  'skipped',
  'paid',
  'currency',
  'locale',
  'homeCards',
  'theme',
  'avatar',
  'lastReviewedMonth',
  'fromWallet',
  'splits',
  'person',
  'status',
  'settledAt',
  'wallet',
  'opening',
  'entries',
  'goals',
  'target',
  'doneAt',
  '2026-10',
  'rec-1',
  '__proto__',
  'constructor',
  'extra',
]

/** Sets an own enumerable property even for '__proto__', as JSON.parse does. */
function setOwn(record: Raw, key: string, value: unknown): void {
  Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true })
}

function randomPrimitive(random: Random): unknown {
  const roll = random()
  if (roll < 0.08) return undefined
  if (roll < 0.16) return null
  if (roll < 0.26) return random() < 0.5
  if (roll < 0.58) return pick(random, FUZZ_NUMBERS)
  return pick(random, FUZZ_STRINGS)
}

/** A random JSON-like value: primitives, arrays and records with keys the data uses, 4 levels deep. */
function randomValue(random: Random, depth = 0): unknown {
  const roll = random()
  if (depth >= 4 || roll < 0.5) return randomPrimitive(random)
  if (roll < 0.72) return Array.from({ length: Math.floor(random() * 5) }, () => randomValue(random, depth + 1))
  const record: Raw = {}
  const size = Math.floor(random() * 6)
  for (let i = 0; i < size; i += 1) setOwn(record, pick(random, FUZZ_KEYS), randomValue(random, depth + 1))
  return record
}

/** Where a value sits in a tree: its parent and key. */
interface Slot {
  parent: Raw | unknown[]
  key: string | number
}

/** Every slot below `value`. */
function slotsOf(value: unknown, slots: Slot[] = []): Slot[] {
  if (Array.isArray(value)) {
    value.forEach((item: unknown, key) => {
      slots.push({ parent: value, key })
      slotsOf(item, slots)
    })
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Raw
    for (const key of Object.keys(record)) {
      slots.push({ parent: record, key })
      slotsOf(record[key], slots)
    }
  }
  return slots
}

/** Replaces, deletes or duplicates one random node of `raw`, or adds a random key to it. */
function mutate(raw: Raw, random: Random): void {
  const slots = slotsOf(raw)
  const slot = pick(random, slots)
  const roll = random()
  if (Array.isArray(slot.parent)) {
    const list = slot.parent
    const index = slot.key as number
    if (roll < 0.55) list[index] = randomValue(random)
    else if (roll < 0.8) list.splice(index, 1)
    else list.push(list[index])
  } else {
    const record = slot.parent
    const key = slot.key as string
    if (roll < 0.55) setOwn(record, key, randomValue(random))
    else if (roll < 0.85) delete record[key]
    else setOwn(record, pick(random, FUZZ_KEYS), randomValue(random))
  }
}

/** True when `raw` has what every load needs: schema 1 and the four top-level arrays. */
function isLoadable(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const record = raw as Raw
  return (
    Object.hasOwn(record, 'schemaVersion') &&
    record.schemaVersion === 1 &&
    ['categories', 'recurring', 'transactions', 'quickAdds'].every(
      (key) => Object.hasOwn(record, key) && Array.isArray(record[key]),
    )
  )
}

/** What normalising fuzzed input gave. */
interface FuzzOutcome {
  /** Broken promises: invariants the data violates, or a refusal that should not have happened. */
  problems: string[]
  /** The first result as normalising it again must give it back: the same data, a clean report. */
  expected: Result | null
  /** What normalising the first result's data again gave. */
  again: Result | null
}

/**
 * Normalises fuzzed input. Loadable input must come back as valid data that normalises to itself
 * with a clean report; anything else must be refused with a DataError, never another error.
 */
function fuzz(raw: unknown, label: string): FuzzOutcome {
  const loadable = isLoadable(raw)
  let first: Result
  try {
    first = normalizeAppData(raw, NOW)
  } catch (error) {
    const refusedRightly = !loadable && error instanceof DataError
    return { problems: refusedRightly ? [] : [`${label}: threw ${String(error)}`], expected: null, again: null }
  }
  if (!loadable) return { problems: [`${label}: accepted input it must refuse`], expected: null, again: null }
  return {
    problems: appDataProblems(first.data).map((problem) => `${label}: ${problem}`),
    expected: { data: first.data, report: CLEAN_REPORT },
    again: normalizeAppData(first.data, NOW + 1),
  }
}

/**
 * Each fuzz test normalises hundreds of inputs twice and checks every invariant, which takes a few
 * seconds, more while other test files run in parallel; the default 5 s would make them flaky.
 */
const FUZZ_TIMEOUT_MS = 30_000

describe('fuzzing', () => {
  it('refuses random top-level values with DataError, or repairs them', { timeout: FUZZ_TIMEOUT_MS }, () => {
    const random = seeded(1)
    for (let i = 0; i < 300; i += 1) {
      const raw =
        random() < 0.5
          ? randomValue(random)
          : { schemaVersion: pick(random, [1, 1, 0, 2, '1']), ...(randomValue(random, 1) as object) }
      const { problems, expected, again } = fuzz(raw, `case ${i}`)
      expect(problems).toEqual([])
      expect(again).toStrictEqual(expected)
    }
  })

  it('repairs random garbage inside a valid skeleton into valid, idempotent data', { timeout: FUZZ_TIMEOUT_MS }, () => {
    const random = seeded(2)
    const rows = (): unknown[] => Array.from({ length: Math.floor(random() * 6) }, () => randomValue(random, 1))
    for (let i = 0; i < 300; i += 1) {
      const raw: Raw = {
        schemaVersion: 1,
        settings: randomValue(random, 1),
        categories: rows(),
        recurring: rows(),
        transactions: rows(),
        quickAdds: rows(),
        months: randomValue(random, 1),
        wallet: randomValue(random, 1),
      }
      const { problems, expected, again } = fuzz(raw, `case ${i}`)
      expect(problems).toEqual([])
      expect(again).not.toBeNull()
      expect(again).toStrictEqual(expected)
    }
  })

  it('repairs random damage to realistic data into valid, idempotent data', { timeout: FUZZ_TIMEOUT_MS }, () => {
    const random = seeded(3)
    for (let i = 0; i < 500; i += 1) {
      const raw = toRaw(sampleData())
      const mutations = 1 + Math.floor(random() * 8)
      for (let m = 0; m < mutations; m += 1) mutate(raw, random)
      const { problems, expected, again } = fuzz(raw, `case ${i}`)
      expect(problems).toEqual([])
      expect(again).toStrictEqual(expected)
    }
  })

  it('repairs random splits and goals into valid, idempotent data', { timeout: FUZZ_TIMEOUT_MS }, () => {
    const random = seeded(4)
    const kept = { splits: 0, goals: 0 }
    /** A split that is valid, slightly off or garbage, with ids that often collide. */
    const randomSplit = (): unknown => {
      if (random() < 0.15) return randomValue(random, 2)
      const split = rawSplit({
        id: pick(random, ['s1', 's2', 's3', 'bad id', '__proto__']),
        person: pick(random, ['Mia', ' Mia ', 'Jonas', '', '   ', 'x'.repeat(30)]),
        amount: pick(random, [1, 100, 350, 999, 1000, 5000, MAX_CENTS]),
        status: pick(random, ['open', 'paid', 'forgiven', 'settled']),
        settledAt: pick(random, [null, NOW, -1]),
      })
      if (random() < 0.3) mutate(split, random)
      return split
    }
    /** A goal that is valid, slightly off or garbage, with ids that often collide. */
    const randomGoal = (): unknown => {
      if (random() < 0.15) return randomValue(random, 2)
      const goal = rawRow(makeGoal(), {
        id: pick(random, ['goal-1', 'goal-2', 'bad id']),
        name: pick(random, ['Laptop', ' Trip ', '', 'y'.repeat(30)]),
        target: pick(random, [1, 30000, MAX_CENTS, 0]),
        order: pick(random, [0, 1, undefined]),
        doneAt: pick(random, [null, NOW, 'done']),
      })
      if (random() < 0.3) mutate(goal, random)
      return goal
    }
    for (let i = 0; i < 300; i += 1) {
      const transactions = Array.from({ length: Math.floor(random() * 5) }, () =>
        rawRow(makeTransaction({ id: pick(random, ['tx-1', 'tx-2', 'tx-3']) }), {
          kind: pick(random, ['expense', 'expense', 'income']),
          amount: pick(random, [350, 1000, 5000]),
          fromWallet: pick(random, [true, false, 'yes', undefined]),
          splits: random() < 0.1 ? randomValue(random, 2) : Array.from({ length: Math.floor(random() * 5) }, randomSplit),
        }),
      )
      // Copies of whole transactions, as a sync gone wrong would leave them.
      if (transactions.length > 0 && random() < 0.3) transactions.push(toRaw(pick(random, transactions)))
      const goals = random() < 0.1 ? randomValue(random, 2) : Array.from({ length: Math.floor(random() * 5) }, randomGoal)
      const raw = rawData({ transactions, wallet: { opening: 0, startMonth: null, entries: [], goals } })
      const { problems, expected, again } = fuzz(raw, `case ${i}`)
      expect(problems).toEqual([])
      expect(again).toStrictEqual(expected)
      for (const tx of expected?.data.transactions ?? []) kept.splits += tx.splits.length
      kept.goals += expected?.data.wallet.goals.length ?? 0
    }
    // The generator mixes in enough valid rows that the repairs are not all there is to see.
    expect(kept.splits).toBeGreaterThan(100)
    expect(kept.goals).toBeGreaterThan(100)
  })

  it('leaves Object.prototype untouched', () => {
    expect(Object.getOwnPropertyNames(Object.prototype).toSorted()).toEqual(PROTOTYPE_NAMES)
    expect(Object.keys(Object.prototype)).toEqual([])
  })
})

describe('droppedCount', () => {
  it('adds up every dropped row', () => {
    const report: NormalizeReport = {
      migratedFrom: null,
      dropped: { transactions: 1, recurring: 2, categories: 3, quickAdds: 4, overrides: 5 },
      repaired: 100,
    }
    expect(droppedCount(report)).toBe(15)
  })

  it('is 0 for clean data, however much was repaired', () => {
    expect(droppedCount(CLEAN_REPORT)).toBe(0)
    expect(droppedCount({ ...CLEAN_REPORT, repaired: 7, migratedFrom: 0 })).toBe(0)
  })

  it('counts what one load dropped', () => {
    const { report } = normalize(
      rawData({
        transactions: [null, rawRow(makeTransaction(), { amount: 0 })],
        categories: [{}],
        months: { nope: { overrides: { a: {}, b: {} } } },
      }),
    )
    expect(droppedCount(report)).toBe(5)
  })
})
