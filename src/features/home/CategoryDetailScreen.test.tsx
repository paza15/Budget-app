import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav, type Route, type TabId } from '@/app/nav'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import { makeData, makeRecurring, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import type { AppData, MonthKey, Transaction } from '@/domain/types'
import { backLabelFor } from '@/features/home/backLabel'
import { CategoryDetailScreen } from '@/features/home/CategoryDetailScreen'
import { useAppStore } from '@/store/appStore'
import { useMoneyFormat } from '@/store/hooks'
import { MoneyFormatContext } from '@/ui'

/** Sunday 18 October 2026, 10:00 in Berlin: day 18 of 31. */
const NOW = Date.UTC(2026, 9, 18, 8)
const { coffee, rent, groceries, other } = DEFAULT_CATEGORY_IDS

function expense(id: string, date: string, amount: number, categoryId: string, note = ''): Transaction {
  return makeTransaction({ id, date: date as Transaction['date'], amount, categoryId, note, createdAt: NOW, updatedAt: NOW })
}

function sample(): AppData {
  const base = makeData()
  return {
    ...base,
    settings: { ...base.settings, name: 'Alex', onboarded: true },
    categories: base.categories.map((category) => (category.id === coffee ? { ...category, budget: 4000 } : category)),
    recurring: [
      makeRecurring({ id: 'rec-job', kind: 'income', name: 'Job', categoryId: null, amounts: [{ from: '2026-08', amount: 145000 }] }),
      makeRecurring({ id: 'rec-rent', name: 'Rent', amounts: [{ from: '2026-08', amount: 64000 }], dueDay: 1 }),
    ],
    months: { '2026-10': { overrides: { 'rec-rent': { paid: true } } } },
    transactions: [
      expense('tx-sep', '2026-09-20', 900, coffee, 'Espresso'),
      expense('tx-cappuccino', '2026-10-18', 350, coffee, 'Cappuccino'),
      expense('tx-brezel', '2026-10-17', 120, coffee, 'Brezel'),
      expense('tx-flat-white', '2026-10-14', 3380, coffee, 'Flat white'),
      expense('tx-edeka', '2026-10-05', 2380, groceries, 'Edeka'),
      // A category deleted long ago: its expenses count as Uncategorized.
      expense('tx-orphan', '2026-10-03', 500, 'cat-gone', 'Kiosk'),
      expense('tx-none', '2026-10-04', 250, UNCATEGORIZED_ID),
    ],
  }
}

function Harness({ children }: { children: ReactNode }) {
  const money = useMoneyFormat()
  return <MoneyFormatContext value={money}>{children}</MoneyFormatContext>
}

/** Pushes the category on `tab` above `below`, as the app does, and renders it. */
function renderDetail(categoryId: string, { tab = 'home', below = [] }: { tab?: TabId; below?: Route[] } = {}) {
  act(() => {
    useNav.getState().setTab(tab)
    for (const route of below) useNav.getState().push(route)
    useNav.getState().push({ name: 'category', categoryId })
  })
  return render(<CategoryDetailScreen categoryId={categoryId} />, { wrapper: Harness })
}

function text(element: Element | null): string {
  return (element?.textContent ?? '').replace(/[  ]/g, ' ')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  __resetNavForTests()
  useAppStore.setState({ data: sample(), status: 'ready' })
})

