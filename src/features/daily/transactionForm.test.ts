import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LS_KEYS } from '@/domain/constants'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { myShare } from '@/domain/splits'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import { makeCategory, makeData, makeSplit, makeTransaction, TODAY } from '@/domain/test-helpers/dataFixtures'
import type { AppData, Transaction } from '@/domain/types'
import { walletSummary } from '@/domain/wallet'
import { categoryMapOf } from '@/store/selectors'
import {
  ALL_CATEGORIES,
  addPerson,
  applySuggestion,
  categoryChoices,
  clearDraft,
  completePerson,
  defaultCategoryId,
  draftRouteOf,
  draftTransaction,
  editForm,
  evenSplits,
  formAmount,
  hasChanges,
  isEvenSplit,
  newForm,
  pressKey,
  readDraft,
  removePerson,
  setPersonAmount,
  setPersonName,
  splitEvenly,
  splitsFit,
  splitsToSave,
  tidyPerson,
  walletAfter,
  writeDraft,
  type SplitRow,
  type TxForm,
} from './transactionForm'

const { coffee, eating, groceries, rent, transport } = DEFAULT_CATEGORY_IDS

function form(patch: Partial<TxForm> = {}): TxForm {
  return { ...newForm(makeData(), 'expense', coffee, TODAY), ...patch }
}

function row(key: string, patch: Partial<SplitRow> = {}): SplitRow {
  return { key, id: null, person: key, amount: null, status: 'open', ...patch }
}

/** Types keys on the keypad: "3,50" → 3, ., 5, 0. */
function type(start: TxForm, keys: string): TxForm {
  let next = start
  for (const key of keys) next = pressKey(next, key === ',' ? '.' : (key as '0'), 2)
  return next
}

describe('opening the sheet (docs/SPEC.md §3.4)', () => {
  it('starts a new expense empty, dated today, from the budget and not split', () => {
    const f = newForm(makeData(), 'expense', undefined, TODAY)
    expect(f).toMatchObject({ keys: '', pristine: false, note: '', date: TODAY, fromWallet: false, splits: [], even: true })
  })

  it('takes the category passed in, else the last one used, else the first daily category', () => {
    const data = makeData()
    expect(defaultCategoryId(data, groceries)).toBe(groceries)
    // No expenses yet: Eating is the first category of kind daily (Transport is "both").
    expect(defaultCategoryId(data, undefined)).toBe(eating)
    const used = makeData({ transactions: [makeTransaction({ categoryId: transport })] })
    expect(defaultCategoryId(used, undefined)).toBe(transport)
    // An archived or unknown category passed in does not count.
    const archived = makeData({ categories: data.categories.map((c) => (c.id === groceries ? { ...c, archived: true } : c)) })
    expect(defaultCategoryId(archived, groceries)).toBe(eating)
    expect(defaultCategoryId(data, 'cat-gone')).toBe(eating)
  })

  it('gives income no category', () => {
    expect(newForm(makeData(), 'income', coffee, TODAY).categoryId).toBeNull()
  })

  it('opens a stored entry with a pristine keypad and its splits', () => {
    const tx = makeTransaction({ amount: 1290, splits: [makeSplit({ id: 's1', person: 'Max', amount: 645 })] })
    const f = editForm(tx, 2)
    expect(f.keys).toBe('12.90')
    expect(f.pristine).toBe(true)
    expect(f.splits).toEqual([{ key: 's1', id: 's1', person: 'Max', amount: 645, status: 'open' }])
    expect(f.even).toBe(true)
    expect(editForm({ ...tx, splits: [makeSplit({ amount: 100 })] }, 2).even).toBe(false)
  })
})

