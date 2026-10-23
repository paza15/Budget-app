import { describe, expect, it } from 'vitest'
import {
  changeWords,
  closedCaption,
  closedLabel,
  endedBeforeInstall,
  foldNames,
  formatCount,
  heroSentenceParts,
  reviewHero,
  reviewLedger,
} from '@/features/review/reviewModel'

/** Intl's spacing before "%" and in groups (U+00A0 and U+202F) shown as plain spaces. */
const INTL_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g')
const plain = (text: string): string => text.replace(INTL_SPACES, ' ')

describe('the Closed seal (DESIGN.md §3.2)', () => {
  it('captions the last day and names it for VoiceOver', () => {
    expect(closedCaption('2026-10-31', 'de-DE')).toBe('Closed 31 Oct')
    expect(closedCaption('2026-10-31', 'en-US')).toBe('Closed Oct 31')
    expect(closedLabel('2026-10-31', 'de-DE')).toBe('Statement closed on 31 October')
    expect(closedLabel('2026-11-24', 'en-US')).toBe('Statement closed on November 24')
  })
})

describe('endedBeforeInstall', () => {
  // 2026-08-03 09:00 in Berlin.
  const installed = Date.UTC(2026, 7, 3, 7)

  it('is true only for periods that ended before the install day', () => {
    expect(endedBeforeInstall('2026-07-31', installed)).toBe(true)
    expect(endedBeforeInstall('2026-08-02', installed)).toBe(true)
    expect(endedBeforeInstall('2026-08-03', installed)).toBe(false)
    expect(endedBeforeInstall('2026-08-31', installed)).toBe(false)
  })
})

describe('reviewHero (EXTRAS.md §1.2)', () => {
  const october = { income: 145000, daily: 53830, spent: 131718 }

  it('names savings and what was left over', () => {
    expect(reviewHero({ ...october, result: 13282, savings: 10000, left: 3282 }, false)).toEqual({
      label: 'Moved to your wallet',
      critical: false,
      cents: 13282,
      sentence: { kind: 'savingsAndLeft', savings: 10000, left: 3282 },
    })
  })

  it('says what the savings covered when the budget was overspent', () => {
    expect(reviewHero({ ...october, result: 7660, savings: 10000, left: -2340 }, false)).toEqual({
      label: 'Moved to your wallet',
      critical: false,
      cents: 7660,
      sentence: { kind: 'savingsLessOver', savings: 10000, over: 2340 },
    })
  })

  it('has no sentence without savings: the figure is what was left over', () => {
    expect(reviewHero({ ...october, result: 5000, savings: 0, left: 5000 }, false).sentence).toBeNull()
  })

  it('says the month came out even at 0', () => {
    expect(reviewHero({ ...october, result: 0, savings: 10000, left: -10000 }, false)).toEqual({
      label: 'Moved to your wallet',
      critical: false,
      cents: 0,
      sentence: { kind: 'even' },
    })
  })

  it('takes money from the wallet in critical words when the month was negative', () => {
    expect(reviewHero({ ...october, result: -4128, savings: 0, left: -4128 }, false)).toEqual({
      label: 'Taken from your wallet',
      critical: true,
      cents: 4128,
      sentence: { kind: 'moreThanCameIn', amount: 4128 },
    })
  })

  it("reads as Home's past hero before the wallet's start", () => {
    expect(reviewHero({ ...october, result: 13282, savings: 10000, left: 3282 }, true)).toEqual({
      label: 'Left over',
      critical: false,
      cents: 3282,
      sentence: { kind: 'dailyLife', daily: 53830 },
    })
    expect(reviewHero({ ...october, result: 7660, savings: 10000, left: -2340 }, true)).toEqual({
      label: 'Over budget by',
      critical: true,
      cents: 2340,
      sentence: { kind: 'dailyLife', daily: 53830 },
    })
    expect(reviewHero({ income: 0, daily: 5000, spent: 70000, result: -70000, savings: 0, left: -70000 }, true)).toEqual({
      label: 'Spent',
      critical: false,
      cents: 70000,
      sentence: null,
    })
  })
})

describe('heroSentenceParts', () => {
  it('puts the words around the amounts', () => {
    expect(heroSentenceParts({ kind: 'savingsAndLeft', savings: 10000, left: 3282 })).toEqual([
      { cents: 10000 },
      ' of savings and ',
      { cents: 3282 },
      ' left over.',
    ])
    expect(heroSentenceParts({ kind: 'savingsLessOver', savings: 10000, over: 2340 })).toEqual([
      { cents: 10000 },
      ' of savings, less ',
      { cents: 2340 },
      ' over budget.',
    ])
    expect(heroSentenceParts({ kind: 'even' })).toEqual(['Income and spending came out even.'])
    expect(heroSentenceParts({ kind: 'moreThanCameIn', amount: 4128 })).toEqual([
      'You spent ',
      { cents: 4128 },
      ' more than came in.',
    ])
    expect(heroSentenceParts({ kind: 'dailyLife', daily: 51230 })).toEqual(['You spent ', { cents: 51230 }, ' on daily life.'])
  })
})

