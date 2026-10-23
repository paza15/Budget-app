import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useSelectedMonth, type SheetProps } from '@/app/nav'
import { withUndo } from '@/app/undo'
import { EVERY_MONTHS_OPTIONS } from '@/domain/catalog'
import { MAX_LENGTHS } from '@/domain/constants'
import { addMonths, compareISO, isValidMonthKey, maxMonth, minMonth, ordinalDay } from '@/domain/dates'
import { formatPeriodName, formatPeriodTitle, periodOf } from '@/domain/period'
import { categoryDisplay, sortedCategories } from '@/domain/queries'
import { lineFor } from '@/domain/recurring'
import type { Category, Cents, MonthKey, Recurring, TxKind } from '@/domain/types'
import { overrideAt } from '@/features/fixed/fixedModel'
import { readDraft, removeDraft, writeDraft, type DraftFields, type RecurringRoute } from '@/features/fixed/recurringDraft'
import {
  canSave,
  changesPast,
  checkForm,
  editForm,
  effectiveStart,
  formChanged,
  newForm,
  planSave,
  thisMonthOffer,
  withInterval,
  type FormContext,
  type RecurringForm,
  type SavePlan,
} from '@/features/fixed/recurringForm'
import styles from '@/features/fixed/RecurringSheet.module.css'
import { actions } from '@/store/actions'
import { getData } from '@/store/appStore'
import { useCategoryMap, useData, useMoneyFormat, useMonthSummary, useSettings } from '@/store/hooks'
import { useToday } from '@/store/today'
import {
  AmountField,
  chooseDialog,
  EmptyState,
  ListRow,
  Money,
  Section,
  SelectField,
  SheetHeader,
  TextField,
  toast,
  Toggle,
  withTrueMinus,
  type SelectOption,
} from '@/ui'

/** "Usually paid on": not set, or a day of the month. */
const DUE_DAY_OPTIONS: SelectOption<number | null>[] = [
  { value: null, label: 'Not set' },
  ...Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: ordinalDay(i + 1) })),
]

/** How far the "Ends" picker reaches: two years back and three years ahead of the selected period. */
const END_MONTHS_BACK = 24
const END_MONTHS_AHEAD = 36

const DELETE_MESSAGE =
  'Stopping keeps it in past months. Deleting removes it from every month, including the past, and changes those totals.'

/**
 * Adds or edits a fixed cost or recurring income (docs/SPEC.md §3.6, DESIGN.md §9.16). The form
 * works in the period that was selected when it opened. Editing shows "This month" (the period's
 * paid, skip and different amount) above "Every month" (the item itself), then "Stop after" and
 * "Delete". A new item keeps a draft (§5.10).
 */
export function RecurringSheet({ route, onClose, setDirty }: SheetProps<'recurring'>) {
  const recurring = useData((d) => d.recurring)
  const stored = useMemo(
    () => (route.id === undefined ? undefined : recurring.find((r) => r.id === route.id)),
    [recurring, route.id],
  )
  // After Delete the sheet plays its exit with the item gone: keep showing what was there.
  const [opened] = useState(stored)
  const item = stored ?? opened
  if (route.id !== undefined && item === undefined) return <MissingItem kind={route.kind} onClose={onClose} />
  return <RecurringFormSheet route={route} item={item ?? null} onClose={onClose} setDirty={setDirty} />
}

function MissingItem({ kind, onClose }: { kind: TxKind | undefined; onClose(): void }) {
  return (
    <>
      <SheetHeader title={kind === 'income' ? 'Income' : 'Fixed cost'} onCancel={onClose} cancelLabel="Close" />
      <EmptyState title="This item no longer exists" message="It may have been deleted." />
    </>
  )
}

interface FormSheetProps {
  route: RecurringRoute
  item: Recurring | null
  onClose(): void
  setDirty(dirty: boolean): void
}

/** The draft's fields over a new form; a category that has gone since keeps the form's own. */
function withDraft(form: RecurringForm, draft: Partial<DraftFields>, categories: readonly Category[]): RecurringForm {
  const wanted = draft.categoryId
  const usable = form.categoryId !== null && typeof wanted === 'string' && sortedCategories(categories).some((c) => c.id === wanted)
  return { ...form, ...draft, categoryId: usable ? wanted : form.categoryId }
}

/** The last period of the cycle that starts in `month`, cut short where the item ends. */
function cycleEnd(item: Recurring, month: MonthKey): MonthKey {
  const last = addMonths(month, item.everyMonths - 1)
  return item.endMonth === null ? last : minMonth(last, item.endMonth)
}