describe('the keypad (§3.4, §4.1)', () => {
  it('types an amount', () => {
    expect(formAmount(type(form(), '7,80'))).toBe(780)
    expect(formAmount(type(form(), '12'))).toBe(1200)
  })

  it('replaces a pristine amount with the first digit or separator', () => {
    const edit = editForm(makeTransaction({ amount: 1290 }), 2)
    expect(type(edit, '9,90').keys).toBe('9.90')
    expect(type(edit, ',5').keys).toBe('0.5')
  })

  it('edits a pristine amount with backspace', () => {
    const edit = editForm(makeTransaction({ amount: 1290 }), 2)
    const next = pressKey(edit, 'back', 2)
    expect(next.keys).toBe('12.9')
    expect(next.pristine).toBe(false)
  })

  it('has no separator for currencies without cents', () => {
    expect(pressKey(form({ keys: '3' }), '.', 0).keys).toBe('3')
  })

  it('fills note and amount from a suggestion, the amount pristine', () => {
    const next = applySuggestion(form({ keys: '1' }), 'Cappuccino', 350, 2)
    expect(next).toMatchObject({ note: 'Cappuccino', keys: '3.50', pristine: true })
  })
})

describe('splits (§3.16, EXTRAS.md §2.4)', () => {
  it('splits evenly and leaves the remainder with you', () => {
    const rows = evenSplits([row('a'), row('b')], 3200)
    expect(rows.map((r) => r.amount)).toEqual([1066, 1066])
    expect(isEvenSplit(rows, 3200)).toBe(true)
    expect(isEvenSplit([row('a', { amount: 800 }), row('b', { amount: 800 })], 3200)).toBe(false)
  })

  it('keeps settled splits out of the even split', () => {
    const rows = evenSplits([row('a', { status: 'paid', amount: 1000 }), row('b')], 3000)
    expect(rows.map((r) => r.amount)).toEqual([1000, 1000])
  })

  it('re-splits when a person is added to an even or empty split', () => {
    let f = type(form(), '32')
    f = addPerson(f, 'k1', 'Lea')
    expect(f.splits.map((r) => r.amount)).toEqual([1600])
    f = addPerson(f, 'k2')
    expect(f.splits.map((r) => r.amount)).toEqual([1066, 1066])
    expect(f.splits[1]).toMatchObject({ key: 'k2', person: '', status: 'open', id: null })
  })

  it('stops following the even split once an amount is typed', () => {
    let f = addPerson(addPerson(type(form(), '32'), 'k1', 'Lea'), 'k2', 'Max')
    f = setPersonAmount(f, 'k1', 800)
    expect(f.even).toBe(false)
    f = addPerson(f, 'k3', 'Jonas')
    expect(f.splits.map((r) => r.amount)).toEqual([800, 1066, null])
    // The bill changes, the hand-typed split stays.
    expect(type(f, '0').splits.map((r) => r.amount)).toEqual([800, 1066, null])
    // "Split evenly" applies it again, and from then on follows the bill.
    f = splitEvenly(f)
    expect(f.splits.map((r) => r.amount)).toEqual([800, 800, 800])
    expect(type(f, '0').splits.map((r) => r.amount)).toEqual([8000, 8000, 8000])
  })

  it('follows a new bill on the keypad while even', () => {
    const f = addPerson(type(form(), '18'), 'k1', 'Max')
    expect(pressKey(f, '0', 2).splits[0]?.amount).toBe(9000)
  })

  it('removes a person, and the last one takes the split with it', () => {
    let f = addPerson(addPerson(type(form(), '30'), 'k1', 'Lea'), 'k2', 'Max')
    f = removePerson(f, 'k1')
    expect(f.splits.map((r) => [r.key, r.amount])).toEqual([['k2', 1500]])
    f = setPersonAmount(f, 'k2', 100)
    f = removePerson(f, 'k2')
    expect(f.splits).toEqual([])
    expect(f.even).toBe(true)
  })

  it('drops a row left without a name and merges a repeated name', () => {
    let f = addPerson(type(form(), '30'), 'k1', 'Lea')
    f = addPerson(f, 'k2')
    f = tidyPerson(f, 'k2')
    expect(f.splits.map((r) => r.key)).toEqual(['k1'])
    // A third of 30,00 € each while even, then 5,00 € typed for the new row.
    f = setPersonAmount(addPerson(f, 'k3', ''), 'k3', 500)
    expect(f.splits.map((r) => r.amount)).toEqual([1000, 500])
    f = setPersonName(f, 'k3', ' lea ')
    f = tidyPerson(f, 'k3')
    expect(f.splits).toHaveLength(1)
    expect(f.splits[0]).toMatchObject({ key: 'k1', person: 'Lea', amount: 1500 })
  })

  it('completes the name being typed from a suggestion', () => {
    const f = completePerson(addPerson(type(form(), '20'), 'k1', 'Jo'), 'k1', 'Jonas')
    expect(f.splits[0]?.person).toBe('Jonas')
  })

  it('cuts names to 24 characters', () => {
    const f = setPersonName(addPerson(form(), 'k1'), 'k1', 'A'.repeat(30))
    expect(f.splits[0]?.person).toHaveLength(24)
  })

  it('never lets what others owe exceed the bill', () => {
    const f = setPersonAmount(addPerson(type(form(), '18'), 'k1', 'Max'), 'k1', 1900)
    expect(splitsFit(f)).toBe(false)
    expect(splitsFit(setPersonAmount(f, 'k1', 1800))).toBe(true)
  })

  it('saves named people with an amount, each name once, settled splits by id', () => {
    const saved = splitsToSave([
      row('a', { person: ' Lea ', amount: 500 }),
      row('b', { person: '', amount: 300 }),
      row('c', { person: 'Max', amount: null }),
      row('d', { person: 'lea', amount: 200 }),
      row('e', { id: 's-e', person: 'Jonas', amount: 400, status: 'paid' }),
      row('f', { id: 's-f', person: 'Mia', amount: 100 }),
    ])
    expect(saved).toEqual([
      { person: 'Lea', amount: 700 },
      { id: 's-e', person: 'Jonas', amount: 400 },
      { id: 's-f', person: 'Mia', amount: 100 },
    ])
  })
})

