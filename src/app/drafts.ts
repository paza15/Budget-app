import { useNav, type SheetRoute } from '@/app/nav'
import { LS_KEYS } from '@/domain/constants'
import { isRecord, ownValue } from '@/domain/normalize'
import type { EveryMonths, TxKind } from '@/domain/types'

/**
 * Drafts of new items (docs/SPEC.md §5.10 rule 4). The new-item TransactionSheet and RecurringSheet
 * write `{ route, fields, savedAt }` to localStorage on every change and remove it on save or
 * cancel; the sheet finds its fields there when it opens with the same route. At start the shell
 * reopens a draft younger than 15 minutes, so a half-typed entry survives iOS closing the app.
 */

const DRAFT_MAX_AGE_MS = 15 * 60_000

const EVERY_MONTHS: readonly unknown[] = [1, 2, 3, 6, 12] satisfies EveryMonths[]

function txKindOf(value: unknown): TxKind | undefined | null {
  if (value === undefined) return undefined
  return value === 'expense' || value === 'income' ? value : null
}

function optionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : null
}

/** The route of a new-item draft, rebuilt from known fields only; null for anything else. */
function draftRoute(value: unknown): SheetRoute | null {
  if (!isRecord(value) || ownValue(value, 'id') !== undefined) return null
  const name = ownValue(value, 'name')
  const kind = txKindOf(ownValue(value, 'kind'))
  if (kind === null) return null

  if (name === 'transaction') {
    const categoryId = optionalString(ownValue(value, 'categoryId'))
    if (categoryId === null) return null
    return {
      name,
      ...(kind === undefined ? {} : { kind }),
      ...(categoryId === undefined ? {} : { categoryId }),
    }
  }

  if (name === 'recurring') {
    const rawPreset = ownValue(value, 'preset')
    if (rawPreset !== undefined && !isRecord(rawPreset)) return null
    let preset: { name?: string; categoryId?: string; everyMonths?: EveryMonths } | undefined
    if (rawPreset !== undefined) {
      const presetName = optionalString(ownValue(rawPreset, 'name'))
      const categoryId = optionalString(ownValue(rawPreset, 'categoryId'))
      const everyMonths = ownValue(rawPreset, 'everyMonths')
      if (presetName === null || categoryId === null) return null
      if (everyMonths !== undefined && !EVERY_MONTHS.includes(everyMonths)) return null
      preset = {
        ...(presetName === undefined ? {} : { name: presetName }),
        ...(categoryId === undefined ? {} : { categoryId }),
        ...(everyMonths === undefined ? {} : { everyMonths: everyMonths as EveryMonths }),
      }
    }
    return {
      name,
      ...(kind === undefined ? {} : { kind }),
      ...(preset === undefined ? {} : { preset }),
    }
  }

  return null
}

function removeDraft(): void {
  try {
    localStorage.removeItem(LS_KEYS.draft)
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

/**
 * The route of the stored draft when it is younger than 15 minutes at `now`. A draft that is
 * older, unreadable or not for a new item is removed, so it cannot come back later.
 */
export function freshDraftRoute(now: number): SheetRoute | null {
  let text: string | null
  try {
    text = localStorage.getItem(LS_KEYS.draft)
  } catch {
    return null
  }
  if (text === null) return null
  let draft: unknown = null
  try {
    draft = JSON.parse(text)
  } catch {
    // Unreadable: removed below.
  }
  const route = isRecord(draft) ? draftRoute(ownValue(draft, 'route')) : null
  const savedAt = isRecord(draft) ? ownValue(draft, 'savedAt') : undefined
  const age = typeof savedAt === 'number' ? now - savedAt : Number.NaN
  if (route === null || !(age >= 0 && age < DRAFT_MAX_AGE_MS)) {
    removeDraft()
    return null
  }
  return route
}

/** Reopens the draft's sheet once per launch; the Shell calls it when it first mounts. */
let checked = false

export function reopenDraftOnce(): void {
  if (checked) return
  checked = true
  const route = freshDraftRoute(Date.now())
  if (route !== null && useNav.getState().sheets.length === 0) useNav.getState().openSheet(route)
}

/** Lets tests reopen drafts again. */
export function __resetDraftsForTests(): void {
  checked = false
}
