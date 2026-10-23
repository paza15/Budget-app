import { dateLocaleFor, formatDate, monthName, parseISODate } from '@/domain/dates'
import type { MoneyFormat } from '@/domain/money'
import { formatPeriodName } from '@/domain/period'
import type { Cents, ISODate, SavingsGoal } from '@/domain/types'
import type { GoalState, WalletMovement } from '@/domain/wallet'
import { withTrueMinus } from '@/ui'

/**
 * The Wallet's words (docs/DESIGN.md §9.26 "Copy" and "Accessibility", docs/SPEC.md §3.12 to
 * §3.14). Pure functions over domain results: every figure comes from walletSummary; these only
 * put it into sentences and labels. Amounts go through the user's MoneyFormat, so they are masked
 * ("•••") while amounts are hidden; spoken labels say "amount hidden" instead.
 */

/** What screen readers hear for a hidden amount, inside a sentence. */
export const HIDDEN_WORDS = 'amount hidden'

/** An amount as text with a true minus ("−41,28 €"), or "•••" while amounts are hidden. */
export function moneyText(money: MoneyFormat, cents: Cents): string {
  return withTrueMinus(money.format(cents))
}

/** An amount for a spoken label: like moneyText, but "amount hidden" while amounts are hidden. */
export function spokenMoney(money: MoneyFormat, cents: Cents): string {
  return money.masked ? HIDDEN_WORDS : moneyText(money, cents)
}

/** A passbook figure without the unit: signed "+122,40" / "−200,00", or "•••". */
export function bookFigure(money: MoneyFormat, cents: Cents, signed: boolean): string {
  return withTrueMinus(money.format(cents, { symbol: false, sign: signed ? 'always' : 'auto' }))
}

/** A sentence around one amount, so the amount can be set apart (ink on the Home card). */
export interface Phrase {
  before: string
  /** Never negative: the words carry the direction. */
  amount: Cents
  after: string
}

/** The phrase as plain text, for labels and tests. */
export function phraseText(phrase: Phrase, money: MoneyFormat, spoken = false): string {
  const amount = spoken ? spokenMoney(money, phrase.amount) : moneyText(money, phrase.amount)
  return `${phrase.before}${amount}${phrase.after}`
}

/**
 * What the open period does to the wallet when it closes (§4.8 pending = savings + left):
 * "October adds 334,72 € when it closes" or "October takes 41,28 € out when it closes".
 */
export function pendingPhrase(periodName: string, result: Cents): Phrase {
  return result >= 0
    ? { before: `${periodName} adds `, amount: result, after: ' when it closes' }
    : { before: `${periodName} takes `, amount: 0 - result, after: ' out when it closes' }
}

/** What a closed period did: "September added 158,82 €" or "September took 41,28 € out". */
export function closedPhrase(periodName: string, result: Cents): Phrase {
  return result >= 0
    ? { before: `${periodName} added `, amount: result, after: '' }
    : { before: `${periodName} took `, amount: 0 - result, after: ' out' }
}

/** "Wallet, 631,22 €" or "Wallet, short by 146,50 €" (DESIGN.md §9.26 Accessibility). */
export function balanceLabel(money: MoneyFormat, balance: Cents): string {
  const amount = spokenMoney(money, Math.abs(balance))
  return balance < 0 ? `Wallet, short by ${amount}` : `Wallet, ${amount}`
}

/** The compact header's subtitle: "631,22 €" or "Short by 146,50 €" ("•••" while hidden). */
export function compactBalance(money: MoneyFormat, balance: Cents): string {
  if (money.masked) return moneyText(money, balance)
  return balance < 0 ? `Short by ${moneyText(money, 0 - balance)}` : moneyText(money, balance)
}

// ---------------------------------------------------------------------------------------------
// Goals

/** Where a goal stands (DESIGN.md §9.26 goal states). */
export type GoalPhase =
  | { kind: 'reached' }
  | { kind: 'filling'; toGo: Cents }
  | { kind: 'waiting'; after: string }
  | { kind: 'empty' }

/**
 * The state of the goal at `index` of the fill order: reached when it holds its target; filling
 * while it holds part of it; waiting ("Fills after {goal}") while it holds nothing and the goal
 * above it is not full yet; otherwise "Nothing set aside yet" (first in line, or the wallet ran
 * out exactly at the goal above).
 */
