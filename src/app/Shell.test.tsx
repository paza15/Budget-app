import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetDraftsForTests } from '@/app/drafts'
import { __resetNavForTests, installNavigation, useNav, type SheetProps } from '@/app/nav'
import { SHEETS, sheetLabel } from '@/app/registry'
import { Shell } from '@/app/Shell'
import { LS_KEYS } from '@/domain/constants'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, makeQuickAdd, NOW } from '@/domain/test-helpers/dataFixtures'
import { getData, useAppStore } from '@/store/appStore'
import { ConfirmHost, SheetHeader, ToastHost } from '@/ui'
import { answerDialog, currentDialog, removeDialog } from '@/ui/dialogs'
import { currentToast, dismissToast } from '@/ui/toast'

vi.mock('@/features/home/HomeScreen', () => ({ HomeScreen: () => <Notes screen="Home" /> }))
vi.mock('@/features/daily/DailyScreen', () => ({ DailyScreen: () => <Notes screen="Daily" /> }))
vi.mock('@/features/home/CategoryDetailScreen', () => ({
  CategoryDetailScreen: ({ categoryId }: { categoryId: string }) => <p>Category {categoryId}</p>,
}))
vi.mock('@/features/daily/TransactionSheet', () => ({ TransactionSheet: FakeTransactionSheet }))
vi.mock('@/features/review/MonthReviewSheet', () => ({
  MonthReviewSheet: ({ onClose }: SheetProps<'monthReview'>) => <SheetHeader title="Statement" onCancel={onClose} />,
}))

/** A screen with state of its own: a note field. */
function Notes({ screen: name }: { screen: string }) {
  const [text, setText] = useState('')
  return (
    <label>
      {`${name} note`}
      <input value={text} onChange={(event) => setText(event.target.value)} />
    </label>
  )
}

function FakeTransactionSheet({ route, onClose, setDirty }: SheetProps<'transaction'>) {
  return (
    <>
      <SheetHeader title={route.id === undefined ? 'New expense' : 'Edit expense'} onCancel={onClose} />
      <button type="button" onClick={() => setDirty(true)}>
        Type an amount
      </button>
    </>
  )
}

function renderShell() {
  return render(
    <>
      <div id="app-root">
        <Shell />
      </div>
      <ToastHost />
      <ConfirmHost />
    </>,
  )
}

function visibleScreen(): HTMLElement {
  const screens = document.querySelectorAll<HTMLElement>('[data-testid^="screen-"][data-active="true"]')
  expect(screens).toHaveLength(1)
  return screens[0] as HTMLElement
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  __resetDraftsForTests()
  __resetNavForTests()
  installNavigation()
  const data = makeData()
  useAppStore.setState({
    data: { ...data, settings: { ...data.settings, onboarded: true }, quickAdds: [makeQuickAdd()] },
    status: 'ready',
  })
})

afterEach(async () => {
  cleanup()
  // A dialog left open by a failed test would answer the next test's keys.
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
  // Let dialogs and sheets that were closing finish before the next test.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
})


/** Taps (+) and returns the route of the sheet it opened. */
async function addExpense(): Promise<unknown> {
  await userEvent.click(screen.getByTestId('tab-add'))
  await screen.findByRole('dialog', { name: 'New expense' })
  return useNav.getState().sheets.at(-1)?.route
}

