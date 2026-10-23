import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { lineFor } from '@/domain/recurring'
import { makeData, makeRecurring } from '@/domain/test-helpers/dataFixtures'
import type { AppData, MonthKey, Recurring } from '@/domain/types'
import {
  canSave,
  changesPast,
  checkForm,
  defaultSpread,
  editForm,
  effectiveStart,
  formChanged,
  newForm,
  planSave,
  startFromChargedIn,
  startingCategory,
  thisMonthOffer,
  usualAmount,
  withInterval,
  type FormContext,
  type RecurringForm,
} from '@/features/fixed/recurringForm'

const OCT: MonthKey = '2026-10'
const categories = makeData().categories

const netflix = makeRecurring({
  id: 'netflix',
  name: 'Netflix',
  categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
  amounts: [{ from: '2026-08', amount: 1399 }],
  dueDay: 22,
})
const insurance = makeRecurring({
  id: 'insurance',
  name: 'Liability insurance',
  categoryId: DEFAULT_CATEGORY_IDS.insurance,
  amounts: [{ from: '2026-09', amount: 6000 }],
  everyMonths: 12,
  spread: true,
  startMonth: '2026-09',
})

function editContext(item: Recurring, month: MonthKey = OCT, months: AppData['months'] = {}): FormContext & { item: Recurring } {
  const override = months[month]?.overrides?.[item.id]
  return { kind: item.kind, month, item, line: lineFor(item, month, months, 1), override }
}

function newContext(kind: 'expense' | 'income' = 'expense'): FormContext {
  return { kind, month: OCT, item: null, line: null, override: undefined }
}

describe('new items (docs/SPEC.md §3.5, §3.6)', () => {
  it('starts from the preset, in the selected month, without a price', () => {
    const form = newForm('expense', OCT, categories, {
      name: 'Insurance',
      categoryId: DEFAULT_CATEGORY_IDS.insurance,
      everyMonths: 12,
    })
    expect(form).toMatchObject({
      name: 'Insurance',
      amount: null,
      categoryId: DEFAULT_CATEGORY_IDS.insurance,
      everyMonths: 12,
      spread: true,
      startMonth: OCT,
      chargedIn: OCT,
      endMonth: null,
      dueDay: null,
    })
  })

  it('falls back to the first active fixed category for a missing or archived one', () => {
    const archived = categories.map((c) => (c.id === DEFAULT_CATEGORY_IDS.subscriptions ? { ...c, archived: true } : c))
    expect(startingCategory(archived, DEFAULT_CATEGORY_IDS.subscriptions)).toBe(DEFAULT_CATEGORY_IDS.rent)
    expect(startingCategory(categories, 'cat-gone')).toBe(DEFAULT_CATEGORY_IDS.rent)
    expect(startingCategory(categories, undefined)).toBe(DEFAULT_CATEGORY_IDS.rent)
    expect(startingCategory(categories, DEFAULT_CATEGORY_IDS.coffee)).toBe(DEFAULT_CATEGORY_IDS.coffee)
    expect(startingCategory([], undefined)).toBeNull()
  })

  it('gives income no category', () => {
    expect(newForm('income', OCT, categories, undefined).categoryId).toBeNull()
  })

  it('spreads items charged every 6 or 12 months by default, not every 2 or 3', () => {
    expect([1, 2, 3, 6, 12].map((n) => defaultSpread(n as 1 | 2 | 3 | 6 | 12))).toEqual([false, false, false, true, true])
    const form = newForm('expense', OCT, categories, undefined)
    expect(withInterval(form, 12).spread).toBe(true)
    expect(withInterval(withInterval(form, 12), 3).spread).toBe(false)
    // Set by hand, the toggle keeps its state.
    expect(withInterval({ ...form, everyMonths: 3, spread: true, spreadTouched: true }, 6).spread).toBe(true)
  })

  it('adds what the form holds', () => {
    const form: RecurringForm = {
      ...newForm('expense', OCT, categories, undefined),
      name: '  Cloud storage ',
      amount: 299,
      categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
      note: ' 2 TB ',
    }
    expect(planSave(form, form, newContext())).toEqual({
      kind: 'add',
      input: {
        kind: 'expense',
        name: 'Cloud storage',
        categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
        amount: 299,
        everyMonths: 1,
        spread: false,
        startMonth: OCT,
        endMonth: null,
        dueDay: null,
        note: '2 TB',
      },
    })
  })
})