describe('reviewLedger (EXTRAS.md §1.3)', () => {
  const month = { income: 145000, fixed: 77888, savings: 10000, daily: 53830, left: 3282, result: 13282 }

  it('closes on what went to the wallet, without a savings line', () => {
    expect(reviewLedger(month, false)).toEqual({
      lines: [
        { key: 'income', operator: '+', label: 'Income', cents: 145000 },
        { key: 'fixed', operator: '−', label: 'Fixed costs', cents: 77888 },
        { key: 'daily', operator: '−', label: 'Daily spending', cents: 53830 },
      ],
      result: { label: 'To your wallet', cents: 13282, critical: false },
    })
  })

  it('takes from the wallet in critical ink when the result is negative', () => {
    expect(reviewLedger({ ...month, result: -4128, left: -14128 }, false).result).toEqual({
      label: 'From your wallet',
      cents: -4128,
      critical: true,
    })
  })

  it("closes on Left with the savings line before the wallet's start, hiding savings of 0", () => {
    const before = reviewLedger(month, true)
    expect(before.lines.map((line) => line.key)).toEqual(['income', 'fixed', 'savings', 'daily'])
    expect(before.result).toEqual({ label: 'Left', cents: 3282, critical: false })
    const noSavings = reviewLedger({ ...month, savings: 0, left: -2000 }, true)
    expect(noSavings.lines.map((line) => line.key)).toEqual(['income', 'fixed', 'daily'])
    expect(noSavings.result).toEqual({ label: 'Left', cents: -2000, critical: true })
  })
})

describe('changeWords (EXTRAS.md §1.4)', () => {
  const names = { period: 'October', previous: 'September' }

  it('says more or less in whole percent with an arrow', () => {
    const more = changeWords(0.0806, names, 'de-DE')
    expect(more.arrow).toBe('up')
    expect(plain(more.text)).toBe('8 % more than September')
    expect(more.spoken).toBe('8 percent more than September')
    const less = changeWords(-0.1389, names, 'de-DE')
    expect(less.arrow).toBe('down')
    expect(plain(less.text)).toBe('14 % less than September')
    expect(less.spoken).toBe('14 percent less than September')
  })

  it('follows the number format', () => {
    expect(changeWords(0.08, names, 'en-US').text).toBe('8% more than September')
    expect(plain(changeWords(12.5, names, 'de-DE').text)).toBe('1.250 % more than September')
    expect(changeWords(12.5, names, 'de-DE').spoken).toBe('1.250 percent more than September')
  })

  it('says "Same as" under half a percent either way, and "New" without a previous amount', () => {
    expect(changeWords(0.0049, names, 'de-DE')).toEqual({ arrow: null, text: 'Same as September', spoken: 'Same as September' })
    expect(changeWords(-0.0049, names, 'de-DE').text).toBe('Same as September')
    expect(changeWords(0, names, 'de-DE').text).toBe('Same as September')
    expect(plain(changeWords(0.005, names, 'de-DE').text)).toBe('1 % more than September')
    expect(changeWords(null, names, 'de-DE')).toEqual({ arrow: null, text: 'New in October', spoken: 'New in October' })
  })
})

// The folded categories themselves are MonthReview.rest (src/domain/review.ts): ranked, with their
// change, like the top five.
describe('foldNames (EXTRAS.md §1.4)', () => {
  it('names the folded categories in amount order', () => {
    expect(foldNames([])).toBe('')
    expect(foldNames(['Shopping'])).toBe('Shopping')
    expect(foldNames(['Shopping', 'Transport'])).toBe('Shopping and Transport')
    expect(foldNames(['Shopping', 'Transport', 'Health'])).toBe('Shopping, Transport and Health')
    expect(foldNames(['Shopping', 'Transport', 'Health', 'Other', 'Rent'])).toBe('Shopping, Transport, Health and 2 more')
  })
})

describe('formatCount', () => {
  it('groups like the chosen number format', () => {
    expect(formatCount(64, 'de-DE')).toBe('64')
    expect(formatCount(1204, 'de-DE')).toBe('1.204')
    expect(formatCount(1204, 'en-US')).toBe('1,204')
  })
})
