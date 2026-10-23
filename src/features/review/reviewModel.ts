import { compareISO, dateLocaleFor, formatDate, localDateOf, monthName, parseISODate } from '@/domain/dates'
import type { MonthReview } from '@/domain/review'
import type { Cents, ISODate } from '@/domain/types'

/**
 * What the month-end review shows, as plain data (docs/SPEC.md §3.15, docs/design/EXTRAS.md §1):
 * which hero case applies, the ledger rows, the change words of "Where it went", the fold's names
 * and the Closed seal's words. Every amount comes from MonthReview and MonthSummary (the folded
 * categories are MonthReview.rest, the dates formatPeriodDates); nothing is computed here beyond
 * choosing and ordering what they report.
 */

/** The caption under the seal, the period's last day: "Closed 31 Oct" (DESIGN.md §3.2). */
export function closedCaption(end: ISODate, locale: string): string {
  return `Closed ${formatDate(end, locale, 'short')}`
}

/** What VoiceOver says for the seal: "Statement closed on 31 October" ("on October 31" in en-US). */
export function closedLabel(end: ISODate, locale: string): string {
  const { m, d } = parseISODate(end)
  const day = dateLocaleFor(locale) === 'en-US' ? `${monthName(m)} ${d}` : `${d} ${monthName(m)}`
  return `Statement closed on ${day}`
}

/** True when the period ended before the app was installed: nothing was tracked day by day. */
export function endedBeforeInstall(end: ISODate, createdAt: number): boolean {
  return compareISO(end, localDateOf(createdAt)) < 0
}

// ---------------------------------------------------------------------------------------------
// The result (EXTRAS.md §1.2)

/** The sentence under the figure. Amounts stay numbers; the screen formats (and masks) them. */
export type HeroSentence =
  /** "{savings} of savings and {left} left over." */
  | { kind: 'savingsAndLeft'; savings: Cents; left: Cents }
  /** "{savings} of savings, less {over} over budget." */
  | { kind: 'savingsLessOver'; savings: Cents; over: Cents }
  /** "Income and spending came out even." */
  | { kind: 'even' }
  /** "You spent {amount} more than came in." */
  | { kind: 'moreThanCameIn'; amount: Cents }
  /** "You spent {daily} on daily life." (Home's past hero, for periods before the wallet's start) */
  | { kind: 'dailyLife'; daily: Cents }

/** A sentence as text and amounts, so the screen can show (or mask) each amount as money. */
export type SentencePart = string | { cents: Cents }

/** The words of a hero sentence around its amounts. */
export function heroSentenceParts(sentence: HeroSentence): SentencePart[] {
  switch (sentence.kind) {
    case 'savingsAndLeft':
      return [{ cents: sentence.savings }, ' of savings and ', { cents: sentence.left }, ' left over.']
    case 'savingsLessOver':
      return [{ cents: sentence.savings }, ' of savings, less ', { cents: sentence.over }, ' over budget.']
    case 'even':
      return ['Income and spending came out even.']
    case 'moreThanCameIn':
      return ['You spent ', { cents: sentence.amount }, ' more than came in.']
    case 'dailyLife':
      return ['You spent ', { cents: sentence.daily }, ' on daily life.']
  }
}

export interface ReviewHero {
  label: 'Moved to your wallet' | 'Taken from your wallet' | 'Left over' | 'Over budget by' | 'Spent'
  /** --critical-ink with the octagon: money came out of the wallet, or the budget was overspent. */
  critical: boolean
  /** The figure, always 0 or more: the label says which way it went. */
  cents: Cents
  sentence: HeroSentence | null
}

export type HeroInput = Pick<MonthReview, 'result' | 'savings' | 'left' | 'income' | 'daily'> & {
  /** fixed + daily (MonthSummary.spent): the figure of a past period without income. */
  spent: Cents
}

/**
 * The hero of the review (EXTRAS.md §1.2): the month's result and where it went. A period before
 * the wallet's start never moved money, so it reads as Home's past hero (SPEC §3.1) instead.
 */