describe('"Charged in" (§3.6)', () => {
  it('moves a later month back by whole cycles, so the item already counts in the selected month', () => {
    expect(startFromChargedIn('2027-03', OCT, 12)).toBe('2026-03')
    expect(startFromChargedIn('2026-12', OCT, 3)).toBe('2026-09')
    expect(startFromChargedIn('2027-04', OCT, 3)).toBe('2026-10')
    expect(startFromChargedIn('2026-11', OCT, 2)).toBe('2026-09')
    expect(startFromChargedIn(OCT, OCT, 6)).toBe(OCT)
    expect(startFromChargedIn('2026-03', OCT, 12)).toBe('2026-03')
  })

  it('starts monthly items in "Starts", the others from "Charged in"', () => {
    const form = newForm('expense', OCT, categories, undefined)
    expect(effectiveStart({ ...form, startMonth: '2026-12' }, form, newContext())).toBe('2026-12')
    const yearly = withInterval({ ...form, chargedIn: '2027-03' }, 12)
    expect(effectiveStart(yearly, form, newContext())).toBe('2026-03')
    expect(planSave({ ...yearly, name: 'Insurance', amount: 12000 }, form, newContext())).toMatchObject({
      kind: 'add',
      input: { everyMonths: 12, spread: true, startMonth: '2026-03' },
    })
  })

  it('shows the next charge when editing and keeps the item’s start unless the charge month changes', () => {
    const context = editContext(insurance)
    const form = editForm(context)
    expect(form.chargedIn).toBe('2027-09')
    expect(effectiveStart(form, form, context)).toBe('2026-09')
    expect(effectiveStart({ ...form, chargedIn: '2027-03' }, form, context)).toBe('2026-03')
    // A new interval anchors the item on its charge month: September 2027, two half-years back.
    expect(effectiveStart(withInterval(form, 6), form, context)).toBe('2026-09')
  })
})

describe('editing (§3.6)', () => {
  it('fills the form from the item and its line', () => {
    const months: AppData['months'] = { [OCT]: { overrides: { netflix: { paid: true, amount: 999 } } } }
    const form = editForm(editContext(netflix, OCT, months))
    expect(form).toMatchObject({
      name: 'Netflix',
      amount: 1399,
      categoryId: DEFAULT_CATEGORY_IDS.subscriptions,
      dueDay: 22,
      paid: true,
      skipped: false,
      differentAmount: 999,
      differentOpen: true,
      moreOpen: false,
    })
    expect(editForm(editContext({ ...netflix, note: 'Shared' })).moreOpen).toBe(true)
  })

  it('offers this month’s controls on charge lines only, and no skip for spread items', () => {
    expect(thisMonthOffer(editContext(netflix))).toEqual({ paid: true, skip: true, amount: true })
    expect(thisMonthOffer(editContext(insurance))).toBeNull()
    expect(thisMonthOffer(editContext(insurance, '2026-09'))).toEqual({ paid: true, skip: false, amount: true })
    expect(thisMonthOffer(newContext())).toBeNull()
    expect(thisMonthOffer(editContext(netflix, '2026-07'))).toBeNull()
  })

  it('uses the cycle’s amount for spread items', () => {
    const changed = { ...insurance, amounts: [...insurance.amounts, { from: '2026-12' as MonthKey, amount: 7200 }] }
    expect(usualAmount(changed, OCT)).toBe(6000)
    expect(usualAmount(netflix, OCT)).toBe(1399)
    expect(usualAmount({ ...netflix, startMonth: '2027-01', amounts: [{ from: '2027-01', amount: 1599 }] }, OCT)).toBe(1599)
  })

  it('saves only what changed', () => {
    const context = editContext(netflix)
    const initial = editForm(context)
    expect(planSave(initial, initial, context)).toEqual({
      kind: 'edit',
      patch: null,
      amount: null,
      override: null,
      chargesAhead: true,
    })
    const form = { ...initial, name: 'Netflix Premium ', dueDay: 1, amount: 1799 }
    expect(planSave(form, initial, context)).toEqual({
      kind: 'edit',
      patch: { name: 'Netflix Premium', dueDay: 1 },
      amount: 1799,
      override: null,
      chargesAhead: true,
    })
  })

  it('knows when an item is charged in no period from the selected one on', () => {
    const ended = { ...netflix, endMonth: '2026-08' as MonthKey }
    const endedContext = editContext(ended)
    const endedForm = editForm(endedContext)
    expect(planSave({ ...endedForm, amount: 1599 }, endedForm, endedContext)).toMatchObject({
      amount: 1599,
      chargesAhead: false,
    })
    // Extended again in the same edit, it has months ahead.
    expect(planSave({ ...endedForm, amount: 1599, endMonth: null }, endedForm, endedContext)).toMatchObject({
      patch: { endMonth: null },
      chargesAhead: true,
    })
    // A yearly item whose last charge came before the selected month, though it ends after it:
    // unspread it has no line in October, spread its cycle's amount was fixed in September.
    const lastCycle = { ...insurance, startMonth: '2025-09' as MonthKey, endMonth: '2026-12' as MonthKey }
    for (const item of [lastCycle, { ...lastCycle, spread: false }]) {
      const context = editContext(item)
      const form = editForm(context)
      expect(planSave({ ...form, amount: 7200 }, form, context)).toMatchObject({ chargesAhead: false })
    }
    // Not started yet, or charged again later: a new amount still has months to go to.
    for (const context of [editContext(netflix, '2026-07'), editContext(insurance)]) {
      const form = editForm(context)
      expect(planSave({ ...form, amount: 7200 }, form, context)).toMatchObject({ chargesAhead: true })
    }
  })

  it('turns this month’s controls into one override change', () => {
    const context = editContext(netflix)
    const initial = editForm(context)
    expect(planSave({ ...initial, paid: true }, initial, context)).toMatchObject({ override: { paid: true } })
    // Nothing is paid in a skipped month.
    expect(planSave({ ...initial, paid: true, skipped: true }, initial, context)).toMatchObject({ override: { skipped: true } })
    expect(planSave({ ...initial, differentOpen: true, differentAmount: 599 }, initial, context)).toMatchObject({
      override: { amount: 599 },
    })
    // The usual amount, or nothing typed, is no different amount.
    expect(planSave({ ...initial, differentOpen: true, differentAmount: 1399 }, initial, context)).toMatchObject({
      override: null,
    })
    expect(planSave({ ...initial, differentOpen: true, differentAmount: null }, initial, context)).toMatchObject({
      override: null,
    })
  })

  it('clears a different amount with "Use the usual amount"', () => {
    const months: AppData['months'] = { [OCT]: { overrides: { netflix: { amount: 999 } } } }
    const context = editContext(netflix, OCT, months)
    const initial = editForm(context)
    const plan = planSave({ ...initial, differentOpen: false, differentAmount: null }, initial, context)
    expect(plan).toMatchObject({ override: { amount: null } })
  })

  it('saves spread only for items charged less often than monthly', () => {
    const context = editContext(insurance)
    const initial = editForm(context)
    expect(planSave({ ...initial, spread: false }, initial, context)).toMatchObject({ patch: { spread: false } })
    const monthly = withInterval(initial, 1)
    expect(planSave(monthly, initial, context)).toMatchObject({ patch: { everyMonths: 1, spread: false } })
  })
})