describe('what the form would save', () => {
  it('counts your share, before a name is typed', () => {
    const f = addPerson(addPerson(type(form(), '32'), 'k1', 'Lea'), 'k2')
    const draft = draftTransaction(f, 'expense', null)
    expect(myShare(draft)).toBe(1068)
    expect(draft).toMatchObject({ amount: 3200, categoryId: coffee, fromWallet: false })
  })

  it('keeps income free of wallet payments and splits', () => {
    const draft = draftTransaction(form({ keys: '50', fromWallet: true, splits: [row('a', { amount: 100 })] }), 'income', null)
    expect(draft).toMatchObject({ kind: 'income', categoryId: null, fromWallet: false, splits: [] })
  })

  it('notices changes to anything that would be saved', () => {
    const initial = form()
    expect(hasChanges(initial, initial)).toBe(false)
    expect(hasChanges(type(initial, '3'), initial)).toBe(true)
    expect(hasChanges({ ...initial, note: ' ' }, initial)).toBe(false)
    expect(hasChanges({ ...initial, categoryId: eating }, initial)).toBe(true)
    expect(hasChanges({ ...initial, fromWallet: true }, initial)).toBe(true)
    expect(hasChanges(addPerson(initial, 'k1'), initial)).toBe(true)
    // An edit typed back to the same amount is unchanged.
    const edit = editForm(makeTransaction({ amount: 1290 }), 2)
    expect(hasChanges(type(edit, '12,9'), edit)).toBe(false)
  })
})

describe('the wallet after paying (§3.13, DESIGN.md §9.26)', () => {
  const base = makeData({ wallet: { opening: 50000, startMonth: '2026-10', entries: [], goals: [] } })

  it('takes a new payment out of the balance', () => {
    const draft = draftTransaction(form({ keys: '120', fromWallet: true }), 'expense', null)
    expect(walletAfter(base, TODAY, null, draft)).toBe(50000 - 12000)
  })

  it('counts an edited payment back in first', () => {
    const stored = makeTransaction({ id: 'tx-w', amount: 10000, fromWallet: true })
    const data: AppData = { ...base, transactions: [stored] }
    expect(walletSummary(data, TODAY).balance).toBe(40000)
    const draft = draftTransaction({ ...editForm(stored, 2), keys: '150' }, 'expense', stored)
    expect(walletAfter(data, TODAY, stored, draft)).toBe(50000 - 15000)
  })

  it('takes your share only, and a later date as well', () => {
    const f = setPersonAmount(addPerson(form({ keys: '100', fromWallet: true, date: '2026-10-20' }), 'k1', 'Max'), 'k1', 4000)
    const draft = draftTransaction(f, 'expense', null)
    expect(walletAfter(base, TODAY, null, draft)).toBe(50000 - 6000)
  })
})

