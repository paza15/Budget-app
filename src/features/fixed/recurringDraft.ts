import type { SheetRoute } from '@/app/nav'
import { LS_KEYS, MAX_CENTS, MAX_LENGTHS } from '@/domain/constants'
import { isValidMonthKey } from '@/domain/dates'
import { isRecord } from '@/domain/normalize'
import { isEveryMonths, type RecurringForm } from '@/features/fixed/recurringForm'

/**
 * Drafts of a new fixed cost or income (docs/SPEC.md §5.10 rule 4). The new-item sheet writes
 * `{ route, fields, savedAt }` to localStorage on every change and removes it on save, cancel or
 * close; the shell reopens a draft younger than 15 minutes at start (app/drafts.ts), and the sheet
 * then finds its fields here because it opens with the same route. Storage can be missing or
 * full, so every access is guarded: a lost draft is only an inconvenience.
 */

export type RecurringRoute = Extract<SheetRoute, { name: 'recurring' }>

/** The fields a new item's draft keeps: everything the add form shows. */
export type DraftFields = Pick<
  RecurringForm,
  | 'name'
  | 'amount'
  | 'categoryId'
  | 'everyMonths'
  | 'spread'
  | 'dueDay'
  | 'startMonth'
  | 'chargedIn'
  | 'endMonth'
  | 'note'
  | 'moreOpen'
  | 'spreadTouched'
>

/** Identifies a route as drafts.ts rebuilds it: name, kind and the preset, nothing else. */
function routeKey(route: unknown): string | null {
  if (!isRecord(route) || route.name !== 'recurring' || route.id !== undefined) return null
  const preset = isRecord(route.preset) ? route.preset : null
  return JSON.stringify([
    route.kind ?? null,
    preset === null ? null : [preset.name ?? null, preset.categoryId ?? null, preset.everyMonths ?? null],
  ])
}

function readStored(): Record<string, unknown> | null {
  let text: string | null
  try {
    text = localStorage.getItem(LS_KEYS.draft)
  } catch {
    return null
  }
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_CENTS
}

function isDueDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 31
}

/** The stored fields that are still valid; anything else keeps the form's own value. */
function fieldsFrom(raw: Record<string, unknown>): Partial<DraftFields> {
  const fields: Partial<DraftFields> = {}
  if (typeof raw.name === 'string' && raw.name.length <= MAX_LENGTHS.recurring) fields.name = raw.name
  if (raw.amount === null || isAmount(raw.amount)) fields.amount = raw.amount
  if (raw.categoryId === null || typeof raw.categoryId === 'string') fields.categoryId = raw.categoryId
  if (isEveryMonths(raw.everyMonths)) fields.everyMonths = raw.everyMonths
  if (typeof raw.spread === 'boolean') fields.spread = raw.spread
  if (raw.dueDay === null || isDueDay(raw.dueDay)) fields.dueDay = raw.dueDay
  if (isValidMonthKey(raw.startMonth)) fields.startMonth = raw.startMonth
  if (isValidMonthKey(raw.chargedIn)) fields.chargedIn = raw.chargedIn
  if (raw.endMonth === null || isValidMonthKey(raw.endMonth)) fields.endMonth = raw.endMonth
  if (typeof raw.note === 'string' && raw.note.length <= MAX_LENGTHS.note) fields.note = raw.note
  if (typeof raw.moreOpen === 'boolean') fields.moreOpen = raw.moreOpen
  if (typeof raw.spreadTouched === 'boolean') fields.spreadTouched = raw.spreadTouched
  return fields
}

/** The draft's fields when the stored draft belongs to this new-item route, else null. */
export function readDraft(route: RecurringRoute): Partial<DraftFields> | null {
  const key = routeKey(route)
  if (key === null) return null
  const stored = readStored()
  if (stored === null || routeKey(stored.route) !== key || !isRecord(stored.fields)) return null
  return fieldsFrom(stored.fields)
}

/** Keeps the form of a new item, replacing any earlier draft. */
export function writeDraft(route: RecurringRoute, form: RecurringForm, savedAt: number): void {
  if (routeKey(route) === null) return
  const fields: DraftFields = {
    name: form.name,
    amount: form.amount,
    categoryId: form.categoryId,
    everyMonths: form.everyMonths,
    spread: form.spread,
    dueDay: form.dueDay,
    startMonth: form.startMonth,
    chargedIn: form.chargedIn,
    endMonth: form.endMonth,
    note: form.note,
    moreOpen: form.moreOpen,
    spreadTouched: form.spreadTouched,
  }
  try {
    localStorage.setItem(LS_KEYS.draft, JSON.stringify({ route, fields, savedAt }))
  } catch {
    // Storage full or unavailable: the form simply has no draft.
  }
}

/** Removes the stored draft when it is this route's; a draft of another sheet stays. */
export function removeDraft(route: RecurringRoute): void {
  const key = routeKey(route)
  if (key === null) return
  const stored = readStored()
  if (stored === null || routeKey(stored.route) !== key) return
  try {
    localStorage.removeItem(LS_KEYS.draft)
  } catch {
    // Storage unavailable: nothing to remove.
  }
}
