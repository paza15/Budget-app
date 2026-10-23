import type { MonthSummary } from '@/domain/summary'
import type { Cents } from '@/domain/types'
import { monthResult } from '@/domain/wallet'

/**
 * Home's hero in words and numbers (docs/SPEC.md §3.1 table, DESIGN.md §9.4): which row of the
 * state table applies, its label, the figure, the lines under it, the compact header's subtitle and
 * the one sentence VoiceOver reads. Pure: every amount comes from the month summary and is only
 * formatted here, through the functions the caller passes (masked or not).
 */

/** The rows of the SPEC §3.1 hero table. */
export type HeroKind =
  /** Current period without income: "Spent this month". */
  | 'noIncome'
  /** Current period, fixed costs and savings take all the income (available ≤ 0). */
  | 'fixedExceed'
  /** Current period, daily spending went past what was available. */
  | 'over'
  /** Current period, money left and more than one day to go. */
  | 'left'
  /** Current period, money left on its last day. */
  | 'lastDay'
  /** Past period without income: "Spent". */
  | 'pastSpent'
  /** Past period that ended with money left over. */
  | 'pastLeft'
  /** Past period that ended over budget. */
  | 'pastOver'
  /** Future period: what is planned for daily life. */
  | 'planned'
  /** Future period whose fixed costs and savings exceed its income. */
  | 'short'

export interface HeroTextOptions {
  /** An amount as shown: "234,72 €", or "•••" while amounts are hidden. */
  format(cents: Cents): string
  /** An amount as VoiceOver reads it: the amount, or "Amount hidden" while amounts are hidden. */
  speak(cents: Cents): string
  /** The period's name for sentences: "October". */
  name: string
  /** The wallet counts this period (it is not before the wallet's start, §4.8). */
  walletCounts: boolean
  /** Past periods: the seal's name, "Statement closed on 30 September" (DESIGN.md §3.2). */
  closedLabel?: string | null
}

export interface HeroText {
  kind: HeroKind
  /** "Left to spend", "Over budget by", "Planned", … */
  label: string
  /** 'critical': the label in critical ink after the octagon (over budget, short). */
  labelTone: 'default' | 'critical'
  /** The trailing status of the label row, current period only (DESIGN.md §14 note 3). */
  status: 'onTrack' | 'fast' | null
  /** The big figure, never negative: the label says "by". */
  figure: Cents
  figureTone: 'default' | 'critical'
  /**
   * Identifies what the figure stands for. A new identity is a new figure (the odometer never rolls
   * from "left" to "over budget", DESIGN.md §3.3); the same identity rolls when the value changes.
   */
  figureKey: string
  /** The sentence under the figure, or null. */
  sentence: string | null
  /** The sentence gives the amount per day (test id hero-per-day). */
  perDay: boolean
  /** "Today: 9,34 € left" or, in warning ink, "Today: 4,96 € over". */
  today: { text: string; over: boolean } | null
  /** "68,19 € more than planned by today" (pace status ahead), in warning ink. */
  ahead: string | null
  /** Where an overspend of the current period goes: the wallet line (§3.1, DESIGN.md §14 note 20). */
  wallet: string | null
  /** The button under the sentence. */
  action: 'addIncome' | 'reviewFixed' | null
  /** Shows the pace bar. */
  pace: boolean
  /**
   * Subtitle of the compact header: the figure with the state, "234,72 € left", "58,82 € left
   * over", "571,12 € planned", "41,28 € over budget". It never repeats the hero's label word for
   * word: the label must stay the only element on Home with that exact text.
   */
  compact: string
  /** The hero as one sentence, the way VoiceOver reads it (DESIGN.md §9.4). */
  speech: string
}

/** Which row of the hero table applies (SPEC §3.1), checked in the table's order. */
export function heroKind(summary: MonthSummary): HeroKind {
  const { timing, income, available, left, daysLeft } = summary
  if (timing === 'past') {
    if (income === 0) return 'pastSpent'
    return left < 0 ? 'pastOver' : 'pastLeft'
  }
  if (timing === 'future') return available < 0 ? 'short' : 'planned'
  if (income === 0) return 'noIncome'
  if (available <= 0) return 'fixedExceed'
  if (left < 0) return 'over'
  return daysLeft > 1 ? 'left' : 'lastDay'
}

/**
 * How far daily spending runs ahead of the plan (SPEC §3.1): daily − floor(available × dayIndex /
 * days), what was spent beyond an even share of the money for the days gone, today included.
 */
export function aheadBy(summary: MonthSummary): Cents {
  const { daily, available, days, dayIndex } = summary
  return daily - Math.floor((available * (dayIndex ?? 0)) / days)
}

/**
 * The line under an overspend of the current period, once the wallet counts it (SPEC §3.1). The
 * month's result (savings + left) is what the wallet gets when the period closes, so the line says
 * what actually happens to the wallet, as the Wallet card does (DESIGN.md §14 note 20):
 * - savings cover it: "Your savings cover it. October still adds 58,72 € to your wallet.";
 * - savings cover part of it: "Your savings cover part of it. 12,00 € comes out of your wallet when
 *   October closes.";
 * - no savings: the spec's "That comes out of your wallet when October closes."
 */
export function walletLine(summary: MonthSummary, name: string, format: (cents: Cents) => string): string {
  const result = monthResult(summary)
  if (result > 0) return `Your savings cover it. ${name} still adds ${format(result)} to your wallet.`
  if (result === 0) return 'Your savings cover it.'
  if (summary.savings > 0) {
    return `Your savings cover part of it. ${format(-result)} comes out of your wallet when ${name} closes.`
  }
  return `That comes out of your wallet when ${name} closes.`
}

