import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav } from '@/app/nav'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, makeRecurring, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import type { AppData, Category, HomeCardKey, Recurring, Settings, Transaction } from '@/domain/types'
import { HomeScreen } from '@/features/home/HomeScreen'
import { getData, useAppStore } from '@/store/appStore'
import { useMoneyFormat } from '@/store/hooks'
import { useUiStore } from '@/store/uiStore'
import { ConfirmHost, MoneyFormatContext, ToastHost } from '@/ui'
import { answerDialog, currentDialog, removeDialog } from '@/ui/dialogs'
import { currentToast, dismissToast } from '@/ui/toast'

// The Wallet and Owed cards belong to their features; here they only have to sit in their place.
vi.mock('@/features/wallet/WalletCard', () => ({
  WalletCard: ({ month }: { month: string }) => (
    <section data-testid="wallet-card" data-month={month}>
      <h2>Wallet</h2>
    </section>
  ),
}))
vi.mock('@/features/owed/OwedCard', () => ({
  OwedCard: () => (
    <section data-testid="owed-card">
      <h2>Owed to you</h2>
    </section>
  ),
}))

/** Sunday 18 October 2026, 10:00 in Berlin: day 18 of 31, 14 days left including today. */
const NOW = Date.UTC(2026, 9, 18, 8)
const DAY = 86_400_000
const { coffee, eating, groceries, goingOut, shopping, transport, subscriptions, phone, health, other } = DEFAULT_CATEGORY_IDS

function spend(id: string, date: string, amount: number, categoryId: string, note = ''): Transaction {
  return makeTransaction({ id, date: date as Transaction['date'], amount, categoryId, note, createdAt: NOW - DAY, updatedAt: NOW - DAY })
}

/** Income 1.450,00, fixed costs 778,88, savings 100,00: 571,12 € for daily life (DESIGN.md's sample). */
const RECURRING: Recurring[] = [
  makeRecurring({ id: 'rec-job', kind: 'income', name: 'Job', categoryId: null, amounts: [{ from: '2026-08', amount: 145000 }] }),
  makeRecurring({ id: 'rec-rent', name: 'Rent', amounts: [{ from: '2026-08', amount: 64000 }], dueDay: 1 }),
  makeRecurring({ id: 'rec-netflix', name: 'Netflix', categoryId: subscriptions, amounts: [{ from: '2026-08', amount: 1399 }], dueDay: 22, order: 1 }),
  makeRecurring({ id: 'rec-phone', name: 'Phone', categoryId: phone, amounts: [{ from: '2026-08', amount: 1500 }], dueDay: 28, order: 2 }),
  makeRecurring({ id: 'rec-ticket', name: 'Deutschlandticket', categoryId: transport, amounts: [{ from: '2026-08', amount: 10989 }], dueDay: 1, order: 3 }),
]

/** October: 336,40 € daily (3,50 € of it today), so 234,72 € left. September: 512,30 €. */
const SPENDING: Transaction[] = [
  spend('tx-sep', '2026-09-10', 51230, groceries, 'Big shop'),
  spend('tx-edeka', '2026-10-05', 11860, groceries, 'Edeka'),
  spend('tx-mensa', '2026-10-06', 9630, eating, 'Mensa'),
  spend('tx-bar', '2026-10-10', 5200, goingOut, 'Bar'),
  spend('tx-flat-white', '2026-10-12', 3500, coffee, 'Flat white'),
  spend('tx-shoes', '2026-10-14', 2100, shopping, 'Shoes'),
  spend('tx-bus', '2026-10-15', 1000, transport),
  makeTransaction({ id: 'tx-cappuccino', date: '2026-10-18', amount: 350, categoryId: coffee, note: 'Cappuccino', createdAt: NOW, updatedAt: NOW }),
]

interface SampleInput {
  settings?: Partial<Settings>
  recurring?: Recurring[]
  transactions?: Transaction[]
  budgets?: Record<string, number>
}

function sample({ settings, recurring = RECURRING, transactions = SPENDING, budgets }: SampleInput = {}): AppData {
  const base = makeData()
  const limits = budgets ?? { [coffee]: 4000, [groceries]: 18000, [eating]: 15000 }
  const categories: Category[] = base.categories.map((category) =>
    Object.hasOwn(limits, category.id) ? { ...category, budget: limits[category.id] ?? null } : category,
  )
  return {
    ...base,
    settings: {
      ...base.settings,
      name: 'Alex',
      savingsGoal: 10000,
      onboarded: true,
      lastReviewedMonth: '2026-09',
      lastBackupAt: NOW - DAY,
      ...settings,
    },
    categories,
    recurring,
    transactions,
  }
}

