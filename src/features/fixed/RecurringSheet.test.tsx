import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav, type SheetProps } from '@/app/nav'
import { LS_KEYS } from '@/domain/constants'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, makeRecurring, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData, Recurring } from '@/domain/types'
import { RecurringSheet } from '@/features/fixed/RecurringSheet'
import { getData, useAppStore } from '@/store/appStore'
import { ConfirmHost, ToastHost } from '@/ui'
import { answerDialog, currentDialog, removeDialog } from '@/ui/dialogs'
import { currentToast, dismissToast } from '@/ui/toast'

// Today is Wednesday 14 October 2026 (NOW); the sheet works in the selected period, October.

const C = DEFAULT_CATEGORY_IDS

const netflix = makeRecurring({
  id: 'netflix',
  name: 'Netflix',
  categoryId: C.subscriptions,
  amounts: [{ from: '2026-08', amount: 1399 }],
  dueDay: 22,
  order: 1,
})
const phone = makeRecurring({ id: 'phone', name: 'Phone', categoryId: C.phone, amounts: [{ from: '2026-08', amount: 1500 }], dueDay: 28, order: 2 })
const insurance = makeRecurring({
  id: 'insurance',
  name: 'Liability insurance',
  categoryId: C.insurance,
  amounts: [{ from: '2026-09', amount: 6000 }],
  everyMonths: 12,
  spread: true,
  startMonth: '2026-09',
  dueDay: 15,
  order: 3,
})

function data(recurring: Recurring[] = [netflix, phone, insurance], months: AppData['months'] = {}): AppData {
  const base = makeData()
  return { ...base, settings: { ...base.settings, onboarded: true }, recurring, months }
}

function item(id: string): Recurring | undefined {
  return getData().recurring.find((r) => r.id === id)
}

type Route = SheetProps<'recurring'>['route']

function renderSheet(route: Route) {
  const onClose = vi.fn<() => void>()
  const setDirty = vi.fn<(dirty: boolean) => void>()
  const view = render(
    <>
      <div id="app-root">
        <RecurringSheet route={route} onClose={onClose} setDirty={setDirty} />
      </div>
      <ConfirmHost />
      <ToastHost />
    </>,
  )
  return { ...view, onClose, setDirty }
}

const save = () => screen.getByTestId('sheet-save')

/** Answers the action sheet that asks from when a new amount applies. */
async function choose(label: string): Promise<void> {
  const dialog = await screen.findByRole('dialog', { name: 'Which months get the new amount?' })
  await userEvent.click(within(dialog).getByRole('button', { name: label }))
}

/** Intl puts a no-break space before the euro sign. */
function eur(amount: string): string {
  return `${amount} €`
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  __resetNavForTests()
  useAppStore.setState({ data: data(), status: 'ready' })
})

afterEach(async () => {
  cleanup()
  for (let dialog = currentDialog(); dialog !== null; dialog = currentDialog()) {
    answerDialog(dialog.id, null)
    removeDialog(dialog.id)
  }
  const shown = currentToast()
  if (shown !== null) dismissToast(shown.id)
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  localStorage.clear()
  vi.useRealTimers()
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
})

