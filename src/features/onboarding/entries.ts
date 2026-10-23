import { RECURRING_SUGGESTIONS, type RecurringSuggestion } from '@/domain/catalog'
import { BEFORE_APP_NOTE, MAX_LENGTHS } from '@/domain/constants'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { newId } from '@/domain/ids'
import { periodRange } from '@/domain/period'
import { baseAmountFor, isInRange } from '@/domain/recurring'
import type { Cents, EveryMonths, MonthKey, Recurring, Transaction } from '@/domain/types'
import { actions } from '@/store/actions'

/**
 * The rows onboarding edits and how they are written (docs/SPEC.md §3.9). Steps are idempotent:
 * every step lists what the data already holds for the current period, editing a row updates its
 * item, clearing its amount deletes it, and only rows the user adds create items, starting in the
 * current period. Reading is pure; the save functions call actions and run only in event handlers.
 */

/** The label of the first Money in row, and the name of income saved without one. */
export const DEFAULT_INCOME_NAME = 'Income'

/** The row Fixed costs always starts with (§3.9 step 4). */
export const RENT_NAME = 'Rent'

/** One recurring income in Money in. */
export interface IncomeRow {
  /** React key; stays the same while the row exists. */
  key: string
  /** The item it edits, or null for a row the user added. */
  id: string | null
  name: string
  amount: Cents | null
}

/** One fixed cost in Fixed costs: Rent, an existing cost or a suggestion the user added. */
export interface FixedRow {
  key: string
  id: string | null
  /** Also the amount field's label. */
  name: string
  categoryId: string
  everyMonths: EveryMonths
  amount: Cents | null
}

function inPeriod(kind: Recurring['kind'], recurring: readonly Recurring[], month: MonthKey): Recurring[] {
  return recurring
    .filter((item) => item.kind === kind && isInRange(item, month))
    .toSorted((a, b) => a.order - b.order || a.createdAt - b.createdAt)
}

/** A row the user adds ("Add another"); call it from the tap handler (a random key). */
export function newIncomeRow(name = ''): IncomeRow {
  return { key: newId(), id: null, name, amount: null }
}

/**
 * Money in: the recurring income of `month` as editable rows, or one row named "Income" when
 * there is none yet.
 */
export function incomeRows(recurring: readonly Recurring[], month: MonthKey): IncomeRow[] {
  const items = inPeriod('income', recurring, month)
  // A fixed key keeps rendering pure; rows added later get random ones.
  if (items.length === 0) return [{ key: 'income', id: null, name: DEFAULT_INCOME_NAME, amount: null }]
  return items.map((item) => ({ key: item.id, id: item.id, name: item.name, amount: baseAmountFor(item, month) }))
}

/**
 * Fixed costs: Rent first (bound to the first fixed cost in the Rent category, or a new row), then
 * the other fixed costs of `month`.
 */
export function fixedRows(recurring: readonly Recurring[], month: MonthKey): FixedRow[] {
  const items = inPeriod('expense', recurring, month)
  const rent = items.find((item) => item.categoryId === DEFAULT_CATEGORY_IDS.rent)
  const toRow = (item: Recurring): FixedRow => ({
    key: item.id,
    id: item.id,
    name: item.name,
    categoryId: item.categoryId ?? DEFAULT_CATEGORY_IDS.other,
    everyMonths: item.everyMonths,
    amount: baseAmountFor(item, month),
  })
  const rentRow: FixedRow = rent
    ? toRow(rent)
    : { key: 'rent', id: null, name: RENT_NAME, categoryId: DEFAULT_CATEGORY_IDS.rent, everyMonths: 1, amount: null }
  return [rentRow, ...items.filter((item) => item !== rent).map(toRow)]
}

/** A suggestion's row: its name, category and interval, never a price. */
export function suggestionRow(suggestion: RecurringSuggestion): FixedRow {
  return {
    key: newId(),
    id: null,
    name: suggestion.name,
    categoryId: suggestion.categoryId,
    everyMonths: suggestion.everyMonths,
    amount: null,
  }
}

/** The suggestions not already on the list (names compared without regard to case). */
export function openSuggestions(rows: readonly FixedRow[]): RecurringSuggestion[] {
  const taken = new Set(rows.map((row) => row.name.trim().toLocaleLowerCase()))
  return RECURRING_SUGGESTIONS.filter((suggestion) => !taken.has(suggestion.name.toLocaleLowerCase()))
}

