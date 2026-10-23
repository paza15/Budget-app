import { LS_KEYS, MAX_CENTS, MAX_LENGTHS } from '@/domain/constants'
import { compareISO, isValidISODate } from '@/domain/dates'
import { newId } from '@/domain/ids'
import {
  applyKeypadKey,
  centsToKeypadString,
  keypadStringToCents,
  type CurrencyDigits,
  type KeypadKey,
} from '@/domain/money'
import { isRecord, ownValue } from '@/domain/normalize'
import { categoryDisplay, lastUsedCategoryId, sortedCategories } from '@/domain/queries'
import { myShare } from '@/domain/splits'
import type { AppData, Category, Cents, IconRef, ISODate, Split, SplitStatus, Transaction, TxKind } from '@/domain/types'
import { walletSummary } from '@/domain/wallet'
import type { NewSplit } from '@/store/actions'

/**
 * The transaction sheet's form (docs/SPEC.md §3.4, §3.13, §3.16, §5.10; docs/design/EXTRAS.md
 * §2.4) as plain data and pure functions: the keypad's pristine rule, the split editor's even
 * split, what is saved, whether anything changed, and the draft kept in localStorage. The sheet
 * holds the state and calls these from its event handlers.
 */

/** One person in the split editor. */
export interface SplitRow {
  /** React key: the stored split's id when editing, a new id for a person added now. */
  key: string
  /** The stored split this row edits, or null for a person added now. */
  id: string | null
  /** As typed: 1..24 characters once trimmed when saved. */
  person: string
  /** What this person owes you; null while the field is empty. */
  amount: Cents | null
  /** New rows are open. Settled ones (paid back, forgiven) are shown but not edited here. */
  status: SplitStatus
}

export interface TxForm {
  /** The keypad string (§4.1): "", "3", "3.", "3.5". */
  keys: string
  /** The keypad shows a stored amount: the first digit or separator replaces it, backspace edits it (§3.4). */
  pristine: boolean
  /** Expenses only; null for income. */
  categoryId: string | null
  note: string
  date: ISODate
  /** Expenses only (§3.13). */
  fromWallet: boolean
  /** Expenses only (§3.16). */
  splits: SplitRow[]
  /**
   * The split follows "Split evenly" (EXTRAS.md §2.4): adding a person or changing the bill splits
   * it again. Typing an amount by hand ends that.
   */
  even: boolean
  /** "All categories" was tapped: the fixed-only categories join the chips (§3.4). */
  showAllCategories: boolean
}

/** The route of a new item, as a draft remembers it (the shell reopens drafts with it). */
export interface DraftRoute {
  name: 'transaction'
  kind?: TxKind
  categoryId?: string
}

// ---------------------------------------------------------------------------------------------
// Opening the sheet

/**
 * The category a new expense starts with (§3.4): the one passed in (a Daily chip, category detail)
 * when it is an active category, else the last one used, else the first daily category.
 */
export function defaultCategoryId(data: AppData, wanted: string | undefined): string | null {
  const active = data.categories.filter((category) => !category.archived)
  if (wanted !== undefined && active.some((category) => category.id === wanted)) return wanted
  const last = lastUsedCategoryId(data)
  if (last !== null) return last
  const offered = sortedCategories(data.categories, { kind: 'daily' })
  return (offered.find((category) => category.kind === 'daily') ?? offered[0] ?? sortedCategories(data.categories)[0])?.id ?? null
}

/** A new expense or one-off income: no amount, dated today, paid from the budget, not split. */
export function newForm(data: AppData, kind: TxKind, wantedCategoryId: string | undefined, today: ISODate): TxForm {
  return {
    keys: '',
    pristine: false,
    categoryId: kind === 'income' ? null : defaultCategoryId(data, wantedCategoryId),
    note: '',
    date: today,
    fromWallet: false,
    splits: [],
    even: true,
    showAllCategories: false,
  }
}

