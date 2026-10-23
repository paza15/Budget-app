import { addMonths, compareISO, localDateOf, monthDiff } from '@/domain/dates'
import { periodOf, periodRange } from '@/domain/period'
import { UNCATEGORIZED_DISPLAY } from '@/domain/queries'
import { myShare } from '@/domain/splits'
import { computeMonthSummary, type MonthSummary } from '@/domain/summary'
import type { AppData, Cents, ISODate, MonthKey, SavingsGoal, Transaction } from '@/domain/types'

/**
 * The wallet (docs/SPEC.md §3.12 to §3.14, §4.8, §4.9): the money kept from month to month. Only
 * the opening balance, the first period, the entries made by hand and the goals are stored. The
 * balance, the passbook and what each goal holds are computed here from the data and `today`
 * alone (never the clock), so a result can be memoised per data object and day. Results reference
 * the stored goals, never copies.
 */

export type WalletMovementKind = 'opening' | 'month' | 'deposit' | 'withdrawal' | 'payment'

/** One row of the passbook. */
export interface WalletMovement {
  /**
   * Unique in the passbook and the same in every computation: 'opening', 'month:<YYYY-MM>',
   * 'entry:<entry id>' or 'payment:<transaction id>'.
   */
  key: string
  kind: WalletMovementKind
  /**
   * opening: the first day of the wallet's first period; month: the last day of the closed period;
   * deposit and withdrawal: the entry's date; payment: the expense's date.
   */
  date: ISODate
  /** The closed period of a 'month' movement, else null. */
  month: MonthKey | null
  /** Signed: positive into the wallet, negative out of it. */
  amount: Cents
  /** The running balance right after this movement. */
  balance: Cents
  /**
   * deposit and withdrawal: the entry's note; payment: "Paid: {note, or the category name when the
   * note is empty}"; opening and month: ''.
   */
  note: string
  /** The WalletEntry behind a deposit or withdrawal, else null. */
  entryId: string | null
  /** The wallet-paid expense behind a payment, else null. */
  transactionId: string | null
}

/** What one active goal holds of the wallet's balance. */
export interface GoalState {
  /** The stored goal. */
  goal: SavingsGoal
  /** 0..target: its part of the balance after the goals above it took theirs. */
  filled: Cents
  /** filled ≥ target. */
  reached: boolean
}

/** How the balance fills the goals (fillGoals). */
export interface GoalFill {
  /** Active goals (doneAt null) in fill order: by `order`, then createdAt, then id. */
  goals: GoalState[]
  /** Done goals, most recently done first, then by `order`. They take nothing. */
  doneGoals: SavingsGoal[]
  /** The balance minus what the active goals hold: "Not set aside". Negative when the balance is. */
  free: Cents
}

export interface WalletSummary {
  /** The first period whose result flows in (walletStart). */
  start: MonthKey
  /** Opening + every closed period's result + deposits − withdrawals − payments, up to today. */
  balance: Cents
  /** See GoalFill.free. */
  free: Cents
  /** The current period's result, which moves in when it closes; null while it is before `start`. */
  pending: Cents | null
  /** See GoalFill.goals. */
  goals: GoalState[]
  /** See GoalFill.doneGoals. */
  doneGoals: SavingsGoal[]
  /** The passbook, oldest first; the last one's balance is `balance`. */
  movements: WalletMovement[]
}

/** A movement before its running balance is known, with the entry time that orders a day's entries. */
interface MovementDraft {
  movement: Omit<WalletMovement, 'balance'>
  /** Epoch ms of the entry or expense; 0 for opening and month rows, which a day's rank orders. */
  createdAt: number
}

/** The order of movements on one date: the opening, then entries and payments, then the closing. */
const SAME_DAY_RANK: Readonly<Record<WalletMovementKind, number>> = {
  opening: 0,
  deposit: 1,
  withdrawal: 1,
  payment: 1,
  month: 2,
}

/** Code-unit order: the same on every device, unlike localeCompare. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

/** By date; on one date by SAME_DAY_RANK, then createdAt, then key, so the order never depends on storage order. */
function compareDrafts(a: MovementDraft, b: MovementDraft): number {
  return (
    compareISO(a.movement.date, b.movement.date) ||
    SAME_DAY_RANK[a.movement.kind] - SAME_DAY_RANK[b.movement.kind] ||
    a.createdAt - b.createdAt ||
    compareStrings(a.movement.key, b.movement.key)
  )
}

