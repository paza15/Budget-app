import { MAX_CENTS } from '@/domain/constants'
import { addMonths, compareISO, isValidMonthKey, monthDiff } from '@/domain/dates'
import { sortedCategories } from '@/domain/queries'
import { baseAmountFor, chargePeriodOf, nextChargeMonth, normalizeRecurring, type RecurringLine } from '@/domain/recurring'
import type { Category, Cents, EveryMonths, MonthKey, Recurring, RecurringOverride, TxKind } from '@/domain/types'
import type { NewRecurring, OverridePatch, RecurringPatch } from '@/store/actions'

/**
 * The recurring sheet's form (docs/SPEC.md §3.6): what it starts with, what makes it valid and
 * what saving it changes. Pure, so the sheet stays a thin layer over these rules.
 */

/** The intervals of the "How often" picker. */
const EVERY_MONTHS: readonly EveryMonths[] = [1, 2, 3, 6, 12]

export interface RecurringForm {
  name: string
  /** null while empty. */
  amount: Cents | null
  /** Costs only; always null for income. */
  categoryId: string | null
  everyMonths: EveryMonths
  /** Counts a share every month; only meaningful when everyMonths > 1. */
  spread: boolean
  dueDay: number | null
  /** "Starts" (More options), for monthly items. */
  startMonth: MonthKey
  /** "Charged in", for items charged less often than monthly. */
  chargedIn: MonthKey
  endMonth: MonthKey | null
  note: string
  /** This month: ticked off as paid or received. */
  paid: boolean
  /** This month: skipped. */
  skipped: boolean
  /** This month: a different amount, or null for the usual one. */
  differentAmount: Cents | null
  // What the form shows, not what it saves.
  /** More options are revealed. */
  moreOpen: boolean
  /** The different-amount field is revealed. */
  differentOpen: boolean
  /** The spread toggle was set by hand, so a new interval keeps it. */
  spreadTouched: boolean
}

/** The fields that are saved; the others only change what the form shows. */
const SAVED_FIELDS = [
  'name',
  'amount',
  'categoryId',
  'everyMonths',
  'spread',
  'dueDay',
  'startMonth',
  'chargedIn',
  'endMonth',
  'note',
  'paid',
  'skipped',
  'differentAmount',
] as const satisfies readonly (keyof RecurringForm)[]

/** Where the sheet stands: the period it works in and, when editing, the item and its line there. */
export interface FormContext {
  kind: TxKind
  /** The selected period. */
  month: MonthKey
  /** The item being edited; null for a new one. */
  item: Recurring | null
  /** The item's line in `month`, if it has one. */
  line: RecurringLine | null
  /** The item's override in `month`, if any. */
  override: RecurringOverride | undefined
}

export interface NewItemPreset {
  name?: string
  categoryId?: string
  everyMonths?: EveryMonths
}

/** Spread is on by default for items charged every 6 or 12 months, off for every 2 or 3 (§3.6). */
export function defaultSpread(everyMonths: EveryMonths): boolean {
  return everyMonths === 6 || everyMonths === 12
}

export function isEveryMonths(value: unknown): value is EveryMonths {
  return EVERY_MONTHS.includes(value as EveryMonths)
}

/**
 * The category a new fixed cost starts in: the one asked for while it exists and is not archived,
 * else the first active category of kind fixed or both, else the first active one (§3.5).
 */
export function startingCategory(categories: readonly Category[], wanted: string | undefined): string | null {
  const active = sortedCategories(categories)
  if (wanted !== undefined && active.some((category) => category.id === wanted)) return wanted
  return (sortedCategories(categories, { kind: 'fixed' })[0] ?? active[0])?.id ?? null
}

/**
 * The usual amount the Amount field shows when editing: the amount in force in the selected
 * period (for a spread item, in its cycle), or for an item without a line there its amount at the
 * next charge or where it ended.
 */
export function usualAmount(r: Recurring, month: MonthKey): Cents {
  const cycle = chargePeriodOf(r, month)
  if (cycle === null) return baseAmountFor(r, nextChargeMonth(r, month) ?? r.endMonth ?? month)
  return baseAmountFor(r, r.spread && r.everyMonths > 1 ? cycle : month)
}

/** When editing, "Charged in" shows the next charge (§3.6); an item that is over shows its last cycle. */
function chargedInFor(r: Recurring, month: MonthKey): MonthKey {
  return nextChargeMonth(r, month) ?? chargePeriodOf(r, r.endMonth ?? month) ?? r.startMonth
}