/** A stored transaction, ready to edit: the keypad starts pristine (§3.4). */
export function editForm(tx: Transaction, digits: CurrencyDigits): TxForm {
  const splits = tx.splits.map(
    (split): SplitRow => ({ key: split.id, id: split.id, person: split.person, amount: split.amount, status: split.status }),
  )
  const amount = tx.amount
  return {
    keys: centsToKeypadString(amount, digits),
    pristine: amount > 0,
    categoryId: tx.categoryId,
    note: tx.note,
    date: tx.date,
    fromWallet: tx.fromWallet,
    splits,
    even: isEvenSplit(splits, amount),
    showAllCategories: false,
  }
}

// ---------------------------------------------------------------------------------------------
// Amount and keypad

export function formAmount(form: TxForm): Cents {
  return keypadStringToCents(form.keys)
}

/**
 * One keypad press (§3.4, §4.1). On a pristine keypad the first digit or separator replaces the
 * stored amount and backspace edits it. The split follows the new bill while it is even.
 */
export function pressKey(form: TxForm, key: KeypadKey, digits: CurrencyDigits): TxForm {
  const from = form.pristine && key !== 'back' ? '' : form.keys
  const keys = applyKeypadKey(from, key, digits)
  if (keys === form.keys && !form.pristine) return form
  return resplit({ ...form, keys, pristine: false })
}

/** Fills note and amount from a suggestion chip; the amount is then pristine, like a stored one. */
export function applySuggestion(form: TxForm, note: string, amount: Cents, digits: CurrencyDigits): TxForm {
  return resplit({ ...form, note, keys: centsToKeypadString(amount, digits), pristine: true })
}

// ---------------------------------------------------------------------------------------------
// Splits (EXTRAS.md §2.3, §2.4)

/** The name as splits compare it: trimmed, whitespace collapsed, lower-cased. */
export function personKey(person: string): string {
  return person.trim().replace(/\s+/gu, ' ').toLowerCase()
}

function isOpen(row: SplitRow): boolean {
  return row.status === 'open'
}

/** What every person owes together, whatever the status: the store checks this against the bill. */
export function owedTotal(rows: readonly SplitRow[]): Cents {
  let total = 0
  for (const row of rows) total += row.amount ?? 0
  return total
}

/**
 * The split made even: each open person owes floor(rest / (n + 1)), where rest is the bill minus
 * what settled splits already took, and the remainder stays with you (32,00 € with two people:
 * 10,66 € each, your share 10,68 €). Settled rows keep their amounts.
 */
export function evenSplits(rows: readonly SplitRow[], amount: Cents): SplitRow[] {
  const open = rows.filter(isOpen)
  if (open.length === 0) return [...rows]
  const settled = owedTotal(rows.filter((row) => !isOpen(row)))
  const each = Math.max(0, Math.floor((amount - settled) / (open.length + 1)))
  return rows.map((row) => (isOpen(row) && row.amount !== each ? { ...row, amount: each } : row))
}

/** True when the open people owe exactly what "Split evenly" would give them. */
export function isEvenSplit(rows: readonly SplitRow[], amount: Cents): boolean {
  if (!rows.some(isOpen)) return true
  const even = evenSplits(rows, amount)
  return rows.every((row, i) => row.amount === even[i]?.amount)
}

/** The split again, evenly, while the form follows the even split. */
function resplit(form: TxForm): TxForm {
  if (!form.even || !form.splits.some(isOpen)) return form
  const splits = evenSplits(form.splits, formAmount(form))
  return splits.every((row, i) => row === form.splits[i]) ? form : { ...form, splits }
}

/** "Split evenly": the even split, now and from now on. */
export function splitEvenly(form: TxForm): TxForm {
  return resplit({ ...form, even: true })
}

/**
 * Adds a person under `key` (EXTRAS.md §2.4): empty for "Add person", named for a suggestion chip.
 * While the split is even, or empty, everyone is split evenly again. The caller makes the key
 * (newRowKey), so a state updater that runs twice adds the same row.
 */
export function addPerson(form: TxForm, key: string, person = ''): TxForm {
  const row: SplitRow = { key, id: null, person: person.slice(0, MAX_LENGTHS.name), amount: null, status: 'open' }
  const even = form.even || form.splits.length === 0
  return resplit({ ...form, even, splits: [...form.splits, row] })
}

