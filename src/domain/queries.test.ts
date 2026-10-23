import { afterEach, describe, expect, it, vi } from 'vitest'
import { CATEGORY_COLORS, CATEGORY_ICONS } from '@/domain/catalog'
import { BEFORE_APP_NOTE } from '@/domain/constants'
import { createDefaultCategories, DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import {
  categoryDisplay,
  categoryUsage,
  firstPeriod,
  isEmoji,
  isIconKey,
  isIconRef,
  lastUsedCategoryId,
  needsBackupReminder,
  nextFreeCategoryColor,
  sortedCategories,
  splitGraphemes,
  UNCATEGORIZED_DISPLAY,
} from '@/domain/queries'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import {
  INSTALLED_AT,
  makeCategory,
  makeData,
  makeQuickAdd,
  makeRecurring,
  makeTransaction,
  NOW,
  sampleData,
  TODAY,
} from '@/domain/test-helpers/dataFixtures'
import type { AppData, Category, CategoryColor, Transaction } from '@/domain/types'

const MS_PER_DAY = 86_400_000

/** First-run data with these transactions. */
function withTransactions(...transactions: Transaction[]): AppData {
  return makeData({ transactions })
}

/** Categories that use these colours, in this order. */
function coloured(...colors: CategoryColor[]): Category[] {
  return colors.map((color, i) => makeCategory(`cat-${i}`, { color, order: i }))
}

/** The ids of `list`, in order. */
function ids(list: readonly Category[]): string[] {
  return list.map(({ id }) => id)
}

/** First-run data with `count` transactions, `recurring` recurring items and the last backup time. */
function dataWith(count: number, recurring = 0, lastBackupAt: number | null = null): AppData {
  const base = makeData()
  return {
    ...base,
    settings: { ...base.settings, lastBackupAt },
    transactions: Array.from({ length: count }, (_, i) => makeTransaction({ id: `tx-${i}` })),
    recurring: Array.from({ length: recurring }, (_, i) => makeRecurring({ id: `rec-${i}` })),
  }
}

/** First-run data installed at `createdAt`, with months starting on `startDay`. */
function installed(createdAt: number, startDay = 1, patch: Partial<AppData> = {}): AppData {
  const base = makeData(patch)
  return { ...base, settings: { ...base.settings, createdAt, monthStartDay: startDay } }
}

describe('categoryUsage', () => {
  it('counts the transactions, recurring items and quick adds that use a category', () => {
    const data = sampleData()
    expect(categoryUsage(data, DEFAULT_CATEGORY_IDS.coffee)).toEqual({ transactions: 1, recurring: 0, quickAdds: 2 })
    expect(categoryUsage(data, DEFAULT_CATEGORY_IDS.rent)).toEqual({ transactions: 0, recurring: 1, quickAdds: 0 })
    expect(categoryUsage(data, DEFAULT_CATEGORY_IDS.other)).toEqual({ transactions: 1, recurring: 1, quickAdds: 0 })
    expect(categoryUsage(data, DEFAULT_CATEGORY_IDS.eating)).toEqual({ transactions: 1, recurring: 0, quickAdds: 2 })
  })

  it('counts nothing for an unused or unknown category', () => {
    const data = sampleData()
    const none = { transactions: 0, recurring: 0, quickAdds: 0 }
    expect(categoryUsage(data, DEFAULT_CATEGORY_IDS.health)).toEqual(none)
    expect(categoryUsage(data, 'cat-unknown')).toEqual(none)
  })

  it('counts uncategorized expenses under UNCATEGORIZED_ID', () => {
    expect(categoryUsage(sampleData(), UNCATEGORIZED_ID).transactions).toBe(1)
  })

  it('never counts income, which has no category', () => {
    const data = withTransactions(makeTransaction({ kind: 'income' }), makeTransaction({ id: 'tx-2' }))
    expect(categoryUsage(data, DEFAULT_CATEGORY_IDS.coffee).transactions).toBe(1)
  })
})

describe('sortedCategories', () => {
  const categories = [
    makeCategory('c-daily', { kind: 'daily', order: 2 }),
    makeCategory('c-fixed', { kind: 'fixed', order: 0 }),
    makeCategory('c-archived', { kind: 'both', order: 1, archived: true }),
    makeCategory('c-both', { kind: 'both', order: 3 }),
  ]

  it('sorts by order and leaves archived categories out', () => {
    expect(ids(sortedCategories(categories))).toEqual(['c-fixed', 'c-daily', 'c-both'])
  })

  it('includes archived categories when asked', () => {
    expect(ids(sortedCategories(categories, { includeArchived: true }))).toEqual(['c-fixed', 'c-archived', 'c-daily', 'c-both'])
  })

  it("keeps the asked kind and 'both'", () => {
    expect(ids(sortedCategories(categories, { kind: 'fixed' }))).toEqual(['c-fixed', 'c-both'])
    expect(ids(sortedCategories(categories, { kind: 'daily' }))).toEqual(['c-daily', 'c-both'])
    expect(ids(sortedCategories(categories, { kind: 'daily', includeArchived: true }))).toEqual([
      'c-archived',
      'c-daily',
      'c-both',
    ])
  })

  it('returns the existing objects in a new array and leaves the input alone', () => {
    const before = [...categories]
    const sorted = sortedCategories(categories)
    expect(sorted).not.toBe(categories)
    expect(sorted[0]).toBe(categories[1])
    expect(categories).toEqual(before)
  })

  it('keeps the list order of categories with the same order', () => {
    const tied = [makeCategory('b', { order: 1 }), makeCategory('a', { order: 1 }), makeCategory('c', { order: 0 })]
    expect(ids(sortedCategories(tied))).toEqual(['c', 'b', 'a'])
  })

  it('lists the defaults in their default order', () => {
    const defaults = createDefaultCategories()
    expect(ids(sortedCategories(defaults.toReversed()))).toEqual(ids(defaults))
  })
})

describe('categoryDisplay', () => {
  const groceries = makeCategory('cat-groceries', { name: 'Groceries', icon: 'shopping-cart', color: 'green' })
  const old = makeCategory('cat-old', { name: 'Old', archived: true })
  const map: Readonly<Record<string, Category>> = { [groceries.id]: groceries, [old.id]: old }

  it('shows the category itself, archived ones too', () => {
    expect(categoryDisplay('cat-groceries', map)).toBe(groceries)
    expect(categoryDisplay('cat-groceries', map)).toMatchObject({ name: 'Groceries', icon: 'shopping-cart', color: 'green' })
    expect(categoryDisplay('cat-old', map)).toBe(old)
  })

  it.each([null, 'cat-gone', UNCATEGORIZED_ID, 'constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'shows %j as Uncategorized',
    (id) => {
      expect(categoryDisplay(id, map)).toBe(UNCATEGORIZED_DISPLAY)
    },
  )

  it('works with a map that has no prototype', () => {
    const bare = Object.assign(Object.create(null) as Record<string, Category>, map)
    expect(categoryDisplay('cat-groceries', bare)).toBe(groceries)
    expect(categoryDisplay('cat-gone', bare)).toBe(UNCATEGORIZED_DISPLAY)
  })
})

describe('UNCATEGORIZED_DISPLAY', () => {
  it('is "Uncategorized" with the question icon and no colour, and cannot change', () => {
    expect(UNCATEGORIZED_DISPLAY).toEqual({ name: 'Uncategorized', icon: 'question', color: null })
    expect(Object.isFrozen(UNCATEGORIZED_DISPLAY)).toBe(true)
    expect(isIconKey(UNCATEGORIZED_DISPLAY.icon)).toBe(true)
  })
})

describe('lastUsedCategoryId', () => {
  it('returns the category of the most recently created expense', () => {
    expect(lastUsedCategoryId(sampleData())).toBe(DEFAULT_CATEGORY_IDS.coffee)
  })

  it('goes by creation time, not by list order or date', () => {
    const data = withTransactions(
      makeTransaction({ id: 'tx-new', categoryId: 'cat-eating', date: '2026-10-01', createdAt: NOW }),
      makeTransaction({ id: 'tx-old', categoryId: 'cat-groceries', date: '2026-10-14', createdAt: NOW - 1 }),
    )
    expect(lastUsedCategoryId(data)).toBe('cat-eating')
  })

  it('takes the later one in the list when two were created in the same millisecond', () => {
    const data = withTransactions(
      makeTransaction({ id: 'tx-1', categoryId: 'cat-eating' }),
      makeTransaction({ id: 'tx-2', categoryId: 'cat-groceries' }),
    )
    expect(lastUsedCategoryId(data)).toBe('cat-groceries')
  })

  it('skips income, the onboarding entry, archived, unknown and no categories', () => {
    const base = makeData()
    const data: AppData = {
      ...base,
      categories: base.categories.map((category) =>
        category.id === 'cat-shopping' ? { ...category, archived: true } : category,
      ),
      transactions: [
        makeTransaction({ id: 'tx-1', categoryId: 'cat-health', createdAt: NOW - 10 }),
        makeTransaction({ id: 'tx-2', kind: 'income', categoryId: null, createdAt: NOW }),
        makeTransaction({ id: 'tx-3', categoryId: 'cat-other', note: BEFORE_APP_NOTE, createdAt: NOW + 1 }),
        makeTransaction({ id: 'tx-4', categoryId: 'cat-shopping', createdAt: NOW + 2 }),
        makeTransaction({ id: 'tx-5', categoryId: 'cat-deleted', createdAt: NOW + 3 }),
        makeTransaction({ id: 'tx-6', categoryId: UNCATEGORIZED_ID, createdAt: NOW + 4 }),
      ],
    }
    expect(lastUsedCategoryId(data)).toBe('cat-health')
  })

  it('counts a note that only resembles the onboarding entry', () => {
    const data = withTransactions(makeTransaction({ categoryId: 'cat-eating', note: `${BEFORE_APP_NOTE} 2` }))
    expect(lastUsedCategoryId(data)).toBe('cat-eating')
  })

  it('returns null without usable expenses', () => {
    expect(lastUsedCategoryId(makeData())).toBeNull()
    expect(lastUsedCategoryId(withTransactions(makeTransaction({ kind: 'income', categoryId: null })))).toBeNull()
  })
})

describe('needsBackupReminder', () => {
  const longAfter = INSTALLED_AT + 365 * MS_PER_DAY

  it('waits until there are 10 transactions and recurring items together', () => {
    expect(needsBackupReminder(dataWith(9), longAfter)).toBe(false)
    expect(needsBackupReminder(dataWith(5, 4), longAfter)).toBe(false)
    expect(needsBackupReminder(dataWith(10), longAfter)).toBe(true)
    expect(needsBackupReminder(dataWith(6, 4), longAfter)).toBe(true)
    expect(needsBackupReminder(dataWith(0, 10), longAfter)).toBe(true)
  })

  it('does not count quick adds or categories', () => {
    const base = dataWith(9)
    const data = { ...base, quickAdds: [...base.quickAdds, makeQuickAdd({ id: 'qa-x' })] }
    expect(needsBackupReminder(data, longAfter)).toBe(false)
  })

  it('reminds more than 7 days after the install when there was never a backup', () => {
    const sevenDays = INSTALLED_AT + 7 * MS_PER_DAY
    expect(needsBackupReminder(dataWith(10), sevenDays)).toBe(false)
    expect(needsBackupReminder(dataWith(10), sevenDays + 1)).toBe(true)
  })

  it('reminds more than 30 days after the last backup', () => {
    const backup = INSTALLED_AT + 100 * MS_PER_DAY
    expect(needsBackupReminder(dataWith(10, 0, backup), backup + 30 * MS_PER_DAY)).toBe(false)
    expect(needsBackupReminder(dataWith(10, 0, backup), backup + 30 * MS_PER_DAY + 1)).toBe(true)
  })

  it('goes by the last backup, not the install, once there is one', () => {
    const backup = INSTALLED_AT + 1000 * MS_PER_DAY
    expect(needsBackupReminder(dataWith(10, 0, backup), backup + MS_PER_DAY)).toBe(false)
  })
})

describe('firstPeriod', () => {
  it('is the period of the install when nothing is older', () => {
    expect(firstPeriod(installed(INSTALLED_AT), TODAY)).toBe('2026-08')
  })

  it('reaches back to the earliest transaction', () => {
    const data = installed(INSTALLED_AT, 1, {
      transactions: [makeTransaction({ id: 'a', date: '2026-07-20' }), makeTransaction({ id: 'b', date: '2026-06-30' })],
    })
    expect(firstPeriod(data, TODAY)).toBe('2026-06')
  })

  it('reaches back to the earliest recurring start', () => {
    expect(firstPeriod(sampleData(), TODAY)).toBe('2026-03')
  })

  it('is never after the current period', () => {
    const future = installed(NOW + 90 * MS_PER_DAY, 1, {
      transactions: [makeTransaction({ date: '2027-03-01' })],
      recurring: [makeRecurring({ startMonth: '2027-01', amounts: [{ from: '2027-01', amount: 100 }] })],
    })
    expect(firstPeriod(future, TODAY)).toBe('2026-10')
  })

  it('counts in budget periods when months start later than the 1st', () => {
    // Installed 3 Aug with periods from the 25th: that is the period that started on 25 July.
    expect(firstPeriod(installed(INSTALLED_AT, 25), TODAY)).toBe('2026-07')
    const data = (date: `${number}-${number}-${number}`): AppData =>
      installed(INSTALLED_AT, 25, { transactions: [makeTransaction({ date })] })
    expect(firstPeriod(data('2026-06-25'), TODAY)).toBe('2026-06')
    expect(firstPeriod(data('2026-06-24'), TODAY)).toBe('2026-05')
    expect(firstPeriod(installed(NOW + MS_PER_DAY * 40, 25), '2026-10-24')).toBe('2026-09')
  })

  it('uses the local date of the install', () => {
    // 00:30 on 1 October in Berlin, still 30 September in UTC.
    expect(firstPeriod(installed(Date.UTC(2026, 8, 30, 22, 30)), TODAY)).toBe('2026-10')
  })
})

describe('nextFreeCategoryColor', () => {
  it('starts with blue', () => {
    expect(nextFreeCategoryColor([])).toBe('blue')
  })

  it('takes the first colour no active category uses', () => {
    expect(nextFreeCategoryColor(coloured('blue', 'orange'))).toBe('aqua')
    expect(nextFreeCategoryColor(coloured('orange', 'blue', 'yellow'))).toBe('aqua')
  })

  it('ignores archived categories', () => {
    const categories = [...coloured('blue'), makeCategory('cat-archived', { color: 'orange', archived: true })]
    expect(nextFreeCategoryColor(categories)).toBe('orange')
  })

  it('takes the least used colour when all are taken, the earlier one on a tie', () => {
    // The defaults use blue and slate twice, every other colour once.
    expect(nextFreeCategoryColor(createDefaultCategories())).toBe('orange')
    const keys = CATEGORY_COLORS.map(({ key }) => key)
    expect(nextFreeCategoryColor(coloured(...keys, ...keys.filter((key) => key !== 'red')))).toBe('red')
  })
})

describe('isIconKey', () => {
  it.each(CATEGORY_ICONS.map(({ key }) => key))('knows %s', (key) => {
    expect(isIconKey(key)).toBe(true)
  })

  it.each(['🍕', '', 'House', ' house', 'house ', 'not-an-icon', 'caret-left', 'constructor', 'toString', '__proto__'])(
    'rejects %j',
    (icon) => {
      expect(isIconKey(icon)).toBe(false)
    },
  )
})

describe('splitGraphemes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('splits text into the characters people see', () => {
    expect(splitGraphemes('a👩‍💻🇩🇪e\u{301}👍🏽')).toEqual(['a', '👩‍💻', '🇩🇪', 'e\u{301}', '👍🏽'])
    expect(splitGraphemes('')).toEqual([])
  })

  it('falls back to code points where Intl.Segmenter is missing', async () => {
    vi.stubGlobal('Intl', Object.create(Intl, { Segmenter: { value: undefined } }) as typeof Intl)
    vi.resetModules()
    const fresh = await import('@/domain/queries')
    expect(fresh.splitGraphemes('a👍🏽')).toEqual(['a', '👍', '🏽'])
  })
})