/** What the "This month" group offers (§3.6), or null when the item has no charge line in the period. */
export interface ThisMonthOffer {
  /** Paid or Received. */
  paid: boolean
  /** Skip this month: items that are not spread (and a spread item already skipped, to undo it). */
  skip: boolean
  /** Different amount this month (for a spread item: its whole cycle). */
  amount: boolean
}

export function thisMonthOffer(context: FormContext): ThisMonthOffer | null {
  const { item, line } = context
  if (item === null || line === null || !line.isChargeMonth) return null
  const spread = item.spread && item.everyMonths > 1
  return { paid: true, skip: !spread || line.skipped, amount: true }
}

/** A new item's form: the preset's name, category and interval, the selected period, nothing else. */
export function newForm(
  kind: TxKind,
  month: MonthKey,
  categories: readonly Category[],
  preset: NewItemPreset | undefined,
): RecurringForm {
  const everyMonths = preset?.everyMonths ?? 1
  return {
    name: preset?.name ?? '',
    amount: null,
    categoryId: kind === 'expense' ? startingCategory(categories, preset?.categoryId) : null,
    everyMonths,
    spread: defaultSpread(everyMonths),
    dueDay: null,
    startMonth: month,
    chargedIn: month,
    endMonth: null,
    note: '',
    paid: false,
    skipped: false,
    differentAmount: null,
    moreOpen: false,
    differentOpen: false,
    spreadTouched: false,
  }
}

/** The form for an item as it is, in the selected period. */
export function editForm(context: FormContext & { item: Recurring }): RecurringForm {
  const { item, line, month, override } = context
  const differentAmount = override?.amount ?? null
  return {
    name: item.name,
    amount: usualAmount(item, month),
    categoryId: item.kind === 'expense' ? item.categoryId : null,
    everyMonths: item.everyMonths,
    spread: item.everyMonths > 1 ? item.spread : defaultSpread(item.everyMonths),
    dueDay: item.dueDay,
    startMonth: item.startMonth,
    chargedIn: chargedInFor(item, month),
    endMonth: item.endMonth,
    note: item.note,
    paid: line?.paid ?? false,
    skipped: line?.skipped ?? false,
    differentAmount,
    moreOpen: item.endMonth !== null || item.note !== '',
    differentOpen: differentAmount !== null,
    // An item charged less often keeps its own choice when the interval changes.
    spreadTouched: item.everyMonths > 1,
  }
}

/** The form after picking an interval: an untouched spread toggle follows the new interval's default. */
export function withInterval(form: RecurringForm, everyMonths: EveryMonths): RecurringForm {
  return { ...form, everyMonths, spread: form.spreadTouched ? form.spread : defaultSpread(everyMonths) }
}

/** True when the saved fields differ (the revealed groups do not count as changes). */
export function formChanged(a: RecurringForm, b: RecurringForm): boolean {
  return SAVED_FIELDS.some((key) => !Object.is(a[key], b[key]))
}

/**
 * "Charged in" c as a start month (§3.6): a month after the selected month m moves back by whole
 * cycles, startMonth = c − N × ceil((c − m) / N), so the item already counts in m.
 */
export function startFromChargedIn(chargedIn: MonthKey, month: MonthKey, everyMonths: EveryMonths): MonthKey {
  const ahead = monthDiff(month, chargedIn)
  if (ahead <= 0) return chargedIn
  return addMonths(chargedIn, -everyMonths * Math.ceil(ahead / everyMonths))
}

/**
 * The start month the form saves: "Starts" for monthly items; for the others the "Charged in"
 * month, unless editing left both the interval and the charge month as they were, which keeps the
 * item's own start (and with it its past months).
 */
export function effectiveStart(form: RecurringForm, initial: RecurringForm, context: FormContext): MonthKey {
  if (form.everyMonths === 1) return form.startMonth
  const { item } = context
  if (item !== null && form.everyMonths === item.everyMonths && form.chargedIn === initial.chargedIn) {
    return item.startMonth
  }
  return startFromChargedIn(form.chargedIn, context.month, form.everyMonths)
}

/**
 * True when saving re-plans months before the selected period: an item that started before it gets
 * a new interval, or (charged less often than monthly) a charge month that moves its start. An
 * item has one schedule for all time, so the sheet says so, and how to keep the past (§3.6).
 * "Starts" of a monthly item is left out: it is a start month the user picks on purpose.
 */
export function changesPast(form: RecurringForm, initial: RecurringForm, context: FormContext): boolean {
  const { item, month } = context
  if (item === null || compareISO(item.startMonth, month) >= 0) return false
  if (form.everyMonths !== item.everyMonths) return true
  return form.everyMonths > 1 && effectiveStart(form, initial, context) !== item.startMonth
}

/** A required field that is still empty: Save stays disabled, and there is nothing to explain. */
export type MissingField = 'name' | 'amount' | 'category'