describe('editing: this month (docs/SPEC.md §3.6)', () => {
  it('shows the item with "This month" above "Every month"', () => {
    renderSheet({ name: 'recurring', id: 'netflix', kind: 'expense' })
    expect(screen.getByRole('heading', { name: 'Netflix' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Netflix',
      'This month',
      'Every month',
    ])
    expect(screen.getByRole('switch', { name: 'Paid' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Skip this month' })).not.toBeChecked()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Netflix')
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue(eur('13,99'))
    expect(screen.getByRole('combobox', { name: 'Usually paid on' })).toHaveDisplayValue('22nd')
    expect(screen.getByRole('button', { name: 'Stop after October' })).toBeInTheDocument()
  })

  it('skips this month only', async () => {
    const user = userEvent.setup()
    const { onClose, setDirty } = renderSheet({ name: 'recurring', id: 'netflix', kind: 'expense' })
    await user.click(screen.getByRole('switch', { name: 'Skip this month' }))
    expect(setDirty).toHaveBeenLastCalledWith(true)
    // Nothing is paid in a skipped month.
    expect(screen.getByRole('switch', { name: 'Paid' })).toBeDisabled()
    await user.click(save())
    expect(getData().months['2026-10']?.overrides?.netflix).toEqual({ skipped: true })
    expect(item('netflix')?.amounts).toEqual(netflix.amounts)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ticks it off as paid', async () => {
    const user = userEvent.setup()
    renderSheet({ name: 'recurring', id: 'netflix', kind: 'expense' })
    await user.click(screen.getByRole('switch', { name: 'Paid' }))
    await user.click(save())
    expect(getData().months['2026-10']?.overrides?.netflix).toEqual({ paid: true })
  })

  it('takes a different amount this month, and the usual one again', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ name: 'recurring', id: 'netflix', kind: 'expense' })
    expect(screen.queryByRole('textbox', { name: 'Different amount this month' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Different amount this month/ }))
    const field = screen.getByRole('textbox', { name: 'Different amount this month' })
    // It opens ready to type, with the usual amount as the hint.
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('placeholder', eur('13,99'))
    await user.type(field, '5,99')
    await user.click(save())
    expect(getData().months['2026-10']?.overrides?.netflix).toEqual({ amount: 599 })
    expect(onClose).toHaveBeenCalledOnce()
    cleanup()

    renderSheet({ name: 'recurring', id: 'netflix', kind: 'expense' })
    expect(screen.getByRole('textbox', { name: 'Different amount this month' })).toHaveValue(eur('5,99'))
    await user.click(screen.getByRole('button', { name: 'Use the usual amount' }))
    expect(screen.queryByRole('textbox', { name: 'Different amount this month' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Different amount this month/ })).toHaveFocus()
    await user.click(save())
    expect(getData().months['2026-10']).toBeUndefined()
  })

  it('names another period and offers nothing outside a spread item’s charge month', () => {
    act(() => useNav.getState().setMonth('2026-09'))
    renderSheet({ name: 'recurring', id: 'insurance', kind: 'expense' })
    expect(screen.getByRole('heading', { name: 'September' })).toBeInTheDocument()
    // A spread item is skipped only as a whole cycle, and that is not offered.
    expect(screen.queryByRole('switch', { name: 'Skip this month' })).toBeNull()
    expect(screen.getByText('These apply to the whole cycle, September to August 2027.')).toBeInTheDocument()
    cleanup()

    act(() => useNav.getState().setMonth(null))
    renderSheet({ name: 'recurring', id: 'insurance', kind: 'expense' })
    expect(screen.queryByRole('heading', { name: 'This month' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Paid' })).toBeNull()
  })
})

describe('editing: every month (§3.6)', () => {
  it('asks from when a new amount applies: from this month on', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ name: 'recurring', id: 'netflix', kind: 'expense' })
    const amount = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '15,99')
    await user.click(save())
    const question = await screen.findByRole('dialog', { name: 'Which months get the new amount?' })
    expect(within(question).getByRole('button', { name: 'Every month, including the past' })).toBeInTheDocument()
    await choose('From this month on')
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(item('netflix')?.amounts).toEqual([
      { from: '2026-08', amount: 1399 },
      { from: '2026-10', amount: 1599 },
    ])
    expect(currentToast()).toBeNull()
  })

  it('changes every month, including the past, with Undo', async () => {
    const user = userEvent.setup()
    const before = getData()
    renderSheet({ name: 'recurring', id: 'netflix', kind: 'expense' })
    const amount = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '15,99')
    await user.click(save())
    await choose('Every month, including the past')
    await waitFor(() => expect(item('netflix')?.amounts).toEqual([{ from: '2026-08', amount: 1599 }]))
    const toast = await screen.findByTestId('toast')
    expect(toast).toHaveTextContent('Changed Netflix in every month')
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(getData()).toBe(before)
  })

  it('changes an item that already ended in every month, without asking', async () => {
    const user = userEvent.setup()
    const gym = makeRecurring({
      id: 'gym',
      name: 'Gym',
      categoryId: C.health,
      amounts: [{ from: '2026-05', amount: 2990 }],
      startMonth: '2026-05',
      endMonth: '2026-08',
      dueDay: 3,
    })
    useAppStore.setState({ data: data([netflix, gym]) })
    const before = getData()
    const { onClose } = renderSheet({ name: 'recurring', id: 'gym', kind: 'expense' })
    const amount = screen.getByRole('textbox', { name: 'Amount' })
    expect(amount).toHaveValue(eur('29,90'))
    await user.clear(amount)
    await user.type(amount, '34,90')
    await user.click(save())
    // "From this month on" would change nothing: there are no months from October on.
    await waitFor(() => expect(item('gym')?.amounts).toEqual([{ from: '2026-05', amount: 3490 }]))
    expect(currentDialog()).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onClose).toHaveBeenCalledOnce()
    const toast = await screen.findByTestId('toast')
    expect(toast).toHaveTextContent('Changed Gym in every month')
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(getData()).toBe(before)
  })

  it('keeps the sheet open when the question is cancelled', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ name: 'recurring', id: 'netflix', kind: 'expense' })
    const amount = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '15,99')
    await user.click(save())
    await choose('Cancel')
    expect(onClose).not.toHaveBeenCalled()
    expect(item('netflix')?.amounts).toEqual(netflix.amounts)
  })

  it('saves the other fields without asking', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ name: 'recurring', id: 'netflix', kind: 'expense' })
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Netflix Premium')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Usually paid on' }), '1st')
    await user.click(save())
    expect(item('netflix')).toMatchObject({ name: 'Netflix Premium', dueDay: 1 })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('stops after this month at once, with Undo', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ name: 'recurring', id: 'phone', kind: 'expense' })
    await user.click(screen.getByRole('button', { name: 'Stop after October' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(item('phone')?.endMonth).toBe('2026-10')
    const toast = await screen.findByTestId('toast')
    expect(toast).toHaveTextContent('Stopped Phone after October')
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(item('phone')?.endMonth).toBeNull()
  })

  it('deletes from all months after asking, with Undo', async () => {
    const user = userEvent.setup()
    const before = getData()
    const { onClose } = renderSheet({ name: 'recurring', id: 'netflix', kind: 'expense' })
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove Netflix?' })
    expect(dialog).toHaveTextContent(
      'Stopping keeps it in past months. Deleting removes it from every month, including the past, and changes those totals.',
    )
    expect(within(dialog).getByRole('button', { name: 'Stop after October' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Delete from all months' }))
    await waitFor(() => expect(item('netflix')).toBeUndefined())
    expect(onClose).toHaveBeenCalledOnce()
    // The sheet keeps showing the item while it closes.
    expect(screen.getByRole('heading', { name: 'Netflix' })).toBeInTheDocument()
    const toast = await screen.findByTestId('toast')
    expect(toast).toHaveTextContent('Deleted Netflix')
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(getData()).toBe(before)
  })

  it('offers no stop for an item that has not started or already stops', () => {
    act(() => useNav.getState().setMonth('2026-07'))
    renderSheet({ name: 'recurring', id: 'netflix', kind: 'expense' })
    expect(screen.queryByRole('button', { name: /^Stop after/ })).toBeNull()
  })

  it('says when the item no longer exists', () => {
    renderSheet({ name: 'recurring', id: 'gone', kind: 'expense' })
    expect(screen.getByText('This item no longer exists')).toBeInTheDocument()
  })
})

describe('a new schedule (§3.6)', () => {
  const PAST_NOTE = 'Past months change too. To keep them as they are, stop this one after September and add a new one.'
  // Monthly since September.
  const gym = makeRecurring({
    id: 'gym',
    name: 'Gym',
    categoryId: C.health,
    amounts: [{ from: '2026-09', amount: 2990 }],
    startMonth: '2026-09',
    dueDay: 3,
  })

  it('says that past months change too, and how to keep them', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ data: data([gym]) })
    renderSheet({ name: 'recurring', id: 'gym', kind: 'expense' })
    expect(screen.queryByText(PAST_NOTE)).toBeNull()
    await user.selectOptions(screen.getByRole('combobox', { name: 'How often' }), 'Yearly')
    expect(screen.getByText(PAST_NOTE)).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'How often' }), 'Monthly')
    expect(screen.queryByText(PAST_NOTE)).toBeNull()
  })

  it('says so for a new charge month, in place of the hint', () => {
    renderSheet({ name: 'recurring', id: 'insurance', kind: 'expense' })
    expect(screen.getByText("Pick any month it's charged in.")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Charged in'), { target: { value: '2027-03' } })
    expect(screen.getByText(PAST_NOTE)).toBeInTheDocument()
    expect(screen.queryByText("Pick any month it's charged in.")).toBeNull()
  })

  it('says nothing for a new item or an unchanged interval', async () => {
    const user = userEvent.setup()
    renderSheet({ name: 'recurring', kind: 'expense' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'How often' }), 'Yearly')
    expect(screen.queryByText(/^Past months change too/)).toBeNull()
    cleanup()

    useAppStore.setState({ data: data([gym]) })
    renderSheet({ name: 'recurring', id: 'gym', kind: 'expense' })
    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' and pool')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Usually paid on' }), '5th')
    expect(screen.queryByText(/^Past months change too/)).toBeNull()
  })
})

