import { compareISO, formatDate, localDateOf } from '@/domain/dates'
import type { OwedItem, OwedPerson } from '@/domain/splits'
import type { Cents, ISODate, Transaction } from '@/domain/types'

/**
 * What "Owed to you" and its Home card show, as plain data (docs/SPEC.md §3.16, docs/design/
 * EXTRAS.md §2.6, §2.7). The open splits come grouped from owedSummary (useOwed); this module only
 * words them, lists the settled ones, and keeps items that just left on screen long enough to
 * collapse.
 */

/** Rows are keyed by transaction id plus split id: one person may owe several parts of one bill. */
export function owedItemKey(item: Pick<OwedItem, 'transactionId' | 'splitId'>): string {
  return `${item.transactionId}:${item.splitId}`
}

/** How many bills the items come from: two splits of one expense are one bill. */
export function billCount(items: readonly Pick<OwedItem, 'transactionId'>[]): number {
  return new Set(items.map((item) => item.transactionId)).size
}

function bills(count: number): string {
  return count === 1 ? '1 bill' : `${count} bills`
}

/** Under the screen's total: "2 people owe you for 2 bills.", "Max owes you for 1 bill." */
export function owedSentence(people: readonly OwedPerson[]): string {
  const count = billCount(people.flatMap((person) => person.items))
  const [only] = people
  if (people.length === 1 && only !== undefined) return `${only.person} owes you for ${bills(count)}.`
  return `${people.length} people owe you for ${bills(count)}.`
}

/**
 * Line 2 of a person on the Home card: what the bill is called when the person owes for one bill
 * ("Pizza night"), else "2 bills". `billName` names a bill (its note, or its category).
 */
export function personDetail(person: OwedPerson, billName: (item: OwedItem) => string): string {
  const count = billCount(person.items)
  const [first] = person.items
  return count === 1 && first !== undefined ? billName(first) : bills(count)
}