export interface FormCheck {
  missing: MissingField[]
  /** Problems the form explains under their rows. */
  amount?: string
  different?: string
  end?: string
}

const ABOVE_ZERO = 'Enter an amount above 0.'

function validAmount(amount: Cents | null): amount is Cents {
  return amount !== null && Number.isSafeInteger(amount) && amount >= 1 && amount <= MAX_CENTS
}

/** What stops the form from being saved. */
export function checkForm(form: RecurringForm, initial: RecurringForm, context: FormContext): FormCheck {
  const check: FormCheck = { missing: [] }
  if (form.name.trim() === '') check.missing.push('name')
  if (form.amount === null) check.missing.push('amount')
  else if (!validAmount(form.amount)) check.amount = ABOVE_ZERO
  if (context.kind === 'expense' && form.categoryId === null) check.missing.push('category')
  if (form.differentOpen && form.differentAmount !== null && !validAmount(form.differentAmount)) {
    check.different = ABOVE_ZERO
  }
  if (form.endMonth !== null && isValidMonthKey(form.endMonth)) {
    const start = effectiveStart(form, initial, context)
    if (compareISO(form.endMonth, start) < 0) check.end = "It can't end before it starts. Pick a later month."
  }
  return check
}

export function canSave(check: FormCheck): boolean {
  return (
    check.missing.length === 0 && check.amount === undefined && check.different === undefined && check.end === undefined
  )
}

/** What saving changes. */
export type SavePlan =
  | { kind: 'add'; input: NewRecurring }
  | {
      kind: 'edit'
      /** Changed fields of the item, or null. */
      patch: RecurringPatch | null
      /** A new usual amount (the sheet asks from when), or null. */
      amount: Cents | null
      /** Changes to this period's override, or null. */
      override: OverridePatch | null
      /**
       * The item as saved is still charged in the selected period or a later one. When it is not
       * (it ended before, or its last cycle began earlier), "From this month on" would change
       * nothing, so a new amount goes to every month without asking.
       */
      chargesAhead: boolean
    }

/**
 * Turns a valid form into the actions that save it. Text is trimmed (the store cuts it to its
 * maximum length); spread is saved only for items charged less often than monthly.
 */
export function planSave(form: RecurringForm, initial: RecurringForm, context: FormContext): SavePlan {
  const { item, kind } = context
  const name = form.name.trim()
  const note = form.note.trim()
  const spread = form.everyMonths > 1 && form.spread
  const startMonth = effectiveStart(form, initial, context)
  const categoryId = kind === 'expense' ? form.categoryId : null
  const amount = form.amount ?? 0

  if (item === null) {
    return {
      kind: 'add',
      input: {
        kind,
        name,
        categoryId,
        amount,
        everyMonths: form.everyMonths,
        spread,
        startMonth,
        endMonth: form.endMonth,
        dueDay: form.dueDay,
        note,
      },
    }
  }

  const patch: RecurringPatch = {}
  if (name !== item.name) patch.name = name
  if (kind === 'expense' && categoryId !== item.categoryId && categoryId !== null) patch.categoryId = categoryId
  if (form.everyMonths !== item.everyMonths) patch.everyMonths = form.everyMonths
  if (spread !== (item.spread && item.everyMonths > 1)) patch.spread = spread
  if (startMonth !== item.startMonth) patch.startMonth = startMonth
  if (form.endMonth !== item.endMonth) patch.endMonth = form.endMonth
  if (form.dueDay !== item.dueDay) patch.dueDay = form.dueDay
  if (note !== item.note) patch.note = note

  const override: OverridePatch = {}
  if (thisMonthOffer(context) !== null) {
    if (form.skipped !== initial.skipped) override.skipped = form.skipped
    // Nothing is paid in a skipped period; setOverride clears paid itself.
    if (!form.skipped && form.paid !== initial.paid) override.paid = form.paid
    const usual = usualAmount(item, context.month)
    // An empty or usual "different" amount means the usual one.
    const different = form.differentOpen && form.differentAmount !== usual ? form.differentAmount : null
    if (different !== initial.differentAmount) override.amount = different
  }

  const changed = Object.keys(patch).length > 0
  // Amounts count only in charge periods (a spread cycle takes its charge period's amount), so a
  // new amount from this period on reaches something only while a charge is still to come.
  const saved = changed ? normalizeRecurring({ ...item, ...patch }) : item
  return {
    kind: 'edit',
    patch: changed ? patch : null,
    amount: amount !== initial.amount ? amount : null,
    override: Object.keys(override).length > 0 ? override : null,
    chargesAhead: nextChargeMonth(saved, context.month) !== null,
  }
}