describe('adding (§3.5, §3.6)', () => {
  it('starts from a suggestion and adds it in the selected month', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({
      name: 'recurring',
      kind: 'expense',
      preset: { name: 'Spotify', categoryId: C.subscriptions, everyMonths: 1 },
    })
    expect(screen.getByRole('heading', { name: 'New fixed cost' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Spotify')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveDisplayValue('Subscriptions')
    // No price is filled in, so there is nothing to add yet.
    expect(save()).toBeDisabled()
    expect(save()).toHaveTextContent('Add')
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '11,99')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Usually paid on' }), '5th')
    expect(save()).toBeEnabled()
    await user.click(save())
    expect(getData().recurring.at(-1)).toMatchObject({
      kind: 'expense',
      name: 'Spotify',
      categoryId: C.subscriptions,
      amounts: [{ from: '2026-10', amount: 1199 }],
      everyMonths: 1,
      startMonth: '2026-10',
      endMonth: null,
      dueDay: 5,
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('orders categories fixed and both first', () => {
    renderSheet({ name: 'recurring', kind: 'expense' })
    const options = within(screen.getByRole('combobox', { name: 'Category' }))
      .getAllByRole('option')
      .filter((option) => !option.hidden)
      .map((option) => option.textContent)
    expect(options.slice(0, 5)).toEqual(['Rent', 'Subscriptions', 'Transport', 'Phone & internet', 'Insurance'])
    expect(options.at(-1)).toBe('Health')
  })

  it('charges items less often than monthly in a month of choice, spread by default for a year', async () => {
    const user = userEvent.setup()
    renderSheet({ name: 'recurring', kind: 'expense' })
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Insurance')
    await user.selectOptions(screen.getByRole('combobox', { name: 'How often' }), 'Yearly')
    const spread = screen.getByRole('switch', { name: 'Spread over 12 months' })
    expect(spread).toBeChecked()
    expect(screen.getByText("Pick any month it's charged in.")).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '60')
    expect(spread).toHaveAccessibleDescription(/^Counts 5,00\s€ every month instead of 60,00\s€ once a year$/)
    fireEvent.change(screen.getByLabelText('Charged in'), { target: { value: '2027-03' } })
    await user.click(save())
    expect(getData().recurring.at(-1)).toMatchObject({
      name: 'Insurance',
      everyMonths: 12,
      spread: true,
      // March 2027 moved back a whole year, so it already counts in October.
      startMonth: '2026-03',
    })
  })

  it('keeps every 3 months unspread unless asked', async () => {
    const user = userEvent.setup()
    renderSheet({ name: 'recurring', kind: 'expense' })
    await user.selectOptions(screen.getByRole('combobox', { name: 'How often' }), 'Every 3 months')
    const spread = screen.getByRole('switch', { name: 'Spread over 3 months' })
    expect(spread).not.toBeChecked()
    expect(spread).toHaveAccessibleDescription('Counts a share every month instead of the full amount every 3 months')
  })

  it('says when it would end before it starts', async () => {
    const user = userEvent.setup()
    renderSheet({ name: 'recurring', kind: 'expense' })
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Gym')
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '29,90')
    const more = screen.getByRole('button', { name: 'More options' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).not.toHaveAttribute('aria-controls')
    await user.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    // The disclosure names the rows it shows.
    const rows = document.getElementById(more.getAttribute('aria-controls') ?? '')
    expect(rows).not.toBeNull()
    expect(within(rows as HTMLElement).getByRole('combobox', { name: 'Ends' })).toBeInTheDocument()
    expect(within(rows as HTMLElement).getByRole('textbox', { name: 'Note' })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ends' }), 'November 2026')
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-12' } })
    expect(screen.getByText("It can't end before it starts. Pick a later month.")).toBeInTheDocument()
    expect(save()).toBeDisabled()
  })

  it('adds income without a category', async () => {
    const user = userEvent.setup()
    renderSheet({ name: 'recurring', kind: 'income' })
    expect(screen.getByRole('heading', { name: 'New income' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Category' })).toBeNull()
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Job')
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '1100')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Usually arrives on' }), '1st')
    await user.click(save())
    expect(getData().recurring.at(-1)).toMatchObject({ kind: 'income', name: 'Job', categoryId: null, dueDay: 1 })
  })
})

describe('drafts and unsaved changes (§5.10)', () => {
  const route: Route = { name: 'recurring', kind: 'expense' }

  it('keeps a draft of a new item while it is typed, and drops it on cancel', async () => {
    const user = userEvent.setup()
    const { onClose, setDirty } = renderSheet(route)
    expect(setDirty).toHaveBeenLastCalledWith(false)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Gym')
    expect(setDirty).toHaveBeenLastCalledWith(true)
    const draft = JSON.parse(localStorage.getItem(LS_KEYS.draft) ?? 'null') as { route: unknown; fields: { name: string }; savedAt: number }
    expect(draft.route).toEqual(route)
    expect(draft.fields.name).toBe('Gym')
    expect(draft.savedAt).toBe(NOW)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(localStorage.getItem(LS_KEYS.draft)).toBeNull()
  })

  it('reopens with the draft’s fields', () => {
    localStorage.setItem(
      LS_KEYS.draft,
      JSON.stringify({ route, savedAt: NOW, fields: { name: 'Gym', amount: 2990, categoryId: C.subscriptions, dueDay: 15 } }),
    )
    const { setDirty } = renderSheet(route)
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Gym')
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveValue(eur('29,90'))
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveDisplayValue('Subscriptions')
    expect(screen.getByRole('combobox', { name: 'Usually paid on' })).toHaveDisplayValue('15th')
    expect(setDirty).toHaveBeenLastCalledWith(true)
  })

  it('drops the draft once the item is added, and when the sheet goes', async () => {
    const user = userEvent.setup()
    const view = renderSheet(route)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Gym')
    expect(localStorage.getItem(LS_KEYS.draft)).not.toBeNull()
    view.unmount()
    expect(localStorage.getItem(LS_KEYS.draft)).toBeNull()

    renderSheet(route)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Gym')
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '29,90')
    await user.click(save())
    expect(localStorage.getItem(LS_KEYS.draft)).toBeNull()
  })

  it('never keeps a draft of an edit, and is clean until something changes', async () => {
    const user = userEvent.setup()
    const { setDirty } = renderSheet({ name: 'recurring', id: 'netflix', kind: 'expense' })
    expect(setDirty).toHaveBeenLastCalledWith(false)
    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' 4K')
    expect(setDirty).toHaveBeenLastCalledWith(true)
    expect(localStorage.getItem(LS_KEYS.draft)).toBeNull()
  })
})
