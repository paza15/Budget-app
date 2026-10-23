import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LS_KEYS } from '@/domain/constants'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData } from '@/domain/test-helpers/dataFixtures'
import { readDraft, removeDraft, writeDraft, type RecurringRoute } from '@/features/fixed/recurringDraft'
import { newForm } from '@/features/fixed/recurringForm'
import { createMemoryStorage } from '@/store/test-helpers/backends'

const NEW_COST: RecurringRoute = { name: 'recurring', kind: 'expense' }
const SUGGESTION: RecurringRoute = {
  name: 'recurring',
  kind: 'expense',
  preset: { name: 'Netflix', categoryId: DEFAULT_CATEGORY_IDS.subscriptions, everyMonths: 1 },
}
const form = { ...newForm('expense', '2026-10', makeData().categories, undefined), name: 'Gym', amount: 2990 }

let storage: Storage

beforeEach(() => {
  storage = createMemoryStorage()
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('drafts of new items (docs/SPEC.md §5.10 rule 4)', () => {
  it('stores the route, the fields and when', () => {
    writeDraft(NEW_COST, form, 1234)
    const stored = JSON.parse(storage.getItem(LS_KEYS.draft) ?? 'null') as Record<string, unknown>
    expect(stored).toMatchObject({ route: NEW_COST, savedAt: 1234, fields: { name: 'Gym', amount: 2990, everyMonths: 1 } })
    // This-month controls belong to editing; a new item's draft leaves them out.
    expect(stored.fields).not.toHaveProperty('paid')
  })

  it('gives the fields back to the same route only', () => {
    writeDraft(NEW_COST, form, 1)
    expect(readDraft(NEW_COST)).toMatchObject({ name: 'Gym', amount: 2990 })
    expect(readDraft(SUGGESTION)).toBeNull()
    expect(readDraft({ name: 'recurring', kind: 'income' })).toBeNull()
    expect(readDraft({ name: 'recurring', id: 'rec-1' })).toBeNull()
  })

  it('matches a route rebuilt by the shell', () => {
    writeDraft(SUGGESTION, form, 1)
    expect(readDraft(JSON.parse(JSON.stringify(SUGGESTION)) as RecurringRoute)).toMatchObject({ name: 'Gym' })
  })

  it('keeps only valid fields', () => {
    storage.setItem(
      LS_KEYS.draft,
      JSON.stringify({
        route: NEW_COST,
        savedAt: 1,
        fields: { name: 'Rent', amount: -5, everyMonths: 5, dueDay: 40, startMonth: '2026-13', endMonth: null, note: 3 },
      }),
    )
    expect(readDraft(NEW_COST)).toEqual({ name: 'Rent', endMonth: null })
  })

  it('ignores unreadable storage', () => {
    storage.setItem(LS_KEYS.draft, '{nope')
    expect(readDraft(NEW_COST)).toBeNull()
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readDraft(NEW_COST)).toBeNull()
    expect(() => writeDraft(NEW_COST, form, 1)).not.toThrow()
    expect(() => removeDraft(NEW_COST)).not.toThrow()
  })

  it('removes its own draft and leaves another sheet’s alone', () => {
    writeDraft(NEW_COST, form, 1)
    removeDraft(SUGGESTION)
    expect(storage.getItem(LS_KEYS.draft)).not.toBeNull()
    removeDraft(NEW_COST)
    expect(storage.getItem(LS_KEYS.draft)).toBeNull()

    const expense = JSON.stringify({ route: { name: 'transaction' }, fields: {}, savedAt: 1 })
    storage.setItem(LS_KEYS.draft, expense)
    removeDraft(NEW_COST)
    expect(storage.getItem(LS_KEYS.draft)).toBe(expense)
  })

  it('never keeps a draft for an item that exists', () => {
    writeDraft({ name: 'recurring', id: 'rec-1' }, form, 1)
    expect(storage.getItem(LS_KEYS.draft)).toBeNull()
  })
})