describe('tabs and screens (docs/SPEC.md §5.5)', () => {
  it('keeps every tab mounted, so switching tabs keeps what was typed', async () => {
    const user = userEvent.setup()
    renderShell()
    expect(visibleScreen()).toHaveAttribute('data-testid', 'screen-home')

    await user.click(screen.getByTestId('tab-daily'))
    expect(visibleScreen()).toHaveAttribute('data-testid', 'screen-daily')
    await user.type(screen.getByRole('textbox', { name: 'Daily note' }), 'Coffee')

    await user.click(screen.getByTestId('tab-home'))
    expect(visibleScreen()).toHaveAttribute('data-testid', 'screen-home')
    // Daily is hidden inside <Activity>, still mounted.
    expect(screen.getByTestId('screen-daily')).not.toBeVisible()
    expect(screen.getByTestId('screen-daily').querySelector('input')).toHaveValue('Coffee')

    await user.click(screen.getByTestId('tab-daily'))
    expect(screen.getByRole('textbox', { name: 'Daily note' })).toHaveValue('Coffee')
  })

  it('pushes screens above the root and keeps the root as it was', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.type(screen.getByRole('textbox', { name: 'Home note' }), 'Rent')

    act(() => useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' }))
    const detail = visibleScreen()
    expect(detail).toHaveAttribute('data-testid', 'screen-category')
    expect(detail).toHaveTextContent('Category cat-coffee')
    // The covered root stays mounted but is out of reach.
    const root = screen.getByTestId('screen-home')
    expect(root).not.toHaveAttribute('data-active')
    expect(root).toHaveAttribute('inert')

    act(() => useNav.getState().pop())
    await waitFor(() => expect(visibleScreen()).toHaveAttribute('data-testid', 'screen-home'))
    expect(screen.queryByTestId('screen-category')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Home note' })).toHaveValue('Rent')
  })

  it('pops the active tab to its root when it is tapped again', async () => {
    const user = userEvent.setup()
    renderShell()
    act(() => useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' }))
    expect(visibleScreen()).toHaveAttribute('data-testid', 'screen-category')
    await user.click(screen.getByTestId('tab-home'))
    await waitFor(() => expect(visibleScreen()).toHaveAttribute('data-testid', 'screen-home'))
  })
})

describe('TabBar (DESIGN.md §9.1)', () => {
  it('has Home, Daily, the add button, Fixed and Wallet, and marks the active tab', async () => {
    const user = userEvent.setup()
    renderShell()
    const tabs = within(screen.getByRole('navigation', { name: 'Tabs' })).getAllByRole('button')
    expect(tabs.map((tab) => tab.dataset.testid)).toEqual(['tab-home', 'tab-daily', 'tab-add', 'tab-fixed', 'tab-wallet'])
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Home', 'Daily', '', 'Fixed', 'Wallet'])
    expect(screen.getByRole('button', { name: 'Add expense' })).toBe(tabs[2])
    expect(screen.queryByTestId('tab-you')).toBeNull()
    expect(screen.getByTestId('tab-home')).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByTestId('tab-wallet'))
    expect(screen.getByTestId('tab-wallet')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('tab-home')).not.toHaveAttribute('aria-current')
    expect(visibleScreen()).toHaveAttribute('data-testid', 'screen-wallet')
  })

  it('opens a new expense from the add button', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByTestId('tab-add'))
    const sheet = await screen.findByRole('dialog', { name: 'New expense' })
    expect(sheet).toHaveAttribute('data-testid', 'sheet')
    expect(sheet).toHaveAttribute('data-sheet', 'transaction')
  })

  describe('starts the new expense in the category on screen (docs/SPEC.md §3.4)', () => {
    it('in the category whose detail is on top', async () => {
      renderShell()
      act(() => useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' }))
      expect(await addExpense()).toEqual({ name: 'transaction', categoryId: 'cat-coffee' })
    })

    it("in Daily's chip on Daily's root", async () => {
      renderShell()
      act(() => {
        useNav.getState().setTab('daily')
        useNav.getState().setDailyCategory('cat-groceries')
      })
      expect(await addExpense()).toEqual({ name: 'transaction', categoryId: 'cat-groceries' })
    })

    it("in no category on Home's root, or on Uncategorized's detail", async () => {
      renderShell()
      act(() => useNav.getState().setDailyCategory('cat-groceries'))
      expect(await addExpense()).toEqual({ name: 'transaction' })
      act(() => useNav.getState().closeSheet())
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New expense' })).toBeNull())

      act(() => useNav.getState().push({ name: 'category', categoryId: '__none__' }))
      expect(await addExpense()).toEqual({ name: 'transaction' })
    })
  })

  it('offers the quick adds on a long press and adds the chosen one with Undo', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(NOW)
    renderShell()
    const add = screen.getByTestId('tab-add')
    fireEvent.pointerDown(add, { button: 0 })
    act(() => vi.advanceTimersByTime(500))
    fireEvent.pointerUp(add)
    // The click that ends a long press does not open the sheet as well.
    fireEvent.click(add, { detail: 1 })
    // Real timers again for the dialogs and toasts, with the date still on 14 Oct.
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)

    const menu = await screen.findByRole('dialog', { name: 'Quick add' })
    expect(screen.queryByRole('dialog', { name: 'New expense' })).toBeNull()
    // Glyph, label and amount (DESIGN.md §9.1). Intl puts a no-break space before the euro sign.
    const option = within(menu).getByRole('button', { name: /^Coffee, 3,50\s€$/ })
    expect(option.querySelector('svg[data-icon="coffee"]')).toHaveAttribute('aria-hidden', 'true')
    await userEvent.click(option)

    await waitFor(() => expect(getData().transactions).toHaveLength(1))
    expect(getData().transactions[0]).toMatchObject({
      kind: 'expense',
      amount: 350,
      categoryId: DEFAULT_CATEGORY_IDS.coffee,
      date: '2026-10-14',
    })
    const toast = await screen.findByTestId('toast')
    expect(toast).toHaveTextContent('Added 3,50 € to Coffee & snacks')
    await userEvent.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(getData().transactions).toEqual([])
  })
})

