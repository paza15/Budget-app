import { compareISO } from '@/domain/dates'
import { periodOf } from '@/domain/period'
import { categoryDisplay, sortedCategories } from '@/domain/queries'
import { budgetAmount } from '@/domain/splits'
import { categoryKeyOf, UNCATEGORIZED_ID } from '@/domain/summary'
import type { Category, Cents, IconRef, ISODate, MonthKey, Transaction } from '@/domain/types'

/**
 * What the Daily screen lists (docs/SPEC.md §3.3, §4.6, §4.9): the category chips, the period's
 * expenses by day with their day totals, and the search across every period. Pure functions over
 * stored references; amounts come from the domain (budgetAmount), never recomputed here.
 */

/** The chip that shows every category. */
export const ALL = 'all'

export interface CategoryChip {
  value: string
  label: string
  icon?: IconRef
}

/** The ids of every category, archived ones included, for categoryKeyOf. */
export function knownIds(categories: readonly Category[]): Set<string> {
  return new Set(categories.map((category) => category.id))
}

/**
 * The category sub-tabs (§3.3): "All", the active categories offered for daily spending (kind
 * daily or both), and any other category with an expense in the period, filed the way byCategory
 * files it (categoryKeyOf), so a category whose expenses were all paid from the wallet still gets
 * its chip. In category order, Uncategorized last.
 */
export function categoryChips(
  periodTransactions: readonly Transaction[],
  categories: readonly Category[],
  map: Readonly<Record<string, Category>>,
): CategoryChip[] {
  const known = knownIds(categories)
  const used = new Set<string>()
  for (const tx of periodTransactions) {
    if (tx.kind === 'expense') used.add(categoryKeyOf(tx.categoryId, known))
  }
  const shown = sortedCategories(categories, { includeArchived: true }).filter(
    (category) => used.has(category.id) || (!category.archived && category.kind !== 'fixed'),
  )
  const chips: CategoryChip[] = [{ value: ALL, label: 'All' }]
  for (const category of shown) chips.push({ value: category.id, label: category.name, icon: category.icon })
  if (used.has(UNCATEGORIZED_ID)) {
    const display = categoryDisplay(UNCATEGORIZED_ID, map)
    chips.push({ value: UNCATEGORIZED_ID, label: display.name, icon: display.icon })
  }
  return chips
}

/** The period's expenses, newest first, under the chosen chip (categoryKeyOf, as byCategory counts them). */
export function expensesFor(periodTransactions: readonly Transaction[], filter: string, known: ReadonlySet<string>): Transaction[] {
  return periodTransactions.filter(
    (tx) => tx.kind === 'expense' && (filter === ALL || categoryKeyOf(tx.categoryId, known) === filter),
  )
}

export interface DayGroup {
  date: ISODate
  items: Transaction[]
  /** Σ budgetAmount: shares only, nothing for expenses paid from the wallet (§4.9). */
  total: Cents
  /** Every entry of the day was paid from the wallet: the header says "From your wallet". */
  fromWallet: boolean
}

/** Expenses (newest first) grouped by day, each with its day total. */
export function groupByDay(expenses: readonly Transaction[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const tx of expenses) {
    let group = groups.at(-1)
    if (group?.date !== tx.date) {
      group = { date: tx.date, items: [], total: 0, fromWallet: true }
      groups.push(group)
    }
    group.items.push(tx)
    group.total += budgetAmount(tx)
    group.fromWallet &&= tx.fromWallet
  }
  return groups
}

// ---------------------------------------------------------------------------------------------
// Search

/** Lower case without accents and extra spaces, so "cafe" finds "Café" and "Bar  with" finds "bar with". */
export function searchKey(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase()
}

export interface SearchGroup {
  month: MonthKey
  items: Transaction[]
  /** Σ budgetAmount of the matches in this period. */
  total: Cents
}

export interface SearchResult {
  groups: SearchGroup[]
  /** Matches in all, including any beyond `limit`. */
  count: number
}

/**
 * Expenses whose note or category name contains the query, across every period (§3.3), newest
 * first and grouped by period; at most `limit` of them are listed.
 */
export function searchExpenses(
  transactions: readonly Transaction[],
  query: string,
  map: Readonly<Record<string, Category>>,
  startDay: number,
  limit: number,
): SearchResult {
  const wanted = searchKey(query)
  if (wanted === '') return { groups: [], count: 0 }
  const names = new Map<string | null, string>()
  const nameOf = (id: string | null): string => {
    let name = names.get(id)
    if (name === undefined) {
      name = searchKey(categoryDisplay(id, map).name)
      names.set(id, name)
    }
    return name
  }
  const matches = transactions
    .filter((tx) => tx.kind === 'expense' && (searchKey(tx.note).includes(wanted) || nameOf(tx.categoryId).includes(wanted)))
    .toSorted((a, b) => compareISO(b.date, a.date) || b.createdAt - a.createdAt)
  const groups: SearchGroup[] = []
  for (const tx of matches.slice(0, Math.max(0, limit))) {
    const month = periodOf(tx.date, startDay)
    let group = groups.at(-1)
    if (group?.month !== month) {
      group = { month, items: [], total: 0 }
      groups.push(group)
    }
    group.items.push(tx)
    group.total += budgetAmount(tx)
  }
  return { groups, count: matches.length }
}