/** The rest of the Home card: "1 more person", "3 more people". */
export function morePeople(count: number): string {
  return count === 1 ? '1 more person' : `${count} more people`
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The first letter of a name for its coin ("M" for "max"), or its first emoji. */
export function initialOf(name: string): string {
  for (const { segment } of graphemes.segment(name.trim())) return segment.toUpperCase()
  return ''
}

// ---------------------------------------------------------------------------------------------
// Settled splits

/** A split that was paid back or forgiven, with the bill it belongs to. */
export interface SettledItem {
  key: string
  transactionId: string
  splitId: string
  person: string
  amount: Cents
  status: 'paid' | 'forgiven'
  /** When it was settled (epoch ms); null in data that never recorded it. */
  settledAt: number | null
  /** The bill: its date, note, category and whole amount. */
  date: ISODate
  note: string
  categoryId: string | null
  bill: Cents
}

/** Every settled split, the most recently settled first (then the newest bill). */
export function settledItems(transactions: readonly Transaction[]): SettledItem[] {
  const items: SettledItem[] = []
  for (const tx of transactions) {
    if (tx.kind !== 'expense') continue
    for (const split of tx.splits) {
      if (split.status === 'open') continue
      items.push({
        key: owedItemKey({ transactionId: tx.id, splitId: split.id }),
        transactionId: tx.id,
        splitId: split.id,
        person: split.person.trim(),
        amount: split.amount,
        status: split.status,
        settledAt: split.settledAt,
        date: tx.date,
        note: tx.note,
        categoryId: tx.categoryId,
        bill: tx.amount,
      })
    }
  }
  return items.toSorted(
    (a, b) =>
      (b.settledAt ?? Number.NEGATIVE_INFINITY) - (a.settledAt ?? Number.NEGATIVE_INFINITY) ||
      compareISO(b.date, a.date) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )
}

/**
 * Line 2 of a settled split: who settled it and when, "Max paid back Thu 1 Oct" or "Forgave Max
 * Sat 3 Oct". The list mixes people, so the name is said (the toasts word it the same way).
 */
export function settledText(item: Pick<SettledItem, 'person' | 'status' | 'settledAt'>, locale: string): string {
  const when = item.settledAt === null ? '' : ` ${formatDate(localDateOf(item.settledAt), locale, 'medium')}`
  return item.status === 'paid' ? `${item.person} paid back${when}` : `Forgave ${item.person}${when}`
}

// ---------------------------------------------------------------------------------------------
// What the screen draws: the open splits, plus those that just left, still collapsing

export interface OwedRowView {
  key: string
  item: OwedItem
  /** Paid back, forgiven or gone: it collapses, then leaves the view. */
  leaving: boolean
}

export interface OwedPersonView {
  /** The person's name as shown; unique, since owedSummary groups names ignoring case. */
  key: string
  person: string
  total: Cents
  items: OwedRowView[]
  /** The person's last item left: the whole section collapses with it. */
  leaving: boolean
}

/**
 * `next` with the entries of `previous` that are gone put back where they were, marked leaving: each
 * after the nearest earlier neighbour still drawn, or first.
 */
function keepLeaving<T extends { key: string; leaving: boolean }>(next: T[], previous: readonly T[]): T[] {
  const present = new Set(next.map((entry) => entry.key))
  const result = [...next]
  previous.forEach((entry, index) => {
    if (present.has(entry.key)) return
    let at = 0
    for (let before = index - 1; before >= 0; before -= 1) {
      const neighbour = previous[before]
      const found = neighbour === undefined ? -1 : result.findIndex((other) => other.key === neighbour.key)
      if (found >= 0) {
        at = found + 1
        break
      }
    }
    result.splice(at, 0, entry.leaving ? entry : { ...entry, leaving: true })
  })
  return result
}

/**
 * The people and items to draw (EXTRAS.md §2.9): the open splits of `people`, plus what was drawn
 * before and has gone since, marked leaving, so it can collapse in place. An item that comes back
 * (Undo) is simply open again. When nobody owes anything any more nothing is kept: the screen
 * changes to its empty state at once.
 */
export function owedView(people: readonly OwedPerson[], previous: readonly OwedPersonView[] = []): OwedPersonView[] {
  if (people.length === 0) return []
  const before = new Map(previous.map((person) => [person.key, person]))
  const next = people.map((person): OwedPersonView => {
    const rows = person.items.map((item) => ({ key: owedItemKey(item), item, leaving: false }))
    const old = before.get(person.person)
    return {
      key: person.person,
      person: person.person,
      total: person.total,
      // A section that was leaving as a whole and came back starts afresh.
      items: old === undefined || old.leaving ? rows : keepLeaving(rows, old.items),
      leaving: false,
    }
  })
  return keepLeaving(next, previous)
}

/** The view without a person whose section has finished collapsing. */
export function withoutPerson(view: readonly OwedPersonView[], personKey: string): OwedPersonView[] {
  return view.filter((person) => !(person.key === personKey && person.leaving))
}

/** The view without an item that has finished collapsing. */
export function withoutItem(view: readonly OwedPersonView[], personKey: string, itemKey: string): OwedPersonView[] {
  return view.map((person) =>
    person.key === personKey
      ? { ...person, items: person.items.filter((row) => !(row.key === itemKey && row.leaving)) }
      : person,
  )
}

/** Where focus goes after something left (EXTRAS.md §2.8), as a data-focus-key. */
export type FocusKey = `paid:${string}` | `person:${string}` | 'empty'

/** A person's header, else the next person's, else the one before, else the empty state. */
function nearestPerson(view: readonly OwedPersonView[], personKey: string): FocusKey {
  const staying = view.filter((person) => !person.leaving)
  const index = staying.findIndex((person) => person.key === personKey)
  const neighbour = staying[index + 1] ?? staying[index - 1]
  return neighbour === undefined ? 'empty' : `person:${neighbour.key}`
}

/**
 * After an item left: the next item's "Paid back", or the person's header when it was the last
 * one; when it was the person's only item the section goes too, and focus moves to the next
 * person (or the one before, or the empty state).
 */
export function focusAfterItem(view: readonly OwedPersonView[], personKey: string, itemKey: string): FocusKey {
  const person = view.find((entry) => entry.key === personKey)
  const rows = person?.items.filter((row) => !row.leaving) ?? []
  const index = rows.findIndex((row) => row.key === itemKey)
  const next = index >= 0 ? rows[index + 1] : undefined
  if (next !== undefined) return `paid:${next.key}`
  if (rows.length > 1) return `person:${personKey}`
  return nearestPerson(view, personKey)
}

/** After "Mark all as paid": the person's section goes, focus moves to the nearest person. */
export function focusAfterPerson(view: readonly OwedPersonView[], personKey: string): FocusKey {
  return nearestPerson(view, personKey)
}