afterEach(() => {
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('category detail (SPEC §3.2)', () => {
  it('shows the period total, the limit and the expenses', () => {
    renderDetail(coffee)
    expect(screen.getByRole('heading', { level: 1, name: 'Coffee & snacks' })).toBeInTheDocument()
    expect(text(screen.getByTestId('category-total'))).toContain('38,50 €')
    expect(screen.getByText('spent this month')).toBeInTheDocument()
    expect(screen.getByRole('meter', { name: 'Coffee & snacks limit' })).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/^38,50.€ of 40,00.€, near the limit, 1,50.€ left$/),
    )
    expect(screen.getByText('Near the limit,', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Day 18 of 31')).toBeInTheDocument()
    expect(screen.getByText('3 entries')).toBeInTheDocument()
    expect(screen.getAllByTestId('tx-row').map((row) => row.getAttribute('data-id'))).toEqual([
      'tx-cappuccino',
      'tx-brezel',
      'tx-flat-white',
    ])
    expect(screen.getByRole('img', { name: 'Coffee & snacks, spending per day in October' })).toBeInTheDocument()
  })

  it('gives each expense its day as line 2, without naming the category again', () => {
    renderDetail(coffee)
    const rows = screen.getAllByTestId('tx-row')
    expect(rows.map(text)).toEqual(['Cappuccino3,50 €Today', 'Brezel1,20 €Yesterday', 'Flat white33,80 €Wed 14 Oct'])
    const names = rows.map((row) => within(row).getByRole('button').getAttribute('aria-label')?.replace(/\s/g, ' '))
    expect(names).toEqual(['Cappuccino, 3,50 €, Today', 'Brezel, 1,20 €, Yesterday', 'Flat white, 33,80 €, Wed 14 Oct'])
    for (const row of rows) expect(text(row)).not.toContain('Coffee & snacks')
  })

  it('goes back to the screen it came from, by name', async () => {
    const user = userEvent.setup()
    renderDetail(coffee, { tab: 'daily' })
    await user.click(screen.getByRole('button', { name: 'Back to Daily' }))
    expect(useNav.getState().stacks.daily).toEqual([])
  })

  it('names the category below it, or settings pages', () => {
    const categories = useAppStore.getState().data.categories
    const map = Object.fromEntries(categories.map((category) => [category.id, category]))
    expect(backLabelFor({ tab: 'home', below: null }, map)).toBe('Home')
    expect(backLabelFor({ tab: 'fixed', below: { name: 'category', categoryId: rent } }, map)).toBe('Rent')
    expect(backLabelFor({ tab: 'home', below: { name: 'you.categories' } }, map)).toBe('Categories')
    expect(backLabelFor({ tab: 'home', below: { name: 'owed' } }, map)).toBe('Owed to you')
  })

  it('edits the category and adds an expense in it', async () => {
    const user = userEvent.setup()
    renderDetail(coffee, { below: [{ name: 'you' }, { name: 'you.categories' }] })
    expect(screen.getByRole('button', { name: 'Back to Categories' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'categoryEdit', id: coffee })
    await user.click(screen.getByRole('button', { name: 'Add expense' }))
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'transaction', categoryId: coffee })
  })

  it('lists the fixed costs of a fixed category, paid ones as paid', async () => {
    const user = userEvent.setup()
    renderDetail(rent)
    const fixed = screen.getByRole('heading', { name: 'Fixed costs' }).closest('section') as HTMLElement
    expect(text(fixed)).toContain('Due on the 1st, paid')
    expect(text(fixed)).toContain('640,00 €')
    expect(screen.getByText('Nothing spent this month.')).toBeInTheDocument()
    await user.click(within(fixed).getByRole('button', { name: /^Rent/ }))
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'recurring', id: 'rec-rent', kind: 'expense' })
  })

  it('gathers unknown categories under Uncategorized, without Edit or Add expense', () => {
    renderDetail(UNCATEGORIZED_ID)
    expect(screen.getByRole('heading', { level: 1, name: 'Uncategorized' })).toBeInTheDocument()
    expect(screen.getAllByTestId('tx-row').map((row) => row.getAttribute('data-id'))).toEqual(['tx-none', 'tx-orphan'])
    expect(text(screen.getByTestId('category-total'))).toContain('7,50 €')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add expense' })).not.toBeInTheDocument()
  })

  it('follows the selected month', () => {
    renderDetail(coffee)
    act(() => useNav.getState().setMonth('2026-09' as MonthKey))
    expect(screen.getByText('spent in September 2026')).toBeInTheDocument()
    expect(screen.getByText('1 entry')).toBeInTheDocument()
    expect(screen.getByText('30 days')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'September' })).toBeInTheDocument()
  })

  it('says when the category was deleted', () => {
    renderDetail('cat-gone')
    expect(screen.getByText('This category was deleted')).toBeInTheDocument()
  })

  it('shows the last months once two have spending', () => {
    renderDetail(coffee)
    expect(screen.getByRole('heading', { name: 'Last 6 months' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Coffee & snacks, fixed costs and daily spending, August to October' })).toBeInTheDocument()
  })

  it('leaves out other categories', () => {
    renderDetail(other)
    expect(screen.queryAllByTestId('tx-row')).toHaveLength(0)
    expect(text(screen.getByTestId('category-total'))).toContain('0,00 €')
  })
})
