import { describe, expect, it } from 'vitest'
import { categoryTrend, trend } from '@/domain/insights'
import { monthReview } from '@/domain/review'
import { owedSummary } from '@/domain/splits'
import { computeMonthSummary } from '@/domain/summary'
import { sampleData, TODAY } from '@/domain/test-helpers/dataFixtures'
import { walletSummary } from '@/domain/wallet'
import {
  categoryMapOf,
  getCategoryMap,
  getCategoryTrend,
  getMonthReview,
  getMonthSummary,
  getOwedSummary,
  getTrend,
  getUnreviewedMonth,
  getWalletSummary,
  memoByData,
} from '@/store/selectors'

describe('memoByData', () => {
  it('computes once per data object and key', () => {
    const data = sampleData()
    let runs = 0
    const compute = (): { run: number } => {
      runs += 1
      return { run: runs }
    }
    const first = memoByData(data, 'k', compute)
    expect(memoByData(data, 'k', compute)).toBe(first)
    expect(runs).toBe(1)

    expect(memoByData(data, 'other', compute)).not.toBe(first)
    expect(memoByData(sampleData(), 'k', compute)).not.toBe(first)
    expect(runs).toBe(3)
  })

  it('caches undefined results too', () => {
    const data = sampleData()
    let runs = 0
    const compute = (): undefined => {
      runs += 1
      return undefined
    }
    memoByData(data, 'nothing', compute)
    memoByData(data, 'nothing', compute)
    expect(runs).toBe(1)
  })
})

describe('getMonthSummary', () => {
  it('equals computeMonthSummary and returns the same object for the same inputs', () => {
    const data = sampleData()
    const summary = getMonthSummary(data, '2026-10', TODAY)
    expect(summary).toEqual(computeMonthSummary(data, '2026-10', TODAY))
    expect(getMonthSummary(data, '2026-10', TODAY)).toBe(summary)
  })

  it('computes again for another month, another day or new data', () => {
    const data = sampleData()
    const summary = getMonthSummary(data, '2026-10', TODAY)
    expect(getMonthSummary(data, '2026-09', TODAY)).not.toBe(summary)
    expect(getMonthSummary(data, '2026-10', '2026-10-15')).not.toBe(summary)
    expect(getMonthSummary({ ...data }, '2026-10', TODAY)).not.toBe(summary)
  })
})

describe('getTrend and getCategoryTrend', () => {
  it('equal the domain results and are memoised', () => {
    const data = sampleData()
    const points = getTrend(data, '2026-10', 6, TODAY)
    expect(points).toEqual(trend(data, '2026-10', 6, TODAY))
    expect(getTrend(data, '2026-10', 6, TODAY)).toBe(points)
    expect(getTrend(data, '2026-10', 3, TODAY)).toHaveLength(3)

    const coffee = getCategoryTrend(data, 'cat-coffee', '2026-10', 6, TODAY)
    expect(coffee).toEqual(categoryTrend(data, 'cat-coffee', '2026-10', 6, TODAY))
    expect(getCategoryTrend(data, 'cat-coffee', '2026-10', 6, TODAY)).toBe(coffee)
    expect(getCategoryTrend(data, 'cat-eating', '2026-10', 6, TODAY)).not.toBe(coffee)
  })

  it('keeps keys with any characters apart', () => {
    const data = sampleData()
    const a = getCategoryTrend(data, 'a","b', '2026-10', 1, TODAY)
    const b = getCategoryTrend(data, 'a', '2026-10', 1, TODAY)
    expect(a).not.toBe(b)
  })
})

describe('getWalletSummary', () => {
  it('equals walletSummary and returns the same object for the same data and day', () => {
    const data = sampleData()
    const wallet = getWalletSummary(data, TODAY)
    expect(wallet).toEqual(walletSummary(data, TODAY))
    expect(getWalletSummary(data, TODAY)).toBe(wallet)
    // Results reference the stored goals (§5.3).
    expect(wallet.goals[0]?.goal).toBe(data.wallet.goals[0])
  })

  it('computes again for another day or new data', () => {
    const data = sampleData()
    const wallet = getWalletSummary(data, TODAY)
    expect(getWalletSummary(data, '2026-10-15')).not.toBe(wallet)
    expect(getWalletSummary({ ...data }, TODAY)).not.toBe(wallet)
  })
})

describe('getOwedSummary', () => {
  it('equals owedSummary and is memoised per data object', () => {
    const data = sampleData()
    const owed = getOwedSummary(data)
    expect(owed).toEqual(owedSummary(data))
    expect(owed).toMatchObject({ total: 800, people: [{ person: 'Jonas', total: 800 }] })
    expect(getOwedSummary(data)).toBe(owed)
    expect(getOwedSummary({ ...data })).not.toBe(owed)
  })
})

describe('getMonthReview', () => {
  it('equals monthReview and is memoised per data object, month and day', () => {
    const data = sampleData()
    const review = getMonthReview(data, '2026-09', TODAY)
    expect(review).toEqual(monthReview(data, '2026-09', TODAY))
    expect(getMonthReview(data, '2026-09', TODAY)).toBe(review)
    expect(getMonthReview(data, '2026-08', TODAY)).not.toBe(review)
    expect(getMonthReview(data, '2026-09', '2026-10-15')).not.toBe(review)
    expect(getMonthReview({ ...data }, '2026-09', TODAY)).not.toBe(review)
  })
})

describe('getUnreviewedMonth', () => {
  it('offers the latest closed period until it is reviewed, and follows the day', () => {
    const data = sampleData()
    // September is reviewed in the sample.
    expect(getUnreviewedMonth(data, TODAY)).toBeNull()
    expect(getUnreviewedMonth(data, '2026-11-01')).toBe('2026-10')
    const unreviewed = { ...data, settings: { ...data.settings, lastReviewedMonth: null } }
    expect(getUnreviewedMonth(unreviewed, TODAY)).toBe('2026-09')
  })
})

describe('memoised selectors on one data object', () => {
  it('keep their results apart', () => {
    const data = sampleData()
    const wallet = getWalletSummary(data, TODAY)
    const owed = getOwedSummary(data)
    const review = getMonthReview(data, '2026-09', TODAY)
    const summary = getMonthSummary(data, '2026-09', TODAY)
    expect(new Set<unknown>([wallet, owed, review, summary]).size).toBe(4)
    expect(getWalletSummary(data, TODAY)).toBe(wallet)
    expect(getOwedSummary(data)).toBe(owed)
    expect(getMonthReview(data, '2026-09', TODAY)).toBe(review)
    expect(getMonthSummary(data, '2026-09', TODAY)).toBe(summary)
  })
})

describe('category maps', () => {
  it('map every category by id, archived ones included, without a prototype', () => {
    const data = sampleData()
    const map = categoryMapOf(data.categories)
    expect(Object.keys(map)).toEqual(data.categories.map(({ id }) => id))
    expect(map['cat-gym']).toBe(data.categories.find(({ id }) => id === 'cat-gym'))
    expect(Object.getPrototypeOf(map)).toBeNull()
    expect(map.constructor).toBeUndefined()
  })

  it('getCategoryMap is memoised per data object', () => {
    const data = sampleData()
    expect(getCategoryMap(data)).toBe(getCategoryMap(data))
    expect(getCategoryMap({ ...data })).not.toBe(getCategoryMap(data))
  })
})