/** Fill order: by `order`, then createdAt, then id (code units). */
function compareFillOrder(a: SavingsGoal, b: SavingsGoal): number {
  return a.order - b.order || a.createdAt - b.createdAt || compareStrings(a.id, b.id)
}

/**
 * Every goal, active and done, in fill order (§3.14): by `order`, then createdAt, then id in code
 * units, as fillGoals fills the active ones. A done goal keeps the place its `order` gives it,
 * which is where "Put back" returns it, so this is the full list to hand actions.reorderGoals
 * without moving done goals. A new array of the stored goals; the input is left as it is.
 */
export function goalsInFillOrder(goals: readonly SavingsGoal[]): SavingsGoal[] {
  return goals.toSorted(compareFillOrder)
}

/** Most recently done first, then fill order. */
function compareDone(a: SavingsGoal, b: SavingsGoal): number {
  return (b.doneAt ?? 0) - (a.doneAt ?? 0) || compareFillOrder(a, b)
}

/**
 * A period's result (§4.8): income − fixed − daily, which is its savings plus what was left (or
 * minus an overspend). Daily spending counts at budget amounts, so wallet-paid expenses are not in
 * it; they leave the wallet as payments instead.
 */
export function monthResult(summary: MonthSummary): Cents {
  return summary.income - summary.fixed - summary.daily
}

/**
 * The first period whose result flows into the wallet (§4.8): `wallet.startMonth`, or the period
 * the app was set up in (the local date of settings.createdAt, with the current start day). Not
 * firstPeriod: fixed costs backdated before the app was used must not drain the wallet.
 */
export function walletStart(data: AppData): MonthKey {
  return data.wallet.startMonth ?? periodOf(localDateOf(data.settings.createdAt), data.settings.monthStartDay)
}

/**
 * Fills the goals from `balance` like a waterfall (§3.14, §4.9): the active goals (doneAt null) in
 * fill order each take what they need up to their target from what the goals above them left, so
 * when the balance shrinks the lowest goals empty first. A negative balance fills nothing.
 * Tests: 63122 over targets [120000, 30000] → [63122, 0], free 0; 200000 → [120000, 30000], free
 * 50000; −5000 → [0, 0], free −5000.
 */
export function fillGoals(balance: Cents, goals: readonly SavingsGoal[]): GoalFill {
  let remaining = Math.max(0, balance)
  let held = 0
  const states: GoalState[] = []
  for (const goal of goals.filter((g) => g.doneAt === null).toSorted(compareFillOrder)) {
    const filled = Math.min(Math.max(0, goal.target), remaining)
    remaining -= filled
    held += filled
    states.push({ goal, filled, reached: filled >= goal.target })
  }
  const doneGoals = goals.filter((g) => g.doneAt !== null).toSorted(compareDone)
  return { goals: states, doneGoals, free: balance - held }
}

/** One period's result, as its month summary gives it. */
interface PeriodResult {
  month: MonthKey
  result: Cents
}

/**
 * monthResult of every period from `first` to `last` inclusive, oldest first; [] when `last` comes
 * before `first`. Each transaction is filed under its period once and every summary reads only its
 * own period's transactions, which is exactly what computeMonthSummary over all of them gives, at
 * a cost that grows with transactions plus periods rather than their product.
 */
function periodResults(data: AppData, first: MonthKey, last: MonthKey, today: ISODate): PeriodResult[] {
  const count = monthDiff(first, last) + 1
  if (count <= 0) return []
  const startDay = data.settings.monthStartDay
  const from = periodRange(first, startDay).start
  const to = periodRange(last, startDay).end

  const byPeriod = new Map<MonthKey, Transaction[]>()
  for (const tx of data.transactions) {
    if (compareISO(tx.date, from) < 0 || compareISO(tx.date, to) > 0) continue
    const month = periodOf(tx.date, startDay)
    const list = byPeriod.get(month)
    if (list === undefined) byPeriod.set(month, [tx])
    else list.push(tx)
  }

  return Array.from({ length: count }, (_, i) => {
    const month = addMonths(first, i)
    const own: AppData = { ...data, transactions: byPeriod.get(month) ?? [] }
    return { month, result: monthResult(computeMonthSummary(own, month, today)) }
  })
}

