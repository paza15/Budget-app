import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newExpenseRoute, useNav } from '@/app/nav'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, makeRecurring, makeSplit, makeTransaction, TODAY } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { getData, useAppStore } from '@/store/appStore'
import { useUiStore } from '@/store/uiStore'
import { DailyScreen } from './DailyScreen'
import { AppFrame, plain, startAt, tearDown, words } from './testing'

const { coffee, eating, goingOut, groceries, shopping } = DEFAULT_CATEGORY_IDS

// Whole flows of taps and typing: room for a busy machine.
vi.setConfig({ testTimeout: 30_000 })

/**
 * Wed 14 Oct 2026, day 14 of October: 1.000,00 € in. October's daily spending is 39,50 € (shares;
 * the laptop came from the wallet), September's 11,50 €.
 */
function sampleData(): AppData {
  const base = makeData()
  return {
    ...base,
    settings: { ...base.settings, onboarded: true },
    recurring: [makeRecurring({ id: 'rec-job', kind: 'income', name: 'Job', amounts: [{ from: '2026-08', amount: 100000 }] })],
    transactions: [
      makeTransaction({ id: 'tx-kino', note: 'Kino', amount: 1150, categoryId: goingOut, date: '2026-09-20', createdAt: 1 }),
      makeTransaction({ id: 'tx-rewe', note: 'Rewe', amount: 2000, categoryId: groceries, date: '2026-10-02', createdAt: 2 }),
      makeTransaction({
        id: 'tx-pizza',
        note: 'Pizza',
        amount: 3200,
        categoryId: eating,
        date: '2026-10-10',
        createdAt: 3,
        splits: [makeSplit({ person: 'Max', amount: 1600 })],
      }),
      makeTransaction({ id: 'tx-laptop', note: 'Laptop', amount: 54900, categoryId: shopping, date: '2026-10-13', fromWallet: true, createdAt: 4 }),
      makeTransaction({ id: 'tx-cappu', note: 'Cappuccino', amount: 350, categoryId: coffee, date: TODAY, createdAt: 5 }),
    ],
  }
}

function renderDaily() {
  return render(
    <AppFrame>
      <DailyScreen />
    </AppFrame>,
  )
}

function dayHeadings(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map((heading) => plain(heading.textContent))
}

function rows(): string[] {
  return screen.queryAllByTestId('tx-row').map((row) => row.getAttribute('data-id') ?? '')
}

/** The day's section, from its heading to its last row. */
function section(name: string): HTMLElement {
  return screen.getByRole('heading', { name }).closest('section') as HTMLElement
}

beforeEach(() => startAt(sampleData()))
afterEach(tearDown)