describe('category chips (§3.4)', () => {
  const data = makeData()
  const map = categoryMapOf(data.categories)

  it('offers the daily categories, then "All categories"', () => {
    const choices = categoryChoices(data.categories, eating, false, map)
    expect(choices.map((c) => c.value)).not.toContain(rent)
    expect(choices.at(-1)).toEqual({ value: ALL_CATEGORIES, label: 'All categories' })
    expect(choices[0]?.value).toBe(transport)
  })

  it('adds the fixed-only categories once "All categories" was tapped', () => {
    const choices = categoryChoices(data.categories, eating, true, map)
    expect(choices.map((c) => c.value)).toContain(rent)
    expect(choices.map((c) => c.value)).not.toContain(ALL_CATEGORIES)
  })

  it('keeps the chosen category, even fixed-only, archived or deleted', () => {
    expect(categoryChoices(data.categories, rent, false, map).map((c) => c.value)).toContain(rent)
    const archived = [...data.categories, makeCategory('cat-old', { name: 'Old', archived: true, order: 99 })]
    expect(categoryChoices(archived, 'cat-old', false, categoryMapOf(archived)).map((c) => c.value)).toContain('cat-old')
    const gone = categoryChoices(data.categories, 'cat-gone', false, map)
    expect(gone.find((c) => c.value === 'cat-gone')).toEqual({ value: 'cat-gone', label: 'Uncategorized', icon: 'question' })
    expect(categoryChoices(data.categories, UNCATEGORIZED_ID, false, map).some((c) => c.label === 'Uncategorized')).toBe(true)
  })
})

describe('drafts (§5.10 rule 4)', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    })
  })
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage')
  })

  const route = { name: 'transaction' as const }

  it('keeps no draft for an edit', () => {
    expect(draftRouteOf({ id: 'tx-1' })).toBeNull()
    expect(draftRouteOf({ kind: 'income', categoryId: coffee })).toEqual({ name: 'transaction', kind: 'income', categoryId: coffee })
  })

  it('writes the form and reads it back', () => {
    const f = setPersonAmount(addPerson(type(form({ note: 'Pizza', date: '2026-10-13' }), '32'), 'k1', 'Lea'), 'k1', 800)
    writeDraft(route, f, 1000)
    const stored = JSON.parse(store.get(LS_KEYS.draft) ?? '{}') as { route: unknown; savedAt: number }
    expect(stored.route).toEqual(route)
    expect(stored.savedAt).toBe(1000)
    const back = readDraft(route, 2)
    expect(back).toMatchObject({ keys: '32', note: 'Pizza', date: '2026-10-13', categoryId: coffee, pristine: false, even: false })
    expect(back?.splits.map((r) => [r.person, r.amount, r.status])).toEqual([['Lea', 800, 'open']])
  })

  it('ignores the draft of another kind of sheet, and damaged ones', () => {
    writeDraft({ name: 'transaction', kind: 'income' }, form({ keys: '5' }), 1)
    expect(readDraft(route, 2)).toBeNull()
    store.set(LS_KEYS.draft, '{"route":{"name":"transaction"},"fields":{"keys":"x"}}')
    expect(readDraft(route, 2)).toBeNull()
    store.set(LS_KEYS.draft, 'not json')
    expect(readDraft(route, 2)).toBeNull()
  })

  it('keeps whole units for a currency without cents', () => {
    writeDraft(route, form({ keys: '3.5' }), 1)
    expect(readDraft(route, 0)?.keys).toBe('3')
  })

  it('removes only its own draft', () => {
    store.set(LS_KEYS.draft, JSON.stringify({ route: { name: 'recurring' }, fields: {}, savedAt: 1 }))
    clearDraft(route)
    expect(store.has(LS_KEYS.draft)).toBe(true)
    writeDraft(route, form({ keys: '5' }), 1)
    clearDraft(route)
    expect(store.has(LS_KEYS.draft)).toBe(false)
  })
})

describe('a stored transaction', () => {
  it('keeps the transaction id when editing', () => {
    const tx: Transaction = makeTransaction({ id: 'tx-9' })
    expect(draftTransaction(editForm(tx, 2), 'expense', tx).id).toBe('tx-9')
  })
})