describe('isEmoji', () => {
  it.each([
    '😀',
    '👍🏽',
    '🇩🇪',
    '👩‍💻',
    '❤️',
    '❤️‍🔥',
    '#️⃣',
    '*️⃣',
    '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    '👨‍👩‍👧‍👦',
    '👩🏻‍❤️‍💋‍👨🏼',
    '☕',
    '☕\u{FE0E}',
    '★',
    '♥',
    '€',
    '$',
    '©',
    '‼️',
  ])(
    'accepts %s',
    (value) => {
      expect(isEmoji(value)).toBe(true)
    },
  )

  it.each([
    '',
    ' ',
    'a',
    'A',
    'ab',
    '1',
    '1️⃣',
    'ℹ️',
    'ß',
    '中',
    '😀😀',
    '😀 ',
    ' 😀',
    '😀a',
    'house',
    '\u{200D}',
    '\u{FE0F}',
    '\u{301}',
    '\r\n',
    '\t',
    '€'.repeat(40),
  ])('rejects %j', (value) => {
    expect(isEmoji(value)).toBe(false)
  })
})

describe('isIconRef', () => {
  it('accepts catalog icons and single emoji', () => {
    expect(isIconRef('coffee')).toBe(true)
    expect(isIconRef('question')).toBe(true)
    expect(isIconRef('🥙')).toBe(true)
  })

  it.each([null, undefined, 5, {}, ['house'], '', 'coffee ', 'Kaffee', '😀😀'])('rejects %j', (value) => {
    expect(isIconRef(value)).toBe(false)
  })
})