/** A key for a person added now. */
export function newRowKey(): string {
  return newId()
}

/** Gives the person who is being typed (`key`) a suggested name, then tidies the split. */
export function completePerson(form: TxForm, key: string, person: string): TxForm {
  return tidyPerson(setPersonName(form, key, person), key)
}

export function setPersonName(form: TxForm, key: string, person: string): TxForm {
  const name = person.slice(0, MAX_LENGTHS.name)
  return { ...form, splits: form.splits.map((row) => (row.key === key ? { ...row, person: name } : row)) }
}

/** An amount typed by hand: the split stops following the even split. */
export function setPersonAmount(form: TxForm, key: string, amount: Cents | null): TxForm {
  return {
    ...form,
    even: false,
    splits: form.splits.map((row) => (row.key === key ? { ...row, amount } : row)),
  }
}

/** Removes a person; removing the last one removes the split, and the next one starts even again. */
export function removePerson(form: TxForm, key: string): TxForm {
  const splits = form.splits.filter((row) => row.key !== key)
  if (splits.length === form.splits.length) return form
  return resplit({ ...form, splits, even: splits.length === 0 ? true : form.even })
}

/**
 * When a name field is left (EXTRAS.md §2.4): a row left without a name goes, and a name that is
 * already in the split (ignoring case) merges into that row, amounts added.
 */
export function tidyPerson(form: TxForm, key: string): TxForm {
  const row = form.splits.find((item) => item.key === key)
  if (row === undefined || !isOpen(row)) return form
  const name = personKey(row.person)
  if (name === '') return removePerson(form, key)
  const same = form.splits.find((item) => item.key !== key && isOpen(item) && personKey(item.person) === name)
  if (same === undefined) return form
  const merged: SplitRow = { ...same, amount: (same.amount ?? 0) + (row.amount ?? 0) }
  const splits = form.splits.filter((item) => item.key !== key).map((item) => (item.key === same.key ? merged : item))
  return resplit({ ...form, splits })
}

/**
 * The splits as the store takes them (§4.9): settled ones as they are (by id), open ones with a
 * name and an amount above 0, each name once (amounts of the same name added together).
 */
export function splitsToSave(rows: readonly SplitRow[]): NewSplit[] {
  const saved: NewSplit[] = []
  const byName = new Map<string, NewSplit>()
  for (const row of rows) {
    const person = row.person.trim().slice(0, MAX_LENGTHS.name)
    const amount = row.amount ?? 0
    if (!isOpen(row)) {
      if (row.id !== null) saved.push({ id: row.id, person: person === '' ? row.person : person, amount })
      continue
    }
    if (person === '' || amount <= 0) continue
    const key = personKey(person)
    const earlier = byName.get(key)
    if (earlier !== undefined) {
      earlier.amount += amount
      continue
    }
    const split: NewSplit = row.id === null ? { person, amount } : { id: row.id, person, amount }
    byName.set(key, split)
    saved.push(split)
  }
  return saved
}

/** Whether what others owe fits the bill (§3.16: the splits never exceed the amount). */
export function splitsFit(form: TxForm): boolean {
  return owedTotal(form.splits) <= formAmount(form)
}

// ---------------------------------------------------------------------------------------------
// The entry as it would be saved

/**
 * The form as a Transaction, to ask the domain what it would count: myShare, budgetAmount and
 * the wallet's balance (§4.8, §4.9). Rows with an amount count at once, before their name is
 * typed, so "Your share" follows "Add person" straight away.
 */
export function draftTransaction(form: TxForm, kind: TxKind, original: Transaction | null): Transaction {
  const splits: Split[] =
    kind === 'income'
      ? []
      : form.splits
          .filter((row) => (row.amount ?? 0) > 0)
          .map((row) => ({
            id: row.id ?? row.key,
            person: row.person.trim(),
            amount: row.amount ?? 0,
            status: row.status,
            settledAt: null,
          }))
  return {
    id: original?.id ?? 'draft',
    kind,
    amount: formAmount(form),
    categoryId: kind === 'income' ? null : form.categoryId,
    date: form.date,
    note: form.note.trim(),
    fromWallet: kind === 'expense' && form.fromWallet,
    splits,
    createdAt: original?.createdAt ?? 0,
    updatedAt: original?.updatedAt ?? 0,
  }
}