/** The app's providers, as App sets them: the user's money format, the toasts and the dialogs. */
function Harness({ children }: { children: ReactNode }) {
  const money = useMoneyFormat()
  return (
    <MoneyFormatContext value={money}>
      {children}
      <ToastHost />
      <ConfirmHost />
    </MoneyFormatContext>
  )
}

function renderHome(data: AppData = sample()) {
  act(() => useAppStore.setState({ data, status: 'ready' }))
  return render(<HomeScreen />, { wrapper: Harness })
}

function selectMonth(month: string): void {
  act(() => useNav.getState().setMonth(month as AppData['settings']['lastReviewedMonth'] & string))
}

/** Headings of the Home cards in screen order (SPEC §9: card titles are headings). */
function headings(): string[] {
  return screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent ?? '')
}

/** Text with Intl's no-break spaces read as plain spaces. */
function text(element: Element | null): string {
  return (element?.textContent ?? '').replace(/[  ]/g, ' ')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  __resetNavForTests()
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
  useUiStore.setState({ amountsRevealed: false })
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
})

describe('the hero (SPEC §3.1, DESIGN.md §9.4)', () => {
  it('shows what is left this month, per day and for today', () => {
    renderHome()
    expect(screen.getByText('Left to spend', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('On track')).toBeInTheDocument()
    expect(text(screen.getByTestId('hero-left'))).toBe('234,72 €')
    // floor((23472 + 350) / 14) = 1701; today 1701 − 350.
    expect(text(screen.getByTestId('hero-per-day'))).toBe('About 17,01 € a day for the next 14 days')
    expect(text(screen.getByTestId('hero-today'))).toBe('Today: 13,51 € left')
    // VoiceOver reads it as one sentence.
    expect(screen.getByRole('img', { name: /^Left to spend, 234,72.€\. On track\. About 17,01.€ a day/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Spent 59 percent/ })).toBeInTheDocument()
  })

  it('is over budget: the overspend, what it does to the wallet and the full bar', () => {
    renderHome(sample({ transactions: [...SPENDING, spend('tx-laptop', '2026-10-16', 27600, shopping)] }))
    expect(screen.getByText('Over budget by', { exact: true })).toBeInTheDocument()
    expect(text(screen.getByTestId('hero-left'))).toBe('41,28 €')
    expect(screen.getByTestId('hero-left')).toHaveAttribute('data-tone', 'critical')
    expect(text(screen.getByText(/for daily life\.$/))).toBe('Spent 612,40 € of 571,12 € for daily life.')
    // The savings of 100,00 € cover the 41,28 € overspend (DESIGN.md §14 note 20).
    expect(text(screen.getByTestId('hero-wallet'))).toBe('Your savings cover it. October still adds 58,72 € to your wallet.')
    expect(screen.queryByTestId('hero-today')).not.toBeInTheDocument()
    expect(screen.getByTestId('equation-left')).toHaveAttribute('data-over', 'true')
  })

  it('asks for income first and offers both kinds', async () => {
    const user = userEvent.setup()
    renderHome(sample({ recurring: RECURRING.filter((item) => item.kind === 'expense'), settings: { savingsGoal: 0 } }))
    expect(screen.getByText('Spent this month', { exact: true })).toBeInTheDocument()
    // 778,88 € of fixed costs and 336,40 € of daily spending.
    expect(text(screen.getByTestId('hero-left'))).toBe('1.115,28 €')
    await user.click(screen.getByRole('button', { name: 'Add your income' }))
    await user.click(await screen.findByRole('button', { name: 'Every month' }))
    expect(useNav.getState().sheets.map((entry) => entry.route)).toEqual([{ name: 'recurring', kind: 'income' }])

    await user.click(screen.getByRole('button', { name: 'Add your income' }))
    await user.click(await screen.findByRole('button', { name: 'Just this month' }))
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'transaction', kind: 'income' })
  })

  it('sends fixed costs above the income to Fixed', async () => {
    const user = userEvent.setup()
    const income = makeRecurring({ id: 'rec-job', kind: 'income', name: 'Job', categoryId: null, amounts: [{ from: '2026-08', amount: 80000 }] })
    renderHome(sample({ recurring: [income, ...RECURRING.slice(1)] }))
    expect(screen.getByText("Fixed costs and savings are more than this month's income.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review fixed costs' }))
    expect(useNav.getState()).toMatchObject({ tab: 'fixed', fixedSegment: 'costs' })
  })

  it('reads a past month as a closed statement with its review', async () => {
    const user = userEvent.setup()
    renderHome(sample({ settings: { lastReviewedMonth: '2026-08' } }))
    selectMonth('2026-09')
    expect(screen.getByText('Left over', { exact: true })).toBeInTheDocument()
    expect(text(screen.getByTestId('hero-left'))).toBe('58,82 €')
    expect(screen.getByText('Closed 30 Sep')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Statement closed on 30 September\./ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Statement for September' })).toBeInTheDocument()
    expect(text(screen.getByTestId('statement-wallet'))).toBe('Moved to your wallet: 158,82 €')

    await user.click(screen.getByRole('button', { name: 'See the review' }))
    expect(useNav.getState().sheets.map((entry) => entry.route)).toEqual([{ name: 'monthReview', month: '2026-09' }])
    expect(getData().settings.lastReviewedMonth).toBe('2026-09')

    await user.click(screen.getByTestId('statement-wallet'))
    expect(useNav.getState().tab).toBe('wallet')
  })

  it('plans a future month', () => {
    renderHome()
    selectMonth('2026-11')
    expect(screen.getByText('Planned', { exact: true })).toBeInTheDocument()
    expect(text(screen.getByTestId('hero-left'))).toBe('571,12 €')
    expect(text(screen.getByTestId('hero-per-day'))).toBe('19,03 € a day across 30 days')
    expect(screen.getByRole('heading', { name: 'November' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'See the review' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Coming up' })).not.toBeInTheDocument()
  })
})

describe('the sums (DESIGN.md §9.6)', () => {
  it('writes the month as a sum whose rows open where the money is', async () => {
    const user = userEvent.setup()
    renderHome()
    const table = screen.getByRole('table', { name: 'This month' })
    expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Income',
      'Fixed costs',
      'Savings',
      'Daily spending',
      'Left',
    ])
    expect(text(screen.getByTestId('equation-income'))).toContain('1.450,00')
    expect(text(screen.getByTestId('equation-left'))).toContain('234,72')

    await user.click(within(table).getByRole('button', { name: 'Income' }))
    expect(useNav.getState()).toMatchObject({ tab: 'fixed', fixedSegment: 'income' })
    act(() => useNav.getState().setTab('home'))
    await user.click(within(table).getByRole('button', { name: 'Savings' }))
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'savingsGoal', month: '2026-10' })
    await user.click(within(table).getByRole('button', { name: 'Daily spending' }))
    expect(useNav.getState().tab).toBe('daily')
  })

  it('leaves out savings of 0 and every sum when the equation is off', () => {
    const { unmount } = renderHome(sample({ settings: { savingsGoal: 0 } }))
    expect(screen.queryByTestId('equation-savings')).not.toBeInTheDocument()
    unmount()
    renderHome(sample({ settings: { homeCards: ['recent'] } }))
    expect(screen.queryByTestId('equation-income')).not.toBeInTheDocument()
    expect(text(screen.getByTestId('hero-left'))).toBe('234,72 €')
  })
})

describe('the nav row', () => {
  it('opens settings from the monogram and greeting', async () => {
    const user = userEvent.setup()
    renderHome()
    const settings = screen.getByRole('button', { name: 'Settings' })
    expect(settings).toHaveAttribute('data-testid', 'open-settings')
    expect(screen.getByText('Hi, Alex')).toBeInTheDocument()
    await user.click(settings)
    expect(useNav.getState().stacks.home).toEqual([{ name: 'you' }])
  })

  it('greets without a name and says when a backup is due', () => {
    const many = Array.from({ length: 10 }, (_, i) => spend(`tx-${i}`, '2026-10-02', 100, other))
    renderHome(sample({ settings: { name: '', lastBackupAt: null }, transactions: many }))
    expect(screen.getByText('Hi there')).toBeInTheDocument()
    const settings = screen.getByRole('button', { name: 'Settings, backup due' })
    // The medallion draws the person itself (Monogram); nothing is laid over it.
    expect(settings.querySelectorAll('[data-icon="person"]')).toHaveLength(1)
  })

  it('shows and hides amounts with the eye button when they are hidden', async () => {
    const user = userEvent.setup()
    renderHome(sample({ settings: { hideAmounts: true } }))
    expect(screen.getByTestId('hero-left')).toHaveTextContent('•••')
    expect(screen.getByTestId('hero-per-day')).toHaveTextContent('About ••• a day for the next 14 days')
    await user.click(screen.getByRole('button', { name: 'Show amounts' }))
    expect(useUiStore.getState().amountsRevealed).toBe(true)
    expect(text(screen.getByTestId('hero-left'))).toBe('234,72 €')
    await user.click(screen.getByRole('button', { name: 'Hide amounts' }))
    expect(screen.getByTestId('hero-left')).toHaveTextContent('•••')
  })

  it('has no eye button while amounts show', () => {
    renderHome()
    expect(screen.queryByRole('button', { name: 'Show amounts' })).not.toBeInTheDocument()
  })
})

describe('the cards (SPEC §3.1)', () => {
  it('follow the Home layout order', () => {
    const order: HomeCardKey[] = ['recent', 'equation', 'trend', 'budgets', 'wallet', 'comingUp', 'owed', 'whereItWent']
    renderHome(sample({ settings: { homeCards: order } }))
    expect(headings()).toEqual(['This month', 'Recent', 'Last 6 months', 'Limits', 'Wallet', 'Coming up', 'Owed to you', 'Where it went'])
  })

  it('show where the daily spending went, folding the tail', async () => {
    const user = userEvent.setup()
    const extra = [spend('tx-pill', '2026-10-03', 400, health), spend('tx-misc', '2026-10-03', 300, other)]
    renderHome(sample({ transactions: [...SPENDING, ...extra] }))
    const rows = screen.getAllByTestId('category-row')
    // Each row reads name, amount, share: keep the name.
    expect(rows.map((row) => row.textContent?.replace(/[\d.,]+\s*€.*$/, ''))).toEqual([
      'Groceries',
      'Eating',
      'Going out',
      'Coffee & snacks',
      'Shopping',
      '3 more',
    ])
    // The fold announces itself as collapsed; the category rows are plain buttons.
    expect(rows.at(-1)).toHaveAttribute('aria-expanded', 'false')
    expect(rows[0]).not.toHaveAttribute('aria-expanded')
    await user.click(rows.at(-1) as HTMLElement)
    const expanded = screen.getAllByTestId('category-row')
    expect(expanded).toHaveLength(8)
    // The fold row is gone; focus moves on to the first category it held, not to the page.
    expect(expanded[5]).toHaveAttribute('data-id', transport)
    expect(expanded[5]).toHaveFocus()

    await user.click(screen.getAllByTestId('category-row')[0] as HTMLElement)
    expect(useNav.getState().stacks.home).toEqual([{ name: 'category', categoryId: groceries }])

    await user.click(screen.getByRole('button', { name: /^Plus 778,88.€ in fixed costs$/ }))
    expect(useNav.getState()).toMatchObject({ tab: 'fixed', fixedSegment: 'costs' })
  })

  it('show the limits, the ones over or near first', async () => {
    const user = userEvent.setup()
    renderHome()
    const rows = screen.getAllByTestId('budget-row')
    expect(rows.map((row) => row.getAttribute('data-id'))).toEqual([coffee, groceries, eating])
    expect(rows[0]?.querySelector('[data-status]')).toHaveAttribute('data-status', 'warning')
    expect(text(rows[0] ?? null)).toContain('1,50 € left')
    expect(
      screen.getByRole('button', { name: /^Coffee & snacks, 38,50.€ of 40,00.€, near the limit, 1,50.€ left$/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Show all/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Groceries, / }))
    expect(useNav.getState().stacks.home).toEqual([{ name: 'category', categoryId: groceries }])
  })

  it('show five limits and "Show all {n}" that opens Categories', async () => {
    const user = userEvent.setup()
    const budgets = { [coffee]: 4000, [groceries]: 18000, [eating]: 15000, [goingOut]: 8000, [shopping]: 5000, [health]: 3000 }
    renderHome(sample({ budgets }))
    expect(screen.getAllByTestId('budget-row')).toHaveLength(5)
    await user.click(screen.getByRole('button', { name: 'Show all 6' }))
    expect(useNav.getState().stacks.home).toEqual([{ name: 'you' }, { name: 'you.categories' }])
  })

  it('invite a first limit in the current month only', async () => {
    const user = userEvent.setup()
    renderHome(sample({ budgets: {} }))
    expect(screen.getByText('No monthly limits yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Set a limit' }))
    expect(useNav.getState().stacks.home).toEqual([{ name: 'you' }, { name: 'you.categories' }])
    selectMonth('2026-09')
    expect(screen.queryByRole('heading', { name: 'Limits' })).not.toBeInTheDocument()
  })

  it('list what is coming up and tick it off with Undo', async () => {
    const user = userEvent.setup()
    renderHome()
    const section = screen.getByRole('heading', { name: 'Coming up' }).closest('section') as HTMLElement
    expect(text(section)).toContain('28,99 €')
    expect(text(section)).toContain('In 4 days')
    expect(text(section)).toContain('Wed 28 Oct')
    const check = within(section).getByRole('button', { name: 'Mark Netflix as paid' })
    // The kit's paid check, as on Fixed: one control, one name, one test id.
    expect(check).toHaveAttribute('data-testid', 'recurring-paid')
    expect(check).toHaveAttribute('data-id', 'rec-netflix')
    expect(check).toHaveAttribute('aria-pressed', 'false')
    await user.click(check)
    expect(getData().months['2026-10']?.overrides?.['rec-netflix']).toEqual({ paid: true })
    expect(screen.getByTestId('toast')).toHaveTextContent('Marked Netflix as paid')
    expect(within(section).queryByText('Netflix')).not.toBeInTheDocument()
    await user.click(within(screen.getByTestId('toast')).getByRole('button', { name: 'Undo' }))
    expect(getData().months['2026-10']).toBeUndefined()
  })

  it('open a coming charge', async () => {
    const user = userEvent.setup()
    renderHome()
    await user.click(screen.getByRole('button', { name: /^Phone/ }))
    expect(useNav.getState().sheets.at(-1)?.route).toEqual({ name: 'recurring', id: 'rec-phone', kind: 'expense' })
  })

  it('show the last six months, and the months up to a past one', () => {
    renderHome()
    expect(screen.getByRole('img', { name: 'Fixed costs and daily spending, August to October' })).toBeInTheDocument()
    selectMonth('2026-09')
    expect(screen.getByRole('heading', { name: '6 months to September' })).toBeInTheDocument()
  })

  it('show the trend only once two months have data', () => {
    renderHome(sample({ recurring: [RECURRING[0] as Recurring], transactions: [spend('tx-1', '2026-10-02', 500, coffee)] }))
    expect(screen.queryByRole('heading', { name: 'Last 6 months' })).not.toBeInTheDocument()
  })

  it('list the five latest expenses and lead to Daily', async () => {
    const user = userEvent.setup()
    renderHome()
    const section = screen.getByRole('heading', { name: 'Recent' }).closest('section') as HTMLElement
    expect(within(section).getAllByTestId('tx-row').map((row) => row.getAttribute('data-id'))).toEqual([
      'tx-cappuccino',
      'tx-bus',
      'tx-shoes',
      'tx-flat-white',
      'tx-bar',
    ])
    await user.click(within(section).getByRole('button', { name: 'See all' }))
    expect(useNav.getState().tab).toBe('daily')
  })

  it('say when nothing is spent yet this month', () => {
    renderHome(sample({ transactions: [] }))
    expect(screen.getByText('No expenses yet. Tap + to add one.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Where it went' })).not.toBeInTheDocument()
  })

  it('give way to an empty state when none has anything to show', () => {
    const data = sample({ recurring: [], transactions: [], budgets: {}, settings: { savingsGoal: 0 } })
    renderHome(data)
    expect(screen.getByRole('heading', { name: 'Your month starts here' })).toBeInTheDocument()
    expect(screen.getByText('Add what you spend with + and the app does the sums.')).toBeInTheDocument()
    expect(screen.queryByTestId('wallet-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Recent' })).not.toBeInTheDocument()
  })
})
