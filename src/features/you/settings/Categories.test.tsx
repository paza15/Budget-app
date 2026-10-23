import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav } from '@/app/nav'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { nextFreeCategoryColor } from '@/domain/queries'
import { makeData, makeQuickAdd, makeRecurring, makeTransaction, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData, Category } from '@/domain/types'
import { CategoriesScreen } from '@/features/you/CategoriesScreen'
import { CategorySheet } from '@/features/you/CategorySheet'
import { actions } from '@/store/actions'
import { getData, useAppStore } from '@/store/appStore'
import { ConfirmHost, ToastHost } from '@/ui'
import { currentToast, dismissToast } from '@/ui/toast'

// Rendering whole screens is slow while the machine is busy; a real failure still fails.
vi.setConfig({ testTimeout: 30_000 })

const COFFEE = DEFAULT_CATEGORY_IDS.coffee
const onClose = vi.fn<() => void>()
const setDirty = vi.fn<(dirty: boolean) => void>()

function seed(patch: Partial<AppData> = {}): void {
  useAppStore.setState({ data: makeData(patch), status: 'ready' })
}

function category(id: string): Category | undefined {
  return getData().categories.find((c) => c.id === id)
}

function renderSheet(id?: string) {
  return render(
    <>
      <CategorySheet route={id === undefined ? { name: 'categoryEdit' } : { name: 'categoryEdit', id }} onClose={onClose} setDirty={setDirty} />
      <ToastHost />
      <ConfirmHost />
    </>,
  )
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

describe('CategoriesScreen (SPEC §3.7)', () => {
  it('lists the active categories as buttons named by the category first', async () => {
    const user = userEvent.setup()
    seed({ categories: makeData().categories.map((c) => (c.id === COFFEE ? { ...c, budget: 4000 } : c)) })
    render(<CategoriesScreen />)
    const coffee = screen.getByRole('button', { name: /^Coffee & snacks/ })
    expect(coffee).toHaveTextContent(/Daily spending, limit 40,00\s€/)
    await user.click(coffee)
    expect(useNav.getState().sheets.map((entry) => entry.route)).toEqual([{ name: 'categoryEdit', id: COFFEE }])
    await user.click(screen.getByRole('button', { name: 'Add category' }))
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'categoryEdit' })
  })

  it('keeps archived categories in a group of their own', () => {
    actions.setCategoryArchived(DEFAULT_CATEGORY_IDS.health, true)
    render(<CategoriesScreen />)
    const archived = screen.getByRole('heading', { name: 'Archived' }).closest('section') as HTMLElement
    expect(within(archived).getByRole('button', { name: /^Health/ })).toBeInTheDocument()
    expect(within(archived).queryByRole('button', { name: /^Rent/ })).toBeNull()
  })

  it('reorders with up and down buttons after Reorder', async () => {
    const user = userEvent.setup()
    render(<CategoriesScreen />)
    expect(screen.queryByRole('button', { name: 'Move Rent up' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Reorder' }))
    expect(screen.getByRole('button', { name: 'Move Rent up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Other down' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Add category' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Move Coffee & snacks up' }))
    const ids = getData()
      .categories.toSorted((a, b) => a.order - b.order)
      .map(({ id }) => id)
    expect(ids.indexOf(COFFEE)).toBe(ids.indexOf(DEFAULT_CATEGORY_IDS.groceries) - 1)
    expect(screen.getByRole('status')).toHaveTextContent('Coffee & snacks is now 7 of 12')

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: 'Add category' })).toBeInTheDocument()
  })
})

