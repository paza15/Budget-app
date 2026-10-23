import { compareISO } from '@/domain/dates'
import type { AppData, Cents, ISODate, Transaction } from '@/domain/types'

/**
 * Split bills and the budget amount (docs/SPEC.md §3.16, §4.9). An expense may carry splits: the
 * parts other people owe you. Only your share counts against the month, and an expense paid from
 * the wallet (§3.13) counts nothing against the month at all. Pure functions over the stored data;
 * results reference stored values, never copies of them.
 */

/** One open split: what one person still owes you for one expense. */
export interface OwedItem {
  transactionId: string
  splitId: string
  /** The expense's date. */
  date: ISODate
  /** The expense's note, as stored (may be empty). */
  note: string
  /** The split's amount. */
  amount: Cents
}

/** Everything one person still owes you. */
export interface OwedPerson {
  /** The latest spelling of the name among this person's open splits. */
  person: string
  /** Σ items' amounts. */
  total: Cents
  /** Newest expense first (date desc, then createdAt desc); one expense's splits in their order. */
  items: OwedItem[]
}

/** What other people owe you, as owedSummary reports it. */
export interface OwedSummary {
  /** Σ every open split. */
  total: Cents
  /** By total desc; equal totals keep the person with the most recent open split first. */
  people: OwedPerson[]
}

/** Code-unit order: the same on every device, unlike localeCompare. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

/**
 * Newest first, the order of the transaction lists (date desc, then createdAt desc), with the id
 * as the last resort so the result never depends on the order the data is stored in.
 */
function compareNewestFirst(a: Transaction, b: Transaction): number {
  return compareISO(b.date, a.date) || b.createdAt - a.createdAt || compareStrings(a.id, b.id)
}

/**
 * The name as splits group it: trimmed, whitespace collapsed, lower-cased (locale-independent), so
 * "Anna", " anna" and "ANNA" are one person.
 */
function personKey(person: string): string {
  return person.trim().replace(/\s+/gu, ' ').toLowerCase()
}

/** The expenses that have splits, newest first. Only expenses have splits (§4.9). */
function expensesWithSplits(data: AppData): Transaction[] {
  return data.transactions
    .filter((tx) => tx.kind === 'expense' && tx.splits.length > 0)
    .toSorted(compareNewestFirst)
}

/**
 * Your part of a transaction (§4.9): its amount minus every split that is not forgiven (open and
 * paid ones are the other person's part; a forgiven one counts as yours again), never below 0.
 * Only expenses have splits, so income is its whole amount.
 */
export function myShare(tx: Transaction): Cents {
  if (tx.kind !== 'expense') return tx.amount
  let others = 0
  for (const split of tx.splits) {
    if (split.status !== 'forgiven') others += split.amount
  }
  return Math.max(0, tx.amount - others)
}

/**
 * What a transaction counts against its month's budget (§4.9): myShare for an expense paid from
 * the budget, 0 for an expense paid from the wallet (`fromWallet`) and 0 for income. Daily
 * spending, today's spending, per day, pace, byCategory, the day series and the day totals all add
 * up this amount.
 */
export function budgetAmount(tx: Transaction): Cents {
  return tx.kind === 'expense' && !tx.fromWallet ? myShare(tx) : 0
}

/**
 * Open splits grouped by person (§3.16, §4.9). Names match ignoring case and extra whitespace; each
 * group shows the latest spelling (that of the newest expense by date, then createdAt). Paid and
 * forgiven splits are settled and left out. Splits of wallet-paid expenses count like any other.
 */
export function owedSummary(data: AppData): OwedSummary {
  const people = new Map<string, OwedPerson>()
  let total = 0
  for (const tx of expensesWithSplits(data)) {
    for (const split of tx.splits) {
      if (split.status !== 'open') continue
      const key = personKey(split.person)
      let person = people.get(key)
      if (person === undefined) {
        // Expenses come newest first, so the first spelling met is the latest one.
        person = { person: split.person.trim(), total: 0, items: [] }
        people.set(key, person)
      }
      person.total += split.amount
      person.items.push({ transactionId: tx.id, splitId: split.id, date: tx.date, note: tx.note, amount: split.amount })
      total += split.amount
    }
  }
  // A stable sort, so equal totals keep the order of each person's most recent open split.
  return { total, people: [...people.values()].toSorted((a, b) => b.total - a.total) }
}

/**
 * The names used in earlier splits (any status) for the split editor's suggestions: the most
 * recent first (by the expense's date, then createdAt), each name once ignoring case and extra
 * whitespace, in its latest spelling. With a `prefix`, only the names that start with it, ignoring
 * case, leading whitespace and repeated spaces (so "anna " matches "Anna Maria", not "Anna").
 */
export function personSuggestions(data: AppData, prefix = ''): string[] {
  const wanted = prefix.trimStart().replace(/\s+/gu, ' ').toLowerCase()
  const seen = new Set<string>()
  const names: string[] = []
  for (const tx of expensesWithSplits(data)) {
    for (const { person } of tx.splits) {
      const key = personKey(person)
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      if (key.startsWith(wanted)) names.push(person.trim())
    }
  }
  return names
}