/** Applies a saved edit: the item, then its amount, then this period's adjustments. */
function applyEdit(id: string, plan: Extract<SavePlan, { kind: 'edit' }>, scope: 'from' | 'all', month: MonthKey): void {
  if (plan.patch !== null) actions.updateRecurring(id, plan.patch)
  if (plan.amount !== null) actions.setRecurringAmount(id, plan.amount, scope === 'all' ? 'all' : month)
  if (plan.override !== null) {
    const data = getData()
    const r = data.recurring.find((x) => x.id === id)
    const line = r === undefined ? null : lineFor(r, month, data.months, data.settings.monthStartDay)
    // A new schedule can take the charge out of this period; then there is nothing to adjust.
    if (line?.isChargeMonth === true) actions.setOverride(month, id, plan.override)
  }
}

function RecurringFormSheet({ route, item, onClose, setDirty }: FormSheetProps) {
  const selectedMonth = useSelectedMonth()
  const settings = useSettings()
  const today = useToday()
  const categories = useData((d) => d.categories)
  const months = useData((d) => d.months)
  const categoryMap = useCategoryMap()
  const kind: TxKind = item?.kind ?? route.kind ?? 'expense'
  const startDay = settings.monthStartDay
  const locale = settings.locale
  const summary = useMonthSummary(selectedMonth)
  const money = useMoneyFormat()

  // Everything the form compares against is fixed when the sheet opens: the period, the item and
  // its line there, and the form it started from (a new item may resume its draft).
  const [setup] = useState(() => {
    const line =
      item === null
        ? null
        : ([...summary.fixedLines, ...summary.incomeLines].find((l) => l.recurring.id === item.id) ?? null)
    const context: FormContext = {
      kind,
      month: selectedMonth,
      item,
      line,
      override: item === null ? undefined : overrideAt(months, selectedMonth, item.id),
    }
    const pristine = item === null ? newForm(kind, selectedMonth, categories, route.preset) : editForm({ ...context, item })
    const draft = item === null ? readDraft(route) : null
    return { context, pristine, start: draft === null ? pristine : withDraft(pristine, draft, categories) }
  })
  const { context, pristine } = setup
  const month = context.month
  const [form, setForm] = useState(setup.start)
  const update = (patch: Partial<RecurringForm>) => setForm((f) => ({ ...f, ...patch }))

  const isNew = item === null
  const dirty = formChanged(form, pristine)
  const check = checkForm(form, pristine, context)
  const offer = thisMonthOffer(context)
  const current = periodOf(today, startDay)
  const monthName = formatPeriodTitle(month, current, startDay, locale)
  const n = form.everyMonths

  const bodyRef = useRef<HTMLDivElement>(null)
  const moreId = useId()
  const saving = useRef(false)
  const differentRef = useRef<HTMLInputElement>(null)

  // Unsaved changes make other dismissals ask first (§5.10 rule 5).
  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])

  // A new item's draft follows every change; it goes when the form is back as it started.
  useEffect(() => {
    if (!isNew) return
    if (dirty) writeDraft(route, form, Date.now())
    else removeDraft(route)
  }, [isNew, dirty, form, route])

  // Closing in any way (saved, cancelled, discarded) drops the draft; only a killed app keeps it.
  useEffect(
    () => () => {
      if (isNew) removeDraft(route)
    },
    [isNew, route],
  )

  const name = item?.name ?? ''

  const failed = () => {
    toast({ message: `Couldn't save ${form.name.trim() || 'this item'}. Check the fields and try again.`, tone: 'critical' })
  }

  const cancel = () => {
    if (isNew) removeDraft(route)
    onClose()
  }

  const save = async () => {
    if (saving.current || !canSave(check)) return
    const plan = planSave(form, pristine, context)
    if (plan.kind === 'add') {
      try {
        actions.addRecurring(plan.input)
      } catch {
        failed()
        return
      }
      removeDraft(route)
      onClose()
      return
    }
    if (item === null) return
    saving.current = true
    try {
      let scope: 'from' | 'all' = 'from'
      // An item charged in no month from this one on can only change everywhere: asking would
      // offer "From this month on", which changes nothing.
      if (plan.amount !== null && !plan.chargesAhead) scope = 'all'
      else if (plan.amount !== null) {
        const answer = await chooseDialog({
          title: 'Which months get the new amount?',
          options: [
            { value: 'from', label: 'From this month on' },
            { value: 'all', label: 'Every month, including the past' },
          ],
        })
        if (answer === null) return
        scope = answer
      }
      const apply = () => applyEdit(item.id, plan, scope, month)
      if (scope === 'all') await withUndo(`Changed ${name} in every month`, apply)
      else apply()
      onClose()
    } catch {
      failed()
    } finally {
      saving.current = false
    }
  }

  const canStop =
    item !== null &&
    compareISO(month, item.startMonth) >= 0 &&
    (item.endMonth === null || compareISO(item.endMonth, month) > 0)

  const stop = () => {
    if (item === null) return
    onClose()
    void withUndo(`Stopped ${name} after ${monthName}`, () => actions.updateRecurring(item.id, { endMonth: month }))
  }

  const remove = async () => {
    if (item === null) return
    const choice = await chooseDialog<'stop' | 'delete'>({
      title: `Remove ${name}?`,
      message: DELETE_MESSAGE,
      options: [
        ...(canStop ? [{ value: 'stop' as const, label: `Stop after ${monthName}` }] : []),
        { value: 'delete', label: 'Delete from all months', destructive: true },
      ],
    })
    if (choice === 'stop') stop()
    else if (choice === 'delete') {
      onClose()
      void withUndo(`Deleted ${name}`, () => actions.deleteRecurring(item.id))
    }
  }

  // "Different amount this month" opens with the keyboard up: the field is focused in the tap.
  const revealDifferent = () => {
    flushSync(() => update({ differentOpen: true }))
    differentRef.current?.focus()
  }

  const restoreUsualAmount = () => {
    flushSync(() => update({ differentOpen: false, differentAmount: null }))
    bodyRef.current?.querySelector<HTMLElement>('[data-testid="different-amount"] button')?.focus()
  }

  const categoryOptions = useMemo((): SelectOption<string | null>[] => {
    const active = sortedCategories(categories)
    const ordered = [...active.filter((c) => c.kind !== 'daily'), ...active.filter((c) => c.kind === 'daily')]
    const options: SelectOption<string | null>[] = ordered.map((c) => ({ value: c.id, label: c.name, icon: c.icon }))
    // An archived (or unknown) category of the item stays selectable, so the picker can show it.
    const own = form.categoryId
    if (own !== null && !active.some((c) => c.id === own)) {
      const display = categoryDisplay(own, categoryMap)
      options.push({ value: own, label: display.name, icon: display.icon })
    }
    return options
  }, [categories, categoryMap, form.categoryId])

  // One schedule for all time: a new interval or charge month re-plans the past as well (§3.6).
  const pastNote = changesPast(form, pristine, context)
    ? `Past months change too. To keep them as they are, stop this one after ${formatPeriodTitle(addMonths(month, -1), current, startDay, locale)} and add a new one.`
    : undefined

  const start = effectiveStart(form, pristine, context)
  const endOptions = useMemo((): SelectOption<MonthKey | null>[] => {
    const first = maxMonth(start, addMonths(month, -END_MONTHS_BACK))
    const last = addMonths(maxMonth(month, start), END_MONTHS_AHEAD)
    const keys: MonthKey[] = []
    for (let key = first; compareISO(key, last) <= 0; key = addMonths(key, 1)) keys.push(key)
    const end = form.endMonth
    if (end !== null && !keys.includes(end)) keys.push(end)
    keys.sort(compareISO)
    return [
      { value: null, label: 'Never' },
      ...keys.map((key) => ({ value: key, label: formatPeriodName(key, startDay, locale, { withYear: true }) })),
    ]
  }, [start, month, form.endMonth, startDay, locale])

  const dueDayField = (
    <SelectField
      label={kind === 'income' ? 'Usually arrives on' : 'Usually paid on'}
      value={form.dueDay}
      options={DUE_DAY_OPTIONS}
      onChange={(dueDay) => update({ dueDay })}
    />
  )

  const moreOptions: ReactNode = (
    <>
      {/* An action row that reveals the rows after it (DESIGN.md §9.8 disclosure rows). */}
      <ListRow
        title="More options"
        tinted
        chevron="down"
        expanded={form.moreOpen}
        controls={form.moreOpen ? moreId : undefined}
        onClick={() => update({ moreOpen: !form.moreOpen })}
      />
      {form.moreOpen && (
        // One row for the hairline under the head; the fields inside keep their own.
        <div id={moreId} data-row="">
          {n === 1 && (
            <TextField
              variant="form"
              type="month"
              label="Starts"
              value={form.startMonth}
              onChange={(value) => {
                if (isValidMonthKey(value)) update({ startMonth: value })
              }}
            />
          )}
          <SelectField label="Ends" value={form.endMonth} options={endOptions} onChange={(endMonth) => update({ endMonth })} />
          <TextField
            label="Note"
            value={form.note}
            maxLength={MAX_LENGTHS.note}
            placeholder="Optional"
            onChange={(note) => update({ note })}
          />
        </div>
      )}
    </>
  )

  return (
    <>
      <SheetHeader
        title={isNew ? (kind === 'income' ? 'New income' : 'New fixed cost') : name}
        onCancel={cancel}
        action={{ label: isNew ? 'Add' : 'Save', onClick: () => void save(), disabled: !canSave(check), 'data-testid': 'sheet-save' }}
      />
      <div ref={bodyRef} className={styles.body}>
        {offer !== null && item !== null && (
          <Section
            variant="form"
            context="sheet"
            className={styles.firstTitled}
            title={month === current ? 'This month' : monthName}
            footer={
              item.spread && item.everyMonths > 1
                ? `These apply to the whole cycle, ${monthName} to ${formatPeriodTitle(cycleEnd(item, month), current, startDay, locale)}.`
                : undefined
            }
          >
            {offer.paid && (
              <Toggle
                label={kind === 'income' ? 'Received' : 'Paid'}
                checked={form.paid && !form.skipped}
                disabled={form.skipped}
                onChange={(paid) => update({ paid })}
              />
            )}
            {offer.skip && (
              <Toggle label="Skip this month" checked={form.skipped} onChange={(skipped) => update({ skipped })} />
            )}
            {form.differentOpen ? (
              <>
                <AmountField
                  inputRef={differentRef}
                  label="Different amount this month"
                  // The usual amount, as what the field replaces (masked while amounts are hidden).
                  placeholder={pristine.amount === null ? undefined : withTrueMinus(money.format(pristine.amount))}
                  value={form.differentAmount}
                  error={check.different}
                  onChange={(differentAmount) => update({ differentAmount })}
                />
                <ListRow title="Use the usual amount" tinted onClick={restoreUsualAmount} />
              </>
            ) : (
              <ListRow
                title="Different amount this month"
                detail="Off"
                chevron
                onClick={revealDifferent}
                data-testid="different-amount"
              />
            )}
          </Section>
        )}

        <Section
          variant="form"
          context="sheet"
          title={isNew ? undefined : 'Every month'}
          className={offer !== null ? undefined : isNew ? styles.firstUntitled : styles.firstTitled}
          footer={n === 1 ? pastNote : undefined}
        >
          <TextField
            variant="form"
            label="Name"
            value={form.name}
            maxLength={MAX_LENGTHS.recurring}
            placeholder="Required"
            autoComplete="off"
            onChange={(value) => update({ name: value })}
          />
          <AmountField
            label="Amount"
            value={form.amount}
            error={check.amount}
            onChange={(amount) => update({ amount })}
          />
          {kind === 'expense' && (
            <SelectField
              label="Category"
              value={form.categoryId}
              options={categoryOptions}
              onChange={(categoryId) => update({ categoryId })}
            />
          )}
          <SelectField
            label="How often"
            value={form.everyMonths}
            options={EVERY_MONTHS_OPTIONS}
            onChange={(everyMonths) => setForm((f) => withInterval(f, everyMonths))}
          />
          {n === 1 && dueDayField}
          {n === 1 && moreOptions}
        </Section>

        {n > 1 && (
          <Section variant="form" context="sheet" footer={pastNote ?? "Pick any month it's charged in."}>
            <TextField
              variant="form"
              type="month"
              label="Charged in"
              value={form.chargedIn}
              onChange={(value) => {
                if (isValidMonthKey(value)) update({ chargedIn: value })
              }}
            />
            <Toggle
              label={`Spread over ${n} months`}
              description={<SpreadLine amount={form.amount} everyMonths={n} />}
              checked={form.spread}
              onChange={(spread) => update({ spread, spreadTouched: true })}
            />
          </Section>
        )}
        {n > 1 && (
          <Section variant="form" context="sheet">
            {dueDayField}
            {moreOptions}
          </Section>
        )}
        {check.end !== undefined && <p className={styles.error}>{check.end}</p>}

        {item !== null && (
          <Section variant="form" context="sheet" className={styles.actions}>
            {canStop && <ListRow title={`Stop after ${monthName}`} tinted onClick={stop} />}
            <ListRow title="Delete" destructive onClick={() => void remove()} />
          </Section>
        )}
      </div>
    </>
  )
}

/**
 * The spread toggle's live line (§3.6): "Counts {amount / N} every month instead of {amount} once
 * a year" (or "every {N} months").
 */
function SpreadLine({ amount, everyMonths }: { amount: Cents | null; everyMonths: number }) {
  const once = everyMonths === 12 ? 'once a year' : `every ${everyMonths} months`
  if (amount === null || amount <= 0) return `Counts a share every month instead of the full amount ${once}`
  return (
    <>
      Counts <Money cents={Math.floor(amount / everyMonths)} /> every month instead of <Money cents={amount} /> {once}
    </>
  )
}