describe('CategorySheet (SPEC §3.7)', () => {
  it('sets a monthly limit and saves', async () => {
    const user = userEvent.setup()
    renderSheet(COFFEE)
    expect(screen.getByRole('heading', { name: 'Coffee & snacks' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Monthly limit' }), '35')
    expect(setDirty).toHaveBeenLastCalledWith(true)
    await user.click(screen.getByTestId('sheet-save'))
    expect(category(COFFEE)?.budget).toBe(3500)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('adds a category with the first free colour', async () => {
    const user = userEvent.setup()
    renderSheet()
    expect(screen.getByRole('heading', { name: 'New category' })).toBeInTheDocument()
    const save = screen.getByTestId('sheet-save')
    expect(save).toBeDisabled()
    // The defaults use every colour, blue and slate twice: orange is the first of the least used.
    expect(nextFreeCategoryColor(getData().categories)).toBe('orange')
    const colour = screen.getByRole('radiogroup', { name: 'Colour' })
    expect(within(colour).getByRole('radio', { name: 'Orange' })).toBeChecked()

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Pets')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Show in' }), 'Both')
    await user.click(save)
    const pets = getData().categories.find((c) => c.name === 'Pets')
    expect(pets).toMatchObject({ kind: 'both', color: 'orange', budget: null, archived: false, icon: 'circle' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('puts the keyboard away on its done key', async () => {
    const user = userEvent.setup()
    renderSheet(COFFEE)
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.click(name)
    expect(name).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(name).not.toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('asks for a name before saving', async () => {
    const user = userEvent.setup()
    renderSheet(COFFEE)
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.tab()
    expect(screen.getByText('Give the category a name.')).toBeInTheDocument()
    expect(screen.getByTestId('sheet-save')).toBeDisabled()
  })

  it('picks an icon on its own page and comes back', async () => {
    const user = userEvent.setup()
    renderSheet(COFFEE)
    await user.click(screen.getByRole('button', { name: /^Icon/ }))
    expect(screen.getByRole('heading', { name: 'Icon' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Pizza' }))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.getByRole('button', { name: /^Icon/ })).toHaveFocus()
    await user.click(screen.getByTestId('sheet-save'))
    expect(category(COFFEE)?.icon).toBe('pizza')
  })

  it('deletes an unused category after a destructive confirmation, with Undo', async () => {
    const user = userEvent.setup()
    renderSheet(DEFAULT_CATEGORY_IDS.health)
    await user.click(screen.getByRole('button', { name: 'Delete category' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Delete Health?')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(category(DEFAULT_CATEGORY_IDS.health)).toBeUndefined())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(currentToast()?.message).toBe('Deleted Health')
    act(() => currentToast()?.action?.onClick())
    expect(category(DEFAULT_CATEGORY_IDS.health)).toBeDefined()
  })

  it('moves what a used category holds before deleting it', async () => {
    const user = userEvent.setup()
    seed({
      transactions: [makeTransaction({ id: 'tx-1' }), makeTransaction({ id: 'tx-2' })],
      recurring: [makeRecurring({ categoryId: COFFEE })],
      quickAdds: [makeQuickAdd({ categoryId: COFFEE })],
    })
    renderSheet(COFFEE)
    await user.click(screen.getByRole('button', { name: 'Delete category' }))
    expect(screen.getByText('Move 2 expenses, 1 fixed cost and 1 quick add to…')).toBeInTheDocument()
    const destroy = screen.getByRole('button', { name: 'Delete Coffee & snacks' })
    expect(destroy).toBeDisabled()
    const list = screen.getByRole('radiogroup', { name: 'Move them to' })
    expect(within(list).queryByRole('radio', { name: 'Coffee & snacks' })).toBeNull()
    await user.click(within(list).getByRole('radio', { name: 'Eating' }))
    await user.click(destroy)

    await waitFor(() => expect(category(COFFEE)).toBeUndefined())
    const data = getData()
    expect(data.transactions.every((tx) => tx.categoryId === DEFAULT_CATEGORY_IDS.eating)).toBe(true)
    expect(data.recurring[0]?.categoryId).toBe(DEFAULT_CATEGORY_IDS.eating)
    expect(data.quickAdds.every((q) => q.categoryId === DEFAULT_CATEGORY_IDS.eating)).toBe(true)
    expect(currentToast()?.message).toBe('Deleted Coffee & snacks')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('goes back from the move list with Cancel', async () => {
    const user = userEvent.setup()
    seed({ transactions: [makeTransaction()] })
    renderSheet(COFFEE)
    await user.click(screen.getByRole('button', { name: 'Delete category' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('textbox', { name: 'Monthly limit' })).toBeInTheDocument()
    expect(category(COFFEE)).toBeDefined()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('archives and restores, with Undo', async () => {
    const user = userEvent.setup()
    const { unmount } = renderSheet(COFFEE)
    await user.click(screen.getByRole('button', { name: 'Archive category' }))
    await waitFor(() => expect(category(COFFEE)?.archived).toBe(true))
    expect(currentToast()?.message).toBe('Archived Coffee & snacks')
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()

    renderSheet(COFFEE)
    await user.click(screen.getByRole('button', { name: 'Restore category' }))
    await waitFor(() => expect(category(COFFEE)?.archived).toBe(false))
    expect(currentToast()?.message).toBe('Restored Coffee & snacks')
  })

  it('opens the category’s spending', async () => {
    const user = userEvent.setup()
    renderSheet(COFFEE)
    await user.click(screen.getByRole('button', { name: /^See spending/ }))
    expect(onClose).toHaveBeenCalled()
    expect(useNav.getState().stacks.home.at(-1)).toEqual({ name: 'category', categoryId: COFFEE })
  })

  it('says so when the category is gone', () => {
    renderSheet('cat-missing')
    expect(screen.getByText('This category no longer exists')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})