export function reviewHero(review: HeroInput, beforeWallet: boolean): ReviewHero {
  if (beforeWallet) {
    if (review.income === 0) return { label: 'Spent', critical: false, cents: review.spent, sentence: null }
    const sentence: HeroSentence = { kind: 'dailyLife', daily: review.daily }
    if (review.left >= 0) return { label: 'Left over', critical: false, cents: review.left, sentence }
    return { label: 'Over budget by', critical: true, cents: -review.left, sentence }
  }
  const { result, savings, left } = review
  if (result < 0) {
    return { label: 'Taken from your wallet', critical: true, cents: -result, sentence: { kind: 'moreThanCameIn', amount: -result } }
  }
  if (result === 0) return { label: 'Moved to your wallet', critical: false, cents: 0, sentence: { kind: 'even' } }
  // Without savings the figure is simply what was left over: the sentence would repeat it.
  if (savings === 0) return { label: 'Moved to your wallet', critical: false, cents: result, sentence: null }
  const sentence: HeroSentence =
    left >= 0 ? { kind: 'savingsAndLeft', savings, left } : { kind: 'savingsLessOver', savings, over: -left }
  return { label: 'Moved to your wallet', critical: false, cents: result, sentence }
}

// ---------------------------------------------------------------------------------------------
// Money in and out (EXTRAS.md §1.3)

export interface LedgerLine {
  key: 'income' | 'fixed' | 'savings' | 'daily'
  operator: '+' | '−'
  label: string
  cents: Cents
}

export interface ReviewLedger {
  lines: LedgerLine[]
  result: { label: 'To your wallet' | 'From your wallet' | 'Left'; cents: Cents; critical: boolean }
}

/**
 * The month as a sum. Savings is no subtraction here: it went to the wallet with what was left
 * over, so the sum closes on the result, "To your wallet". A period before the wallet's start
 * closes on "Left" with the savings line, like Home's statement (hidden when 0).
 */
export function reviewLedger(review: Pick<MonthReview, 'income' | 'fixed' | 'savings' | 'daily' | 'left' | 'result'>, beforeWallet: boolean): ReviewLedger {
  const income: LedgerLine = { key: 'income', operator: '+', label: 'Income', cents: review.income }
  const fixed: LedgerLine = { key: 'fixed', operator: '−', label: 'Fixed costs', cents: review.fixed }
  const daily: LedgerLine = { key: 'daily', operator: '−', label: 'Daily spending', cents: review.daily }
  if (beforeWallet) {
    const savings: LedgerLine[] =
      review.savings === 0 ? [] : [{ key: 'savings', operator: '−', label: 'Savings', cents: review.savings }]
    return {
      lines: [income, fixed, ...savings, daily],
      result: { label: 'Left', cents: review.left, critical: review.left < 0 },
    }
  }
  return {
    lines: [income, fixed, daily],
    result: {
      label: review.result < 0 ? 'From your wallet' : 'To your wallet',
      cents: review.result,
      critical: review.result < 0,
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Where it went (EXTRAS.md §1.4)

export interface ChangeWords {
  /** The arrow before the words; never a colour (up is not red, down is not green). */
  arrow: 'up' | 'down' | null
  /** "8 % more than September", "Same as September", "New in October". */
  text: string
  /** The same for VoiceOver: "8 percent more than September". */
  spoken: string
}

/** Whole percents in the chosen number format: de-DE "8 %", en-US "8%"; cached per locale. */
const percentFormats = new Map<string, Intl.NumberFormat>()
const countFormats = new Map<string, Intl.NumberFormat>()

function cached(map: Map<string, Intl.NumberFormat>, locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let format = map.get(locale)
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, { ...options, numberingSystem: 'latn' })
    map.set(locale, format)
  }
  return format
}

/** A count in the chosen number format ("64", "1.204"): counts are SF Pro, never money. */
export function formatCount(count: number, locale: string): string {
  return cached(countFormats, locale, { maximumFractionDigits: 0 }).format(count)
}

/**
 * The change of one category against the previous period, rounded to whole percent (EXTRAS.md
 * §1.4). `change` is MonthReview's ratio, null when the previous period had none in it ("New").
 * Under half a percent either way is "Same as".
 */
export function changeWords(change: number | null, names: { period: string; previous: string }, locale: string): ChangeWords {
  if (change === null) {
    const text = `New in ${names.period}`
    return { arrow: null, text, spoken: text }
  }
  const percent = Math.round(Math.abs(change) * 100)
  if (percent === 0) {
    const text = `Same as ${names.previous}`
    return { arrow: null, text, spoken: text }
  }
  const more = change > 0
  const words = `${more ? 'more' : 'less'} than ${names.previous}`
  return {
    arrow: more ? 'up' : 'down',
    text: `${cached(percentFormats, locale, { style: 'percent', maximumFractionDigits: 0 }).format(percent / 100)} ${words}`,
    spoken: `${formatCount(percent, locale)} percent ${words}`,
  }
}

/**
 * Line 2 of the fold row, the folded categories in amount order: "Shopping and Transport",
 * "Shopping, Transport and Health", and past three "Shopping, Transport, Health and 2 more".
 */
export function foldNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length > 3) return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}