/** −c without a negative zero. */
function negate(cents: Cents): Cents {
  return cents === 0 ? 0 : -cents
}

/** Joins sentences for VoiceOver, leaving out the missing ones. */
function speech(...parts: (string | null | false)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ')
}

/** Adds the full stop a spoken sentence needs, unless it has one. */
function sentenceOf(text: string): string {
  return text.endsWith('.') ? text : `${text}.`
}

/** The hero of one period (SPEC §3.1, DESIGN.md §9.4, §3.2). */
export function heroText(summary: MonthSummary, o: HeroTextOptions): HeroText {
  const kind = heroKind(summary)
  const { format: f, speak: v, name } = o
  const { left, available, daily, spent, days } = summary
  const closed = o.closedLabel ? sentenceOf(o.closedLabel) : null
  const base = {
    kind,
    labelTone: 'default' as const,
    status: null,
    figureTone: 'default' as const,
    figureKey: kind,
    sentence: null,
    perDay: false,
    today: null,
    ahead: null,
    wallet: null,
    action: null,
    pace: false,
  }

  switch (kind) {
    case 'left':
    case 'lastDay': {
      // left ≥ 0 here, so the amount per day is never negative.
      const perDay = Math.max(0, summary.perDay ?? 0)
      const todayLeft = summary.todayLeft ?? 0
      const fast = summary.pace.status === 'ahead'
      const sentence =
        kind === 'left' ? `About ${f(perDay)} a day for the next ${summary.daysLeft} days` : 'Last day of this month.'
      const spokenSentence =
        kind === 'left' ? `About ${v(perDay)} a day for the next ${summary.daysLeft} days.` : 'Last day of this month.'
      const todayOver = todayLeft < 0
      const ahead = fast ? aheadBy(summary) : 0
      return {
        ...base,
        // The last day keeps the figure's identity: it is still what is left to spend.
        figureKey: 'left',
        label: 'Left to spend',
        status: fast ? 'fast' : 'onTrack',
        figure: left,
        sentence,
        perDay: kind === 'left',
        today: todayOver
          ? { text: `Today: ${f(negate(todayLeft))} over`, over: true }
          : { text: `Today: ${f(todayLeft)} left`, over: false },
        ahead: fast ? `${f(ahead)} more than planned by today` : null,
        pace: true,
        compact: `${f(left)} left`,
        speech: speech(
          `Left to spend, ${v(left)}.`,
          fast ? 'Spending fast.' : 'On track.',
          spokenSentence,
          todayOver ? `Today, ${v(negate(todayLeft))} over.` : `Today, ${v(todayLeft)} left.`,
          fast && `${v(ahead)} more than planned by today.`,
        ),
      }
    }

    case 'over':
    case 'fixedExceed': {
      const sentence =
        kind === 'over'
          ? `Spent ${f(daily)} of ${f(available)} for daily life.`
          : "Fixed costs and savings are more than this month's income."
      const spokenSentence =
        kind === 'over' ? `Spent ${v(daily)} of ${v(available)} for daily life.` : sentence
      const wallet = o.walletCounts ? walletLine(summary, name, f) : null
      return {
        ...base,
        figureKey: 'over',
        label: 'Over budget by',
        labelTone: 'critical',
        figure: negate(left),
        figureTone: 'critical',
        sentence,
        wallet,
        action: kind === 'fixedExceed' ? 'reviewFixed' : null,
        pace: kind === 'over',
        compact: `${f(negate(left))} over budget`,
        speech: speech(
          `Over budget by ${v(negate(left))}.`,
          spokenSentence,
          o.walletCounts && walletLine(summary, name, v),
        ),
      }
    }

    case 'noIncome':
      return {
        ...base,
        label: 'Spent this month',
        figure: spent,
        action: 'addIncome',
        compact: `${f(spent)} spent`,
        speech: `Spent this month, ${v(spent)}.`,
      }

    case 'pastSpent':
      return {
        ...base,
        label: 'Spent',
        figure: spent,
        compact: `${f(spent)} spent`,
        speech: speech(`Spent, ${v(spent)}.`, closed),
      }

    case 'pastLeft':
    case 'pastOver': {
      const over = kind === 'pastOver'
      return {
        ...base,
        label: over ? 'Over budget by' : 'Left over',
        labelTone: over ? 'critical' : 'default',
        figure: over ? negate(left) : left,
        figureTone: over ? 'critical' : 'default',
        sentence: `You spent ${f(daily)} on daily life.`,
        pace: true,
        compact: over ? `${f(negate(left))} over budget` : `${f(left)} left over`,
        speech: speech(
          over ? `Over budget by ${v(negate(left))}.` : `Left over, ${v(left)}.`,
          closed,
          `You spent ${v(daily)} on daily life.`,
        ),
      }
    }

    case 'planned': {
      // Spending already entered for the period lowers the amount per day; it never goes below 0.
      const perDay = Math.max(0, summary.perDay ?? 0)
      return {
        ...base,
        label: 'Planned',
        figure: available,
        sentence: `${f(perDay)} a day across ${days} days`,
        perDay: true,
        compact: `${f(available)} planned`,
        speech: `Planned, ${v(available)}. ${v(perDay)} a day across ${days} days.`,
      }
    }

    case 'short':
      return {
        ...base,
        label: 'Short by',
        labelTone: 'critical',
        figure: negate(available),
        figureTone: 'critical',
        sentence: 'Fixed costs and savings are more than the income planned.',
        compact: `Short by ${f(negate(available))}`,
        speech: `Short by ${v(negate(available))}. Fixed costs and savings are more than the income planned.`,
      }
  }
}