/**
 * Money in's "Savings you already have" (§3.12): the wallet's opening balance, an empty field
 * while it is 0.
 */
export function openingSavings(opening: Cents): Cents | null {
  return opening === 0 ? null : opening
}

/**
 * The expense that stands for spending before the app (§3.9 step 5): dated the first day of
 * `month`, with the note "Before On a Budget". The first one wins when there are several.
 */
export function beforeAppEntry(
  transactions: readonly Transaction[],
  month: MonthKey,
  startDay: number,
): Transaction | null {
  const { start } = periodRange(month, startDay)
  return (
    transactions.find((tx) => tx.kind === 'expense' && tx.note === BEFORE_APP_NOTE && tx.date === start) ?? null
  )
}

// ---------------------------------------------------------------------------------------------
// Writing (event handlers only)

function itemById(id: string, recurring: readonly Recurring[]): Recurring | undefined {
  return recurring.find((item) => item.id === id)
}

/**
 * A changed amount applies to every period ('all', §3.9). An untouched row writes nothing, so an
 * item with an amount history (a restored backup) keeps it.
 */
function saveAmount(item: Recurring, amount: Cents, month: MonthKey): void {
  if (baseAmountFor(item, month) !== amount) actions.setRecurringAmount(item.id, amount, 'all')
}

/** Writes Money in. An empty name falls back to "Income", since every item needs one. */
export function saveIncomeRows(rows: readonly IncomeRow[], month: MonthKey, recurring: readonly Recurring[]): void {
  for (const row of rows) {
    const name = row.name.trim().slice(0, MAX_LENGTHS.recurring) || DEFAULT_INCOME_NAME
    const item = row.id === null ? undefined : itemById(row.id, recurring)
    if (item === undefined) {
      if (row.amount !== null) {
        actions.addRecurring({ kind: 'income', name, categoryId: null, amount: row.amount, startMonth: month })
      }
    } else if (row.amount === null) {
      actions.deleteRecurring(item.id)
    } else {
      if (item.name !== name) actions.updateRecurring(item.id, { name })
      saveAmount(item, row.amount, month)
    }
  }
}

/**
 * Writes "Savings you already have" (§3.12): the money saved before the app starts the wallet, as
 * its opening balance; an emptied field sets it back to 0. `opening` is the balance the data holds
 * now, so an unchanged field writes nothing.
 */
export function saveOpeningSavings(amount: Cents | null, opening: Cents): void {
  const next = amount ?? 0
  if (next !== opening) actions.setWalletOpening(next)
}

/**
 * Writes Fixed costs. Costs that come every few months (yearly insurance, the quarterly
 * Rundfunkbeitrag) are spread: the amount typed is the full charge, set aside a share at a time,
 * so the first month is not charged the whole of it.
 */
export function saveFixedRows(rows: readonly FixedRow[], month: MonthKey, recurring: readonly Recurring[]): void {
  for (const row of rows) {
    const item = row.id === null ? undefined : itemById(row.id, recurring)
    if (item === undefined) {
      if (row.amount !== null) {
        actions.addRecurring({
          kind: 'expense',
          name: row.name,
          categoryId: row.categoryId,
          amount: row.amount,
          everyMonths: row.everyMonths,
          spread: row.everyMonths > 1,
          startMonth: month,
        })
      }
    } else if (row.amount === null) {
      actions.deleteRecurring(item.id)
    } else {
      saveAmount(item, row.amount, month)
    }
  }
}

/**
 * Writes Spent so far: one expense in Other, dated the first day of the period, noted "Before On
 * a Budget". A second visit changes that expense; an empty amount removes it.
 */
export function saveSpentSoFar(
  amount: Cents | null,
  month: MonthKey,
  startDay: number,
  transactions: readonly Transaction[],
): void {
  const existing = beforeAppEntry(transactions, month, startDay)
  if (amount === null) {
    if (existing) actions.deleteTransaction(existing.id)
    return
  }
  if (existing) {
    if (existing.amount !== amount) actions.updateTransaction(existing.id, { amount })
    return
  }
  actions.addTransaction({
    kind: 'expense',
    amount,
    categoryId: DEFAULT_CATEGORY_IDS.other,
    date: periodRange(month, startDay).start,
    note: BEFORE_APP_NOTE,
  })
}