export function goalPhase(goals: readonly GoalState[], index: number): GoalPhase {
  const state = goals[index]
  if (state === undefined) return { kind: 'empty' }
  if (state.reached) return { kind: 'reached' }
  if (state.filled > 0) return { kind: 'filling', toGo: state.goal.target - state.filled }
  const above = index > 0 ? goals[index - 1] : undefined
  if (above !== undefined && !above.reached) return { kind: 'waiting', after: above.goal.name }
  return { kind: 'empty' }
}

/** The state words of line 3 without an amount ("Fills after Japan trip"), or null for "{x} to go". */
export function goalPhaseWords(phase: GoalPhase): string | null {
  switch (phase.kind) {
    case 'reached':
      return 'Reached'
    case 'waiting':
      return `Fills after ${phase.after}`
    case 'empty':
      return 'Nothing set aside yet'
    case 'filling':
      return null
  }
}

/**
 * The goal row's name: "Japan trip, 631,22 € of 1.200,00 €, 568,78 € to go", "…, reached",
 * "New bike, 0,00 € of 300,00 €, fills after Japan trip". Hidden amounts: "Japan trip, amounts
 * hidden, filling".
 */
export function goalLabel(money: MoneyFormat, state: GoalState, phase: GoalPhase): string {
  const { goal, filled } = state
  if (money.masked) {
    const words = phase.kind === 'filling' ? 'filling' : lowerFirst(goalPhaseWords(phase) ?? '')
    return `${goal.name}, amounts hidden, ${words}`
  }
  const held = `${moneyText(money, filled)} of ${moneyText(money, goal.target)}`
  const words = phase.kind === 'filling' ? `${moneyText(money, phase.toGo)} to go` : lowerFirst(goalPhaseWords(phase) ?? '')
  return `${goal.name}, ${held}, ${words}`
}

/** "fills after Japan trip": a sentence fragment keeps names as they are. */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/**
 * The goal sheet's footer for an active goal (DESIGN.md §9.26): what it holds, then its place in
 * the fill order. "631,22 € is set aside for it so far. It fills first, before New bike."
 */
export function goalSheetFooter(money: MoneyFormat, goals: readonly GoalState[], index: number): string {
  const state = goals[index]
  if (state === undefined) return ''
  const held = state.reached
    ? `It's reached: ${moneyText(money, state.filled)} is set aside for it.`
    : state.filled > 0
      ? `${moneyText(money, state.filled)} is set aside for it so far.`
      : 'Nothing is set aside for it yet.'
  const before = goals[index - 1]?.goal.name
  const after = goals[index + 1]?.goal.name
  let place = ''
  if (before === undefined && after !== undefined) place = ` It fills first, before ${after}.`
  else if (before !== undefined && after !== undefined) place = ` It fills after ${before}, before ${after}.`
  else if (before !== undefined) place = ` It fills after ${before}.`
  return held + place
}

/** "120,00 €, done 3 Oct" (the year is added when it is not this year). */
export function doneGoalSubtitle(money: MoneyFormat, goal: SavingsGoal, doneOn: ISODate, today: ISODate, locale: string): string {
  return `${moneyText(money, goal.target)}, done ${shortDate(doneOn, today, locale)}`
}

/** "3 Oct" / "Oct 3", with the year when it is not today's year: "3 Oct 2025" / "Oct 3, 2025". */
export function shortDate(date: ISODate, today: ISODate, locale: string): string {
  const short = formatDate(date, locale, 'short')
  const { y } = parseISODate(date)
  if (y === parseISODate(today).y) return short
  return dateLocaleFor(locale) === 'en-US' ? `${short}, ${y}` : `${short} ${y}`
}

/**
 * The announcement after a goal moved (DESIGN.md §9.26 Accessibility): "New bike fills first now",
 * or "Japan trip fills after New bike now".
 */
export function moveAnnouncement(name: string, above: string | undefined): string {
  return above === undefined ? `${name} fills first now` : `${name} fills after ${above} now`
}

// ---------------------------------------------------------------------------------------------
// The passbook

/** The date cell: the day and the short month, in the locale's order ("12 Sep" / "Sep 12"). */
export interface BookDate {
  day: string
  month: string
  dayFirst: boolean
}

export function bookDate(date: ISODate, locale: string): BookDate {
  const { m, d } = parseISODate(date)
  return { day: String(d), month: monthName(m, 'short'), dayFirst: dateLocaleFor(locale) !== 'en-US' }
}