describe('checkForm', () => {
  const blank = newForm('expense', OCT, categories, undefined)

  it('keeps Save disabled until the required fields are filled', () => {
    const check = checkForm({ ...blank, categoryId: null }, blank, newContext())
    expect(check.missing).toEqual(['name', 'amount', 'category'])
    expect(canSave(check)).toBe(false)
    expect(canSave(checkForm({ ...blank, name: 'Gym', amount: 2990 }, blank, newContext()))).toBe(true)
  })

  it('needs no category for income', () => {
    const income = newForm('income', OCT, categories, undefined)
    expect(checkForm({ ...income, name: 'Job', amount: 110000 }, income, newContext('income')).missing).toEqual([])
  })

  it('says what is wrong with an amount of zero or an end before the start', () => {
    expect(checkForm({ ...blank, name: 'Gym', amount: 0 }, blank, newContext()).amount).toBe('Enter an amount above 0.')
    const check = checkForm({ ...blank, name: 'Gym', amount: 2990, endMonth: '2026-09' }, blank, newContext())
    expect(check.end).toBe("It can't end before it starts. Pick a later month.")
    expect(canSave(check)).toBe(false)
    expect(checkForm({ ...blank, name: 'Gym', amount: 2990, endMonth: OCT }, blank, newContext()).end).toBeUndefined()
  })

  it('counts only saved fields as changes', () => {
    expect(formChanged({ ...blank, moreOpen: true, differentOpen: true }, blank)).toBe(false)
    expect(formChanged({ ...blank, note: 'x' }, blank)).toBe(true)
  })
})

describe('a new schedule for an item with past months (§3.6)', () => {
  // Monthly since September; the sheet works in October.
  const gym = makeRecurring({ id: 'gym', name: 'Gym', amounts: [{ from: '2026-09', amount: 2990 }], startMonth: '2026-09' })

  it('says past months change when the interval or the charge month moves', () => {
    const context = editContext(gym)
    const initial = editForm(context)
    expect(changesPast(initial, initial, context)).toBe(false)
    expect(changesPast({ ...initial, name: 'Gym+', amount: 3490, dueDay: 3 }, initial, context)).toBe(false)
    expect(changesPast(withInterval(initial, 12), initial, context)).toBe(true)
    // Back to monthly, the schedule is the stored one again.
    expect(changesPast(withInterval(withInterval(initial, 12), 1), initial, context)).toBe(false)

    // Yearly since September 2026, next charged in September 2027.
    const yearly = editContext(insurance)
    const yearlyForm = editForm(yearly)
    expect(changesPast({ ...yearlyForm, chargedIn: '2027-03' }, yearlyForm, yearly)).toBe(true)
    expect(changesPast(withInterval(yearlyForm, 1), yearlyForm, yearly)).toBe(true)
    // Another month on the same schedule keeps the start, and so the past.
    expect(changesPast({ ...yearlyForm, chargedIn: '2026-09' }, yearlyForm, yearly)).toBe(false)
  })

  it('stays quiet for a new item and for one that starts in the selected month', () => {
    const blank = newForm('expense', OCT, categories, undefined)
    expect(changesPast(withInterval(blank, 12), blank, newContext())).toBe(false)
    const context = editContext(gym, '2026-09')
    const initial = editForm(context)
    expect(changesPast(withInterval(initial, 12), initial, context)).toBe(false)
  })
})