/** "Paid: {note}", or the category's name when the note is empty ("Uncategorized" for unknown ids). */
function paymentNote(tx: Transaction, categoryNames: ReadonlyMap<string, string>): string {
  const note = tx.note.trim()
  if (note !== '') return `Paid: ${note}`
  const name = tx.categoryId === null ? undefined : categoryNames.get(tx.categoryId)
  return `Paid: ${name ?? UNCATEGORIZED_DISPLAY.name}`
}

/**
 * The wallet as of `today` (§4.8, §4.9):
 * - start = walletStart(data); the closed periods are start ≤ p < the current period.
 * - Movements: the opening balance (when above 0) on the first day of `start`; each closed
 *   period's result on its last day (results of 0 too, so the book has no gaps); deposits and
 *   withdrawals dated up to today; and payments: every wallet-paid expense dated up to today takes
 *   out myShare on its date. Oldest first; on one date the opening comes first, then entries and
 *   payments by createdAt, then the closing. Each carries the running balance after it.
 * - balance = opening + Σ closed results + Σ deposits − Σ withdrawals − Σ payments.
 * - pending = the current period's result when the current period ≥ start, else null.
 * - Goals fill from the balance (fillGoals); free is what they leave.
 * Pure: depends on `data` and `today` only. Throws a RangeError for an invalid date or start day.
 */
export function walletSummary(data: AppData, today: ISODate): WalletSummary {
  const startDay = data.settings.monthStartDay
  const start = walletStart(data)
  const current = periodOf(today, startDay)
  const { opening, entries, goals } = data.wallet
  const drafts: MovementDraft[] = []

  if (opening > 0) {
    drafts.push({
      movement: {
        key: 'opening',
        kind: 'opening',
        date: periodRange(start, startDay).start,
        month: null,
        amount: opening,
        note: '',
        entryId: null,
        transactionId: null,
      },
      createdAt: 0,
    })
  }

  // start … current: empty while the current period is before start, else the closed periods and,
  // last, the current one, whose result is still pending.
  const results = periodResults(data, start, current, today)
  const pending = results.pop()?.result ?? null
  for (const { month, result } of results) {
    drafts.push({
      movement: {
        key: `month:${month}`,
        kind: 'month',
        date: periodRange(month, startDay).end,
        month,
        amount: result,
        note: '',
        entryId: null,
        transactionId: null,
      },
      createdAt: 0,
    })
  }

  for (const entry of entries) {
    if (compareISO(entry.date, today) > 0) continue
    drafts.push({
      movement: {
        key: `entry:${entry.id}`,
        kind: entry.kind,
        date: entry.date,
        month: null,
        amount: entry.kind === 'deposit' ? entry.amount : 0 - entry.amount,
        note: entry.note,
        entryId: entry.id,
        transactionId: null,
      },
      createdAt: entry.createdAt,
    })
  }

  const categoryNames = new Map(data.categories.map((category) => [category.id, category.name]))
  for (const tx of data.transactions) {
    if (tx.kind !== 'expense' || !tx.fromWallet || compareISO(tx.date, today) > 0) continue
    drafts.push({
      movement: {
        key: `payment:${tx.id}`,
        kind: 'payment',
        date: tx.date,
        month: null,
        // 0 − share rather than −share, so a fully split expense takes out 0, not −0.
        amount: 0 - myShare(tx),
        note: paymentNote(tx, categoryNames),
        entryId: null,
        transactionId: tx.id,
      },
      createdAt: tx.createdAt,
    })
  }

  let balance = 0
  const movements = drafts.toSorted(compareDrafts).map(({ movement }): WalletMovement => {
    balance += movement.amount
    return { ...movement, balance }
  })

  const fill = fillGoals(balance, goals)
  return { start, balance, free: fill.free, pending, goals: fill.goals, doneGoals: fill.doneGoals, movements }
}
