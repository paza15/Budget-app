import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav } from '@/app/nav'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, makeQuickAdd, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { QuickAddSheet } from '@/features/you/QuickAddSheet'
import { QuickAddsScreen } from '@/features/you/QuickAddsScreen'
import { getData, useAppStore } from '@/store/appStore'
import { ConfirmHost, ToastHost } from '@/ui'
import { currentToast, dismissToast } from '@/ui/toast'

// Rendering whole screens is slow while the machine is busy; a real failure still fails.
vi.setConfig({ testTimeout: 30_000 })

const onClose = vi.fn<() => void>()
const setDirty = vi.fn<(dirty: boolean) => void>()

function seed(patch: Partial<AppData> = {}): void {
  useAppStore.setState({ data: makeData(patch), status: 'ready' })
}

function renderSheet(id?: string) {
  return render(
    <>
      <QuickAddSheet route={id === undefined ? { name: 'quickAdd' } : { name: 'quickAdd', id }} onClose={onClose} setDirty={setDirty} />
      <ToastHost />
      <ConfirmHost />
    </>,
  )
}

function ordered(): string[] {
  return getData()
    .quickAdds.toSorted((a, b) => a.order - b.order)
    .map(({ label }) => label)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  __resetNavForTests()
  onClose.mockReset()
  setDirty.mockReset()
  seed()
})

afterEach(() => {
  const toast = currentToast()
  if (toast) act(() => dismissToast(toast.id))
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('QuickAddsScreen (SPEC §3.7)', () => {
  it('lists the buttons in order with their amounts and opens each one', async () => {
    const user = userEvent.setup()
    render(<QuickAddsScreen />)
    const coffee = screen.getByRole('button', { name: /^Coffee/ })
    expect(coffee).toHaveTextContent('Coffee & snacks')
    expect(coffee).toHaveTextContent(/3,50\s€/)
    await user.click(coffee)
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'quickAdd', id: 'qa-coffee' })
    await user.click(screen.getByRole('button', { name: 'Add a button' }))
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'quickAdd' })
  })

  it('reorders with up and down buttons', async () => {
    const user = userEvent.setup()
    render(<QuickAddsScreen />)
    await user.click(screen.getByRole('button', { name: 'Reorder' }))
    expect(screen.getByRole('button', { name: 'Move Coffee up' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move Mensa up' }))
    expect(ordered()).toEqual(['Coffee', 'Mensa', 'Bakery'])
    await user.click(screen.getByRole('button', { name: 'Move Coffee down' }))
    expect(ordered()).toEqual(['Mensa', 'Coffee', 'Bakery'])
  })

  it('stops offering Add at eight buttons', () => {
    seed({ quickAdds: Array.from({ length: 8 }, (_, i) => makeQuickAdd({ id: `qa-${i}`, label: `Button ${i}`, order: i })) })
    render(<QuickAddsScreen />)
    expect(screen.queryByRole('button', { name: 'Add a button' })).toBeNull()
    expect(screen.getByText('You have 8, the most there can be. Delete one to add another.')).toBeInTheDocument()
  })

  it('invites the first button when there is none', async () => {
    const user = userEvent.setup()
    seed({ quickAdds: [] })
    render(<QuickAddsScreen />)
    expect(screen.getByText('No quick add buttons')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reorder' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add a button' }))
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'quickAdd' })
  })
})

describe('QuickAddSheet (SPEC §3.7)', () => {
  it('adds a button that takes its category’s icon', async () => {
    const user = userEvent.setup()
    renderSheet()
    const add = screen.getByTestId('sheet-save')
    expect(add).toHaveTextContent('Add')
    expect(add).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Döner')
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '6,50')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'Eating')
    expect(screen.getByText(/^On Daily, one tap adds/)).toHaveTextContent(/^On Daily, one tap adds 6,50\s€ to Eating, dated today\.$/)
    await user.click(add)
    const doner = getData().quickAdds.find((q) => q.label === 'Döner')
    expect(doner).toMatchObject({ amount: 650, categoryId: DEFAULT_CATEGORY_IDS.eating, icon: 'fork-knife' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('limits the name to 16 characters and needs an amount above 0', async () => {
    const user = userEvent.setup()
    renderSheet('qa-coffee')
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('maxlength', '16')
    const amount = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '0')
    expect(screen.getByText('Enter an amount above 0.')).toBeInTheDocument()
    expect(screen.getByTestId('sheet-save')).toBeDisabled()
  })

  it('edits the icon on its own page', async () => {
    const user = userEvent.setup()
    renderSheet('qa-coffee')
    await user.click(screen.getByRole('button', { name: /^Icon/ }))
    await user.click(screen.getByRole('radio', { name: 'Pizza' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await user.click(screen.getByTestId('sheet-save'))
    expect(getData().quickAdds.find((q) => q.id === 'qa-coffee')?.icon).toBe('pizza')
  })

  it('deletes with Undo', async () => {
    const user = userEvent.setup()
    renderSheet('qa-bakery')
    await user.click(screen.getByRole('button', { name: 'Delete quick add' }))
    await waitFor(() => expect(getData().quickAdds.some((q) => q.id === 'qa-bakery')).toBe(false))
    expect(currentToast()?.message).toBe('Deleted Bakery')
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => currentToast()?.action?.onClick())
    expect(getData().quickAdds.some((q) => q.id === 'qa-bakery')).toBe(true)
  })

  it('keeps an archived category selectable while the button uses it', () => {
    const data = makeData()
    seed({ categories: data.categories.map((c) => (c.id === DEFAULT_CATEGORY_IDS.coffee ? { ...c, archived: true } : c)) })
    renderSheet('qa-coffee')
    const select = screen.getByRole('combobox', { name: 'Category' })
    expect(within(select).getAllByRole('option')[0]).toHaveTextContent('Coffee & snacks')
  })
})
