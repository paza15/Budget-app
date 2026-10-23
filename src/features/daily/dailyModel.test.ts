import { describe, expect, it } from 'vitest'
import { createMoneyFormat } from '@/domain/money'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import { makeCategory, makeData, makeSplit, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import { categoryMapOf } from '@/store/selectors'
import { ALL, categoryChips, expensesFor, groupByDay, knownIds, searchExpenses, searchKey } from './dailyModel'
import { joinNames, splitLine } from './splitText'

const { coffee, eating, rent, shopping, transport } = DEFAULT_CATEGORY_IDS
const data = makeData()
const map = categoryMapOf(data.categories)
const known = knownIds(data.categories)

describe('category chips (docs/SPEC.md §3.3)', () => {
  it('lists All and the daily categories in category order', () => {
    const chips = categoryChips([], data.categories, map)
    expect(chips[0]).toEqual({ value: ALL, label: 'All' })
    expect(chips[1]).toMatchObject({ value: transport, label: 'Transport', icon: 'train' })
    expect(chips.map((c) => c.value)).not.toContain(rent)
  })

  it('adds a category with expenses in the period, also one paid only from the wallet', () => {
    const txs = [makeTransaction({ categoryId: rent, fromWallet: true })]
    expect(categoryChips(txs, data.categories, map).map((c) => c.value)).toContain(rent)
  })

  it('adds archived categories with expenses, and Uncategorized last', () => {
    const categories = [...data.categories, makeCategory('cat-old', { name: 'Old', archived: true, order: 3 })]
    const txs = [makeTransaction({ categoryId: 'cat-old' }), makeTransaction({ id: 'tx-2', categoryId: 'cat-deleted' })]
    const chips = categoryChips(txs, categories, categoryMapOf(categories))
    expect(chips.map((c) => c.value)).toContain('cat-old')
    expect(chips.at(-1)).toEqual({ value: UNCATEGORIZED_ID, label: 'Uncategorized', icon: 'question' })
  })
})

describe('the list (§3.3, §4.9)', () => {
  const txs = [
    makeTransaction({ id: 'a', date: '2026-10-14', amount: 350, categoryId: coffee }),
    makeTransaction({ id: 'b', date: '2026-10-14', amount: 3200, categoryId: eating, splits: [makeSplit({ amount: 1600 })] }),
    makeTransaction({ id: 'c', date: '2026-10-13', amount: 54900, categoryId: shopping, fromWallet: true }),
    makeTransaction({ id: 'd', date: '2026-10-12', kind: 'income', amount: 5000 }),
    makeTransaction({ id: 'e', date: '2026-10-12', amount: 120, categoryId: 'cat-deleted' }),
  ]

  it('lists expenses only, filtered the way byCategory files them', () => {
    expect(expensesFor(txs, ALL, known).map((t) => t.id)).toEqual(['a', 'b', 'c', 'e'])
    expect(expensesFor(txs, eating, known).map((t) => t.id)).toEqual(['b'])
    expect(expensesFor(txs, UNCATEGORIZED_ID, known).map((t) => t.id)).toEqual(['e'])
  })

  it('groups by day with day totals of shares, nothing for the wallet', () => {
    const groups = groupByDay(expensesFor(txs, ALL, known))
    expect(groups.map((g) => [g.date, g.total, g.fromWallet])).toEqual([
      ['2026-10-14', 350 + 1600, false],
      ['2026-10-13', 0, true],
      ['2026-10-12', 120, false],
    ])
  })
})

describe('search (§3.3)', () => {
  const txs = [
    makeTransaction({ id: 'a', date: '2026-10-14', note: 'Café Luitpold', categoryId: coffee }),
    makeTransaction({ id: 'b', date: '2026-09-02', note: 'Bus', categoryId: transport }),
    makeTransaction({ id: 'c', date: '2026-09-20', note: '', categoryId: coffee, amount: 120 }),
    makeTransaction({ id: 'd', date: '2026-08-01', note: 'Cafe', kind: 'income', amount: 100 }),
  ]

  it('finds notes and category names, ignoring case and accents, newest first by period', () => {
    const result = searchExpenses(txs, 'cafe', map, 1, 200)
    expect(result.count).toBe(1)
    expect(result.groups.map((g) => [g.month, g.items.map((t) => t.id)])).toEqual([['2026-10', ['a']]])
    const byCategory = searchExpenses(txs, ' coffee  & ', map, 1, 200)
    expect(byCategory.groups.map((g) => [g.month, g.items.map((t) => t.id), g.total])).toEqual([
      ['2026-10', ['a'], 350],
      ['2026-09', ['c'], 120],
    ])
  })

  it('finds nothing for an empty query, and lists at most the limit', () => {
    expect(searchExpenses(txs, '  ', map, 1, 200)).toEqual({ groups: [], count: 0 })
    const many = searchExpenses(txs, 'c', map, 1, 1)
    expect(many.count).toBe(2)
    expect(many.groups.flatMap((g) => g.items)).toHaveLength(1)
  })

  it('groups by the period, whatever the start day', () => {
    const result = searchExpenses(txs, 'bus', map, 25, 200)
    expect(result.groups[0]?.month).toBe('2026-08')
  })

  it('makes the key without accents and extra spaces', () => {
    expect(searchKey('  Crème   Brûlée ')).toBe('creme brulee')
  })
})

describe('the split line of a row (EXTRAS.md §2.5)', () => {
  const money = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: false })
  const masked = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: true })


  it('says who still owes', () => {
    const one = makeTransaction({ amount: 1800, splits: [makeSplit({ person: 'Max', amount: 900 })] })
    expect(splitLine(one, money)?.text).toMatch(/^Split, Max owes 9,00\s€$/u)
    expect(splitLine(one, masked)).toEqual({ text: 'Split, Max owes •••', spoken: 'Split, Max owes amount hidden.' })
    const two = makeTransaction({ splits: [makeSplit({ id: 'a', person: 'Lea' }), makeSplit({ id: 'b', person: 'Max' })] })
    expect(splitLine(two, money)?.text).toBe('Split with 2 people')
  })

  it('counts only the people still owing', () => {
    const tx = makeTransaction({
      splits: [makeSplit({ id: 'a', person: 'Lea', status: 'paid' }), makeSplit({ id: 'b', person: 'Max', amount: 800 })],
    })
    expect(splitLine(tx, money)?.text).toMatch(/^Split, Max owes 8,00\s€$/u)
  })

  it('says settled when everyone paid back, and nothing when all was forgiven', () => {
    const paid = makeTransaction({
      splits: [makeSplit({ id: 'a', person: 'Lea', status: 'paid' }), makeSplit({ id: 'b', person: 'Max', status: 'paid' })],
    })
    expect(splitLine(paid, money)?.text).toBe('Split with Lea and Max, settled')
    const forgiven = makeTransaction({ splits: [makeSplit({ status: 'forgiven' })] })
    expect(splitLine(forgiven, money)).toBeNull()
    expect(splitLine(makeTransaction(), money)).toBeNull()
  })

  it('joins names the English way', () => {
    expect(joinNames(['Max'])).toBe('Max')
    expect(joinNames(['Lea', 'Max'])).toBe('Lea and Max')
    expect(joinNames(['Lea', 'Max', 'Jonas'])).toBe('Lea, Max and Jonas')
  })
})