/** "5 October" / "October 5", with the year when the book spans years ("5 October 2026"). */
export function spokenDate(date: ISODate, locale: string, withYear: boolean): string {
  const { y, m, d } = parseISODate(date)
  const us = dateLocaleFor(locale) === 'en-US'
  const text = us ? `${monthName(m)} ${d}` : `${d} ${monthName(m)}`
  if (!withYear) return text
  return us ? `${text}, ${y}` : `${text} ${y}`
}

/**
 * What the entry column says (DESIGN.md §9.26 movements): "Opening balance", "August closed",
 * the entry's note (else "Added" or "Taken out"), or "Paid: Laptop" (from walletSummary).
 */
export function movementText(movement: WalletMovement, startDay: number, locale: string): string {
  switch (movement.kind) {
    case 'opening':
      return 'Opening balance'
    case 'month':
      return movement.month === null ? 'Month closed' : `${formatPeriodName(movement.month, startDay, locale)} closed`
    case 'deposit':
      return movement.note.trim() === '' ? 'Added' : movement.note
    case 'withdrawal':
      return movement.note.trim() === '' ? 'Taken out' : movement.note
    case 'payment':
      return movement.note
  }
}

/**
 * The name of a passbook row's button, the whole line: "5 October, taken out, Moved to my savings
 * account, minus 200,00 €, balance 631,22 €" or "31 August, August closed, plus 122,40 €, balance
 * 622,40 €". Hidden amounts: "…, amounts hidden".
 */
export function movementLabel(
  money: MoneyFormat,
  movement: WalletMovement,
  text: string,
  locale: string,
  withYear: boolean,
): string {
  const parts = [spokenDate(movement.date, locale, withYear)]
  const kindWords = movement.kind === 'deposit' ? 'added' : movement.kind === 'withdrawal' ? 'taken out' : null
  if (kindWords !== null && text.toLowerCase() !== kindWords) parts.push(kindWords)
  parts.push(text)
  if (money.masked) {
    parts.push('amounts hidden')
  } else {
    parts.push(signedWords(money, movement.amount))
    parts.push(`balance ${signedWords(money, movement.balance, false)}`)
  }
  return parts.join(', ')
}

/** "plus 122,40 €", "minus 200,00 €", or "0,00 €"; without `plus`, positive amounts are bare. */
function signedWords(money: MoneyFormat, cents: Cents, plus = true): string {
  if (cents < 0) return `minus ${moneyText(money, 0 - cents)}`
  if (cents > 0 && plus) return `plus ${moneyText(money, cents)}`
  return moneyText(money, cents)
}

/** "Brought forward, balance 631,22 €. Show earlier movements" */
export function broughtForwardLabel(money: MoneyFormat, balance: Cents): string {
  const amount = money.masked ? HIDDEN_WORDS : signedWords(money, balance, false)
  return `Brought forward, balance ${amount}. Show earlier movements`
}

// ---------------------------------------------------------------------------------------------
// Entries

/** The toast after adding or taking out money: "Added 50,00 € to your wallet" (masked: "Added money …"). */
export function entryAddedMessage(money: MoneyFormat, kind: 'deposit' | 'withdrawal', amount: Cents): string {
  const what = money.masked ? 'money' : moneyText(money, amount)
  return kind === 'deposit' ? `Added ${what} to your wallet` : `Took ${what} out of your wallet`
}

/**
 * The toast after deleting an entry: "Deleted Birthday money from grandma", or without a note
 * "Deleted the 50,00 € you added on 12 Sep" ("the money" while amounts are hidden).
 */
export function entryDeletedMessage(
  money: MoneyFormat,
  entry: { kind: 'deposit' | 'withdrawal'; amount: Cents; date: ISODate; note: string },
  today: ISODate,
  locale: string,
): string {
  const note = entry.note.trim()
  if (note !== '') return `Deleted ${note}`
  const what = money.masked ? 'the money' : `the ${moneyText(money, entry.amount)}`
  const verb = entry.kind === 'deposit' ? 'added' : 'took out'
  return `Deleted ${what} you ${verb} on ${shortDate(entry.date, today, locale)}`
}

/** "Wallet after: 531,22 €", or below zero "Wallet after: short by 68,78 €". */
export function walletAfterText(money: MoneyFormat, after: Cents): string {
  return after < 0 ? `Wallet after: short by ${moneyText(money, 0 - after)}` : `Wallet after: ${moneyText(money, after)}`
}
