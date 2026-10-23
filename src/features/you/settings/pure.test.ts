import { describe, expect, it } from 'vitest'
import { HOME_CARDS } from '@/domain/catalog'
import { makeData, makeRecurring, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import type { HomeCardKey } from '@/domain/types'
import { moveKey, placeMessage } from './order'
import { arrange, fullOrder, hasPeriodData } from './rules'
import { countOf, joinWords, kindLabel, searchKey, startOfDayMs, usageWords } from './text'

const ALL: HomeCardKey[] = HOME_CARDS.map(({ key }) => key)

describe('moveKey', () => {
  it('moves an item one place up or down in a copy', () => {
    const keys = ['a', 'b', 'c']
    expect(moveKey(keys, 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moveKey(keys, 0, 1)).toEqual(['b', 'a', 'c'])
    expect(keys).toEqual(['a', 'b', 'c'])
  })

  it('leaves the order alone past either end or for an unknown index', () => {
    expect(moveKey(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveKey(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(moveKey(['a', 'b'], -1, 1)).toEqual(['a', 'b'])
  })
})

describe('placeMessage', () => {
  it('says first, last or the place', () => {
    expect(placeMessage('Recent', 1, 8)).toBe('Recent is now first')
    expect(placeMessage('Recent', 8, 8)).toBe('Recent is now last')
    expect(placeMessage('Rent', 3, 12)).toBe('Rent is now 3 of 12')
  })
})

describe('fullOrder (Home layout)', () => {
  it('lists every card, the shown ones in their Home order', () => {
    expect(fullOrder(ALL)).toEqual(ALL)
    const reordered: HomeCardKey[] = ['recent', ...ALL.filter((key) => key !== 'recent')]
    expect(fullOrder(reordered)).toEqual(reordered)
  })

  it('puts a hidden card after the card before it by default', () => {
    const shown = ALL.filter((key) => key !== 'whereItWent')
    expect(fullOrder(shown)).toEqual(ALL)
    // Recent moved to the top, Where it went hidden: it stays after Owed to you.
    const moved: HomeCardKey[] = ['recent', 'equation', 'wallet', 'owed', 'budgets', 'comingUp', 'trend']
    expect(fullOrder(moved)).toEqual(['recent', 'equation', 'wallet', 'owed', 'whereItWent', 'budgets', 'comingUp', 'trend'])
  })

  it('puts hidden cards first when nothing before them is shown, and drops repeats', () => {
    expect(fullOrder(['recent', 'recent'])).toEqual([...ALL.filter((key) => key !== 'recent'), 'recent'])
    expect(fullOrder([])).toEqual(ALL)
  })
})

describe('arrange (Home layout)', () => {
  it('keeps hidden cards in place and the shown ones in the stored order', () => {
    const order: HomeCardKey[] = ['equation', 'wallet', 'owed', 'whereItWent']
    // Wallet hidden: it stays second.
    expect(arrange(order, ['equation', 'owed', 'whereItWent'])).toEqual(order)
    // The stored order changed (Where it went first): shown cards fill the shown places.
    expect(arrange(order, ['whereItWent', 'equation', 'owed'])).toEqual(['whereItWent', 'wallet', 'equation', 'owed'])
  })

  it('appends a shown card the order does not know', () => {
    expect(arrange(['equation'], ['equation', 'recent'])).toEqual(['equation', 'recent'])
  })
})

describe('hasPeriodData (Month starts on)', () => {
  it('is false for a fresh install and true once anything is entered', () => {
    const fresh = makeData()
    expect(hasPeriodData(fresh)).toBe(false)
    expect(hasPeriodData(makeData({ transactions: [makeTransaction()] }))).toBe(true)
    expect(hasPeriodData(makeData({ recurring: [makeRecurring()] }))).toBe(true)
    expect(hasPeriodData(makeData({ months: { '2026-10': { savingsGoal: 5000 } } }))).toBe(true)
    expect(hasPeriodData(makeData({ wallet: { ...fresh.wallet, opening: 100 } }))).toBe(true)
    expect(hasPeriodData(makeData({ wallet: { ...fresh.wallet, startMonth: '2026-09' } }))).toBe(true)
  })
})

describe('text helpers', () => {
  it('counts and joins in plain English', () => {
    expect(countOf(1, 'expense', 'expenses')).toBe('1 expense')
    expect(countOf(12, 'expense', 'expenses')).toBe('12 expenses')
    expect(joinWords([])).toBe('')
    expect(joinWords(['a'])).toBe('a')
    expect(joinWords(['a', 'b'])).toBe('a and b')
    expect(joinWords(['a', 'b', 'c'])).toBe('a, b and c')
  })

  it('says what deleting a used category moves, skipping what is not there', () => {
    expect(usageWords({ transactions: 12, recurring: 1, quickAdds: 2 })).toBe('12 expenses, 1 fixed cost and 2 quick adds')
    expect(usageWords({ transactions: 0, recurring: 2, quickAdds: 1 })).toBe('2 fixed costs and 1 quick add')
    expect(usageWords({ transactions: 1, recurring: 0, quickAdds: 0 })).toBe('1 expense')
  })

  it('names the kinds', () => {
    expect(kindLabel('fixed')).toBe('Fixed costs')
    expect(kindLabel('daily')).toBe('Daily spending')
    expect(kindLabel('both')).toBe('Fixed and daily')
  })

  it('finds names without accents or case', () => {
    expect(searchKey('Polish złoty')).toBe('polish zloty')
    expect(searchKey('  EUR ')).toBe('eur')
    expect(searchKey('Ångström')).toBe('angstrom')
  })

  it('takes local midnight of a date as "now"', () => {
    expect(startOfDayMs('2026-10-14')).toBe(new Date(2026, 9, 14).getTime())
    // Berlin switches to winter time on 25 Oct 2026: still that day's midnight.
    expect(startOfDayMs('2026-10-25')).toBe(new Date(2026, 9, 25, 0, 0, 0).getTime())
  })
})