/**
 * The wallet's balance once this entry is saved (§3.13, DESIGN.md §9.26 "Wallet after"): the
 * domain's balance for the data with the entry in place (an edit replaces the stored one, which
 * counts its old amount back in first). A payment dated after today leaves the wallet on its day;
 * the line shows the wallet after it all the same.
 */
export function walletAfter(data: AppData, today: ISODate, original: Transaction | null, draft: Transaction): Cents {
  const transactions =
    original === null ? [...data.transactions, draft] : data.transactions.map((tx) => (tx.id === original.id ? draft : tx))
  const { balance } = walletSummary({ ...data, transactions }, today)
  return draft.fromWallet && compareISO(draft.date, today) > 0 ? balance - myShare(draft) : balance
}

// ---------------------------------------------------------------------------------------------
// Category chips (§3.4)

/** The last chip, "All categories": it adds the categories kept for fixed costs. */
export const ALL_CATEGORIES = '__all_categories__'

export interface CategoryChoice {
  value: string
  label: string
  icon?: IconRef
}

/**
 * The category chips of an expense, in category order: the active categories offered for daily
 * spending (kind daily or both), then "All categories" while fixed-only ones are left out. The
 * chosen category always has its chip, even when it is fixed-only, archived or deleted
 * ("Uncategorized").
 */
export function categoryChoices(
  categories: readonly Category[],
  selected: string | null,
  showAll: boolean,
  map: Readonly<Record<string, Category>>,
): CategoryChoice[] {
  const active = sortedCategories(categories)
  const offered = active.filter(
    (category) => showAll || category.kind !== 'fixed' || category.id === selected,
  )
  const chosen = selected === null ? undefined : categories.find((category) => category.id === selected)
  if (chosen !== undefined && chosen.archived) {
    offered.push(chosen)
    offered.sort((a, b) => a.order - b.order)
  }
  const choices: CategoryChoice[] = offered.map((category) => ({ value: category.id, label: category.name, icon: category.icon }))
  if (selected !== null && chosen === undefined) {
    const display = categoryDisplay(selected, map)
    choices.push({ value: selected, label: display.name, icon: display.icon })
  }
  if (!showAll && active.some((category) => category.kind === 'fixed' && category.id !== selected)) {
    choices.push({ value: ALL_CATEGORIES, label: 'All categories' })
  }
  return choices
}

function sameSplits(a: readonly SplitRow[], b: readonly SplitRow[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, i) => {
      const other = b[i]
      return (
        other !== undefined &&
        row.person.trim() === other.person.trim() &&
        (row.amount ?? 0) === (other.amount ?? 0) &&
        row.status === other.status
      )
    })
  )
}

/** Unsaved changes (§5.10): anything that would be saved differs from what the sheet opened with. */
export function hasChanges(form: TxForm, initial: TxForm): boolean {
  return (
    formAmount(form) !== formAmount(initial) ||
    form.categoryId !== initial.categoryId ||
    form.note.trim() !== initial.note.trim() ||
    form.date !== initial.date ||
    form.fromWallet !== initial.fromWallet ||
    !sameSplits(form.splits, initial.splits)
  )
}

// ---------------------------------------------------------------------------------------------
// Drafts (§5.10 rule 4)

/** The draft's route for a new item; null when editing, which keeps no draft. */
export function draftRouteOf(route: { id?: string; kind?: TxKind; categoryId?: string }): DraftRoute | null {
  if (route.id !== undefined) return null
  return {
    name: 'transaction',
    ...(route.kind === undefined ? {} : { kind: route.kind }),
    ...(route.categoryId === undefined ? {} : { categoryId: route.categoryId }),
  }
}

/** A stored draft belongs to a sheet of the same kind (a missing kind is an expense). */
function sameDraftRoute(stored: unknown, route: DraftRoute): boolean {
  if (!isRecord(stored) || ownValue(stored, 'name') !== 'transaction' || ownValue(stored, 'id') !== undefined) return false
  const kind = ownValue(stored, 'kind') ?? 'expense'
  return kind === (route.kind ?? 'expense')
}