describe('SheetHost (docs/SPEC.md §5.5)', () => {
  it('renders each sheet with its registry label and keeps a closed one until its exit ends', async () => {
    renderShell()
    act(() => {
      useNav.getState().openSheet({ name: 'monthPicker' })
    })
    const sheet = screen.getByRole('dialog', { name: 'Choose a month' })
    expect(sheet).toHaveAttribute('data-sheet', 'monthPicker')

    act(() => useNav.getState().closeSheet())
    await waitFor(() => expect(useNav.getState().sheets).toEqual([]))
    // Closed, but still on screen while its exit plays.
    expect(sheet.parentElement).toHaveAttribute('data-state', 'closing')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Choose a month' })).toBeNull())
  })

  it('prints the month review on statement paper, named after its period (EXTRAS.md §1.1, §1.8)', () => {
    renderShell()
    act(() => {
      useNav.getState().openSheet({ name: 'transaction' })
      useNav.getState().openSheet({ name: 'monthReview', month: '2026-09' })
    })
    expect(screen.getByRole('dialog', { name: 'September statement' })).toHaveAttribute('data-material', 'paper')
    expect(screen.getByRole('dialog', { name: 'New expense', hidden: true })).toHaveAttribute('data-material', 'sheet')
  })

  it('names every review by its period and prints only the review on paper', () => {
    expect(sheetLabel({ name: 'monthReview', month: '2026-10' })).toBe('October statement')
    expect(sheetLabel({ name: 'monthReview', month: '2025-12' })).toBe('December statement')
    const paper = Object.entries(SHEETS).filter(([, definition]) => definition.material === 'paper')
    expect(paper.map(([name]) => name)).toEqual(['monthReview'])
  })

  it('stacks sheets and names them from the route', () => {
    renderShell()
    act(() => {
      useNav.getState().openSheet({ name: 'transaction', id: 'tx-1', kind: 'expense' })
      useNav.getState().openSheet({ name: 'monthPicker' })
    })
    const sheets = screen.getAllByTestId('sheet')
    expect(sheets.map((sheet) => sheet.dataset.sheet)).toEqual(['transaction', 'monthPicker'])
    expect(sheets[0]).toHaveAccessibleName('Edit expense')
  })

  it('asks before Escape drops unsaved changes the sheet reported with setDirty', async () => {
    const user = userEvent.setup()
    renderShell()
    act(() => {
      useNav.getState().openSheet({ name: 'transaction' })
    })
    await user.click(screen.getByRole('button', { name: 'Type an amount' }))
    expect(Object.keys(useNav.getState().dirty)).toHaveLength(1)

    await user.keyboard('{Escape}')
    const question = await screen.findByRole('alertdialog', { name: 'Discard this expense?' })
    await user.click(within(question).getByRole('button', { name: 'Keep editing' }))
    expect(useNav.getState().sheets).toHaveLength(1)
  })

  it('closes from the feature sheet through history', async () => {
    const user = userEvent.setup()
    renderShell()
    act(() => {
      useNav.getState().openSheet({ name: 'transaction' })
    })
    expect(window.history.state).toEqual({ onabudget: 1 })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(useNav.getState().sheets).toEqual([]))
    expect(window.history.state).toEqual({ onabudget: 0 })
  })
})

describe('drafts (docs/SPEC.md §5.10)', () => {
  it('reopens a new expense typed less than 15 minutes ago', async () => {
    localStorage.setItem(
      LS_KEYS.draft,
      JSON.stringify({ route: { name: 'transaction', categoryId: 'cat-coffee' }, fields: { amount: '3,5' }, savedAt: NOW - 14 * 60_000 }),
    )
    renderShell()
    expect(await screen.findByRole('dialog', { name: 'New expense' })).toBeInTheDocument()
    expect(useNav.getState().sheets.map((s) => s.route)).toEqual([{ name: 'transaction', categoryId: 'cat-coffee' }])
  })

  it('drops an older draft', () => {
    localStorage.setItem(LS_KEYS.draft, JSON.stringify({ route: { name: 'transaction' }, fields: {}, savedAt: NOW - 16 * 60_000 }))
    renderShell()
    expect(useNav.getState().sheets).toEqual([])
    expect(localStorage.getItem(LS_KEYS.draft)).toBeNull()
  })
})