describe('DailyScreen (docs/SPEC.md §3.3)', () => {
  it('says what was spent and about how much a day', () => {
    renderDaily()
    expect(screen.getByText((_, element) => element?.tagName === 'P' && plain(element.textContent) === '39,50 € spent, about 2,82 € a day')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Spending per day in October 2026' })).toBeInTheDocument()
  })

  it('lists the expenses by day, newest first, with day totals of your shares', () => {
    renderDaily()
    expect(dayHeadings()).toEqual(['Quick add', 'Today', 'Yesterday', 'Sat 10 Oct', 'Fri 2 Oct'])
    expect(rows()).toEqual(['tx-cappu', 'tx-laptop', 'tx-pizza', 'tx-rewe'])
    expect(words(section('Today'))).toMatch(/^Today 3,50 €/u)
    // Everything that day came from the wallet.
    expect(words(section('Yesterday'))).toMatch(/^Yesterday From your wallet Laptop/u)
    expect(words(section('Sat 10 Oct'))).toMatch(/^Sat 10 Oct 16,00 € Pizza 16,00 € Split, Max owes 16,00 € of 32,00 €/u)
  })

  it('adds a quick add at once, with Undo', async () => {
    const user = userEvent.setup({ delay: null })
    renderDaily()
    const tile = screen.getByRole('button', { name: /^Add Coffee, 3,50\s€$/u })
    expect(tile).toHaveAttribute('data-testid', 'quick-add')
    await user.click(tile)
    expect(getData().transactions.at(-1)).toMatchObject({ amount: 350, categoryId: coffee, note: 'Coffee', date: TODAY })
    expect(rows()).toHaveLength(5)
    const toast = screen.getByTestId('toast')
    expect(words(toast)).toBe('Added 3,50 € to Coffee & snacks Undo')
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(rows()).toHaveLength(4)
  })

  it('leads "Edit" to the quick-add settings', async () => {
    const user = userEvent.setup({ delay: null })
    renderDaily()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(useNav.getState().tab).toBe('home')
    expect(useNav.getState().stacks.home.map((route) => route.name)).toEqual(['you', 'you.quickAdds'])
  })

  it('filters by category, with the category row and its limit', async () => {
    const user = userEvent.setup({ delay: null })
    const data = sampleData()
    useAppStore.setState({ data: { ...data, categories: data.categories.map((c) => (c.id === eating ? { ...c, budget: 10000 } : c)) } })
    renderDaily()
    const chips = screen.getByRole('tablist', { name: 'Categories' })
    expect(within(chips).getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'All',
      'Transport',
      'Eating',
      'Groceries',
      'Coffee & snacks',
      'Shopping',
      'Going out',
      'Health',
      'Other',
    ])
    await user.click(within(chips).getByRole('tab', { name: 'Eating' }))
    expect(rows()).toEqual(['tx-pizza'])
    const categoryRow = screen.getByRole('button', { name: /^Eating/u })
    expect(words(categoryRow)).toBe('Eating 16,00 € this month')
    expect(screen.getByRole('meter', { name: /Eating limit/u })).toBeInTheDocument()
    await user.click(categoryRow)
    expect(useNav.getState().stacks.home).toEqual([{ name: 'category', categoryId: eating }])
  })

  it('keeps the chosen chip in nav, so (+) starts a new expense in it', async () => {
    const user = userEvent.setup({ delay: null })
    act(() => useNav.getState().setTab('daily'))
    renderDaily()
    const chips = screen.getByRole('tablist', { name: 'Categories' })
    await user.click(within(chips).getByRole('tab', { name: 'Groceries' }))
    expect(useNav.getState().dailyCategory).toBe(groceries)
    expect(rows()).toEqual(['tx-rewe'])
    expect(newExpenseRoute()).toEqual({ name: 'transaction', categoryId: groceries })
    await user.click(within(chips).getByRole('tab', { name: 'All' }))
    expect(useNav.getState().dailyCategory).toBeNull()
    expect(newExpenseRoute()).toEqual({ name: 'transaction' })
  })

  it('shows the chip nav holds, and All in a period that does not offer it', () => {
    const data = sampleData()
    // A fixed category gets a chip only in a period with an expense in it.
    const rent = makeTransaction({ id: 'tx-rent', note: 'Deposit', amount: 5000, categoryId: DEFAULT_CATEGORY_IDS.rent, date: '2026-10-05' })
    useAppStore.setState({ data: { ...data, transactions: [...data.transactions, rent] } })
    act(() => useNav.getState().setDailyCategory(DEFAULT_CATEGORY_IDS.rent))
    renderDaily()
    expect(screen.getByRole('tab', { name: 'Rent' })).toHaveAttribute('aria-selected', 'true')
    expect(rows()).toEqual(['tx-rent'])
    act(() => useNav.getState().setMonth('2026-09'))
    expect(screen.queryByRole('tab', { name: 'Rent' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    expect(rows()).toEqual(['tx-kino'])
    // Back in October the chip is chosen again.
    act(() => useNav.getState().setMonth(null))
    expect(screen.getByRole('tab', { name: 'Rent' })).toHaveAttribute('aria-selected', 'true')
  })

  it('offers "Back to this month" instead of quick adds in another month', async () => {
    const user = userEvent.setup({ delay: null })
    act(() => useNav.getState().setMonth('2026-09'))
    renderDaily()
    expect(screen.queryAllByTestId('quick-add')).toHaveLength(0)
    expect(rows()).toEqual(['tx-kino'])
    expect(screen.getByText((_, element) => element?.tagName === 'P' && plain(element.textContent) === '11,50 € spent, about 0,38 € a day')).toBeInTheDocument()
    const back = screen.getAllByRole('button', { name: 'Back to this month' })
    await user.click(back.at(-1) as HTMLElement)
    expect(useNav.getState().month).toBeNull()
  })

  it('says what is planned in a future month', () => {
    act(() => useNav.getState().setMonth('2026-11'))
    renderDaily()
    expect(screen.getByText((_, element) => element?.tagName === 'P' && plain(element.textContent) === '0,00 € planned')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nothing planned for November 2026' })).toBeInTheDocument()
  })

  it('invites the first expense when the month is empty', () => {
    useAppStore.setState({ data: { ...sampleData(), transactions: [] } })
    renderDaily()
    expect(screen.getByRole('heading', { name: 'Nothing spent this month yet' })).toBeInTheDocument()
    expect(screen.getByText('Tap + to add an expense.')).toBeInTheDocument()
  })

  it('searches notes and category names in every month', async () => {
    const user = userEvent.setup({ delay: null })
    renderDaily()
    const search = screen.getByTestId('daily-search')
    expect(search).toHaveAccessibleName('Search')
    await user.click(search)
    const field = screen.getByRole('searchbox', { name: 'Search' })
    expect(field).toHaveFocus()
    expect(screen.queryAllByTestId('quick-add')).toHaveLength(0)

    await user.type(field, 'going')
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
    expect(rows()).toEqual(['tx-kino'])
    expect(screen.getByText('1 result')).toBeInTheDocument()

    await user.clear(field)
    await user.type(field, 'zzz')
    expect(screen.getByRole('heading', { name: 'No results for “zzz”' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(rows()).toHaveLength(4)
  })

  it('shows hidden amounts with the eye button', async () => {
    const user = userEvent.setup({ delay: null })
    const data = sampleData()
    useAppStore.setState({ data: { ...data, settings: { ...data.settings, hideAmounts: true } } })
    renderDaily()
    expect(screen.getByText((_, element) => element?.tagName === 'P' && plain(element.textContent) === '••• spent, about ••• a day')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show amounts' }))
    expect(useUiStore.getState().amountsRevealed).toBe(true)
    expect(screen.getByRole('button', { name: 'Hide amounts' })).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.tagName === 'P' && plain(element.textContent) === '39,50 € spent, about 2,82 € a day')).toBeInTheDocument()
  })
})