const KEYPAD_STRING = /^\d{0,8}(?:\.\d{0,2})?$/
const MAX_DRAFT_SPLITS = 50

function readStored(): unknown {
  try {
    const text = localStorage.getItem(LS_KEYS.draft)
    return text === null ? null : (JSON.parse(text) as unknown)
  } catch {
    return null
  }
}

function draftSplits(value: unknown): SplitRow[] | null {
  if (!Array.isArray(value) || value.length > MAX_DRAFT_SPLITS) return null
  const rows: SplitRow[] = []
  for (const item of value as unknown[]) {
    if (!isRecord(item)) return null
    const person = ownValue(item, 'person')
    const amount = ownValue(item, 'amount')
    if (typeof person !== 'string') return null
    const validAmount = amount === null || (Number.isInteger(amount) && (amount as number) >= 0 && (amount as number) <= MAX_CENTS)
    if (!validAmount) return null
    rows.push({ key: newId(), id: null, person: person.slice(0, MAX_LENGTHS.name), amount: amount as Cents | null, status: 'open' })
  }
  return rows
}

/**
 * The fields of the draft kept for a new item of this kind, or null when there is none or it is
 * not readable. The shell reopens a draft younger than 15 minutes at start and removes older ones
 * (app/drafts.ts); the sheet removes its own draft whenever it closes, so a draft found here is
 * the one the shell reopened.
 */
export function readDraft(route: DraftRoute, digits: CurrencyDigits): TxForm | null {
  const stored = readStored()
  if (!isRecord(stored) || !sameDraftRoute(ownValue(stored, 'route'), route)) return null
  const fields = ownValue(stored, 'fields')
  if (!isRecord(fields)) return null
  const keys = ownValue(fields, 'keys')
  const categoryId = ownValue(fields, 'categoryId')
  const note = ownValue(fields, 'note')
  const date = ownValue(fields, 'date')
  const fromWallet = ownValue(fields, 'fromWallet')
  const even = ownValue(fields, 'even')
  const showAll = ownValue(fields, 'showAllCategories')
  const splits = draftSplits(ownValue(fields, 'splits'))
  if (typeof keys !== 'string' || !KEYPAD_STRING.test(keys)) return null
  if (categoryId !== null && typeof categoryId !== 'string') return null
  if (typeof note !== 'string' || !isValidISODate(date) || typeof fromWallet !== 'boolean') return null
  if (typeof even !== 'boolean' || typeof showAll !== 'boolean' || splits === null) return null
  const income = route.kind === 'income'
  return {
    // A currency without cents (changed since) keeps the whole units.
    keys: digits === 0 ? (keys.split('.')[0] ?? '') : keys,
    pristine: false,
    categoryId: income ? null : categoryId,
    note: note.slice(0, MAX_LENGTHS.note),
    date,
    fromWallet: !income && fromWallet,
    splits: income ? [] : splits,
    even,
    showAllCategories: showAll,
  }
}

/** Keeps the form of a new item (`{ route, fields, savedAt }`); storage failures are ignored. */
export function writeDraft(route: DraftRoute, form: TxForm, savedAt: number): void {
  const fields = {
    keys: form.keys,
    categoryId: form.categoryId,
    note: form.note,
    date: form.date,
    fromWallet: form.fromWallet,
    splits: form.splits.map((row) => ({ person: row.person, amount: row.amount })),
    even: form.even,
    showAllCategories: form.showAllCategories,
  }
  try {
    localStorage.setItem(LS_KEYS.draft, JSON.stringify({ route, fields, savedAt }))
  } catch {
    // Storage full or blocked: the entry is still on screen.
  }
}

/** Removes the draft when it is this sheet's (another sheet's draft stays). */
export function clearDraft(route: DraftRoute): void {
  const stored = readStored()
  if (!isRecord(stored) || !sameDraftRoute(ownValue(stored, 'route'), route)) return
  try {
    localStorage.removeItem(LS_KEYS.draft)
  } catch {
    // Storage unavailable: nothing to remove.
  }
}
