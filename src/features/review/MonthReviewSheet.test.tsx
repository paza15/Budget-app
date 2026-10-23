import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav } from '@/app/nav'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, makeRecurring, makeSplit, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import type { AppData, MonthKey, Transaction } from '@/domain/types'
import { MonthReviewSheet } from '@/features/review/MonthReviewSheet'
import { getData, useAppStore } from '@/store/appStore'
import { useMoneyFormat } from '@/store/hooks'
import { MoneyFormatContext } from '@/ui'

const C = DEFAULT_CATEGORY_IDS
/** U+00A0 and U+202F, the spaces Intl puts before "€" and "%"; the assertions write plain spaces. */
const INTL_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x202f)}]`, 'g')
const plain = (text: string | null | undefined): string => (text ?? '').replace(INTL_SPACES, ' ').trim()
/** A big figure's text without its spacing: "570,00€". */
const figure = (element: HTMLElement): string => (element.textContent ?? '').replaceAll(' ', '').replace(INTL_SPACES, '')
/** Matches an accessible name written with plain spaces. */
const named = (text: string) => (name: string) => plain(name) === text
/** Finds printed text (not the sentence kept for VoiceOver), written with plain spaces. */
const printed = (text: string) => (_: string, element: Element | null) =>
  element !== null && !element.classList.contains('visually-hidden') && element.tagName === 'P' && plain(element.textContent) === text

function expense(id: string, amount: number, categoryId: string, date: Transaction['date'], patch: Partial<Transaction> = {}) {
  return makeTransaction({ id, amount, categoryId, date, ...patch })
}

/**
 * Alex since Mon 3 Aug 2026: 1.450,00 € salary, 650,00 € rent (paid in October), 100,00 € savings.
 * September: Groceries 100,00 €, Eating 80,00 €. October: 230,00 € of daily spending, with Edeka
 * 41,30 € the biggest and Pizza night split with Lea (8,00 € still open); 570,00 € moved to the
 * wallet, which then holds 800,00 + 620,00 + 570,00 = 1.990,00 €. Today is Sun 1 November.
 */
function reviewData(patch: (data: AppData) => AppData = (data) => data): AppData {
  const base = makeData()
  return patch({
    ...base,
    settings: { ...base.settings, name: 'Alex', onboarded: true, savingsGoal: 10000, lastReviewedMonth: '2026-09' },
    recurring: [
      makeRecurring({ id: 'rec-salary', kind: 'income', amounts: [{ from: '2026-08', amount: 145000 }], dueDay: 28 }),
      makeRecurring({ id: 'rec-rent', amounts: [{ from: '2026-08', amount: 65000 }], dueDay: 1 }),
    ],
    months: { '2026-10': { overrides: { 'rec-rent': { paid: true } } } },
    transactions: [
      expense('sep-groceries', 10000, C.groceries, '2026-09-10'),
      expense('sep-eating', 8000, C.eating, '2026-09-12'),
      expense('oct-edeka', 4130, C.groceries, '2026-10-24', { note: 'Edeka' }),
      expense('oct-groceries-1', 3870, C.groceries, '2026-10-05'),
      expense('oct-groceries-2', 3000, C.groceries, '2026-10-15'),
      expense('oct-eating', 4000, C.eating, '2026-10-06'),
      expense('oct-pizza', 3200, C.eating, '2026-10-17', {
        note: 'Pizza night',
        splits: [makeSplit({ id: 's-lea', person: 'Lea', amount: 800 })],
      }),
      expense('oct-health', 1500, C.health, '2026-10-07'),
      expense('oct-coffee-1', 350, C.coffee, '2026-10-08'),
      expense('oct-coffee-2', 250, C.coffee, '2026-10-09'),
      expense('oct-shopping', 2000, C.shopping, '2026-10-10'),
      expense('oct-transport', 1000, C.transport, '2026-10-11'),
      expense('oct-other', 500, C.other, '2026-10-12'),
    ],
  })
}

const onClose = vi.fn<() => void>()

/** The sheet with the money format App provides from the store. */
function WithMoney({ children }: { children: ReactNode }) {
  return <MoneyFormatContext value={useMoneyFormat()}>{children}</MoneyFormatContext>
}

function renderReview(data: AppData, month: MonthKey = '2026-10') {
  useAppStore.setState({ data, status: 'ready' })
  return render(
    <WithMoney>
      <MonthReviewSheet route={{ name: 'monthReview', month }} onClose={onClose} setDirty={vi.fn<(dirty: boolean) => void>()} />
    </WithMoney>,
  )
}

/** A fact of "The month in numbers" as printed. */
function fact(testId: string): string {
  return plain(screen.getByTestId(testId).textContent)
}

/** Installed on Sat 31 Oct with a coffee that day: one tracked day in October, none in September. */
function installedOn31st(data: AppData): AppData {
  return {
    ...data,
    settings: { ...data.settings, createdAt: new Date(2026, 9, 31, 9).getTime(), lastReviewedMonth: null },
    transactions: [expense('oct-31', 350, C.coffee, '2026-10-31')],
  }
}

/** The legend rows of "Where it went", as VoiceOver reads them. */
function legend(): string[] {
  return screen.getAllByTestId('review-category').map((row) => plain(row.querySelector('.visually-hidden')?.textContent))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 1, 10))
  __resetNavForTests()
  onClose.mockClear()
})

afterEach(() => {
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('MonthReviewSheet (docs/SPEC.md §3.15, EXTRAS.md §1)', () => {
  it('is headed "{month} statement" with its dates, and closes with Close (focus starts there)', async () => {
    const user = userEvent.setup()
    renderReview(reviewData())
    expect(screen.getByRole('heading', { level: 2, name: 'October statement' })).toBeInTheDocument()
    expect(screen.getByText('1 Oct – 31 Oct 2026')).toBeInTheDocument()
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toHaveAttribute('data-autofocus')
    await user.click(close)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('only reads: opening it leaves the data as it was (its openers record the review)', () => {
    // October waits for its review; Home's "See the review" and the banner record it in their taps.
    const data = reviewData()
    renderReview(data)
    expect(getData()).toBe(data)
    expect(getData().settings.lastReviewedMonth).toBe('2026-09')
    cleanup()

    renderReview(data, '2026-09')
    expect(getData()).toBe(data)
  })

  it('leads with what moved to the wallet, beside the Closed seal', () => {
    renderReview(reviewData())
    expect(figure(screen.getByTestId('review-result'))).toBe('570,00€')
    expect(screen.getByText('Moved to your wallet')).toBeInTheDocument()
    expect(screen.getByText('Closed 31 Oct')).toBeInTheDocument()
    // VoiceOver hears the result as one sentence.
    expect(
      screen.getByText((_, element) =>
        plain(element?.textContent) ===
          'Moved to your wallet, 570,00 €. 100,00 € of savings and 470,00 € left over. Statement closed on 31 October.' &&
        element?.classList.contains('visually-hidden') === true,
      ),
    ).toBeInTheDocument()
  })

  it('writes the month as a sum that closes on "To your wallet"', () => {
    renderReview(reviewData())
    const table = screen.getByRole('table', { name: 'Money in and out' })
    const rows = within(table).getAllByRole('row').map((row) => plain(row.textContent))
    expect(rows).toEqual(['+Income1.450,00', '−Fixed costs650,00', '−Daily spending230,00', '=To your wallet570,00€'])
    expect(within(table).getByRole('rowheader', { name: 'To your wallet' })).toBeInTheDocument()
  })

  it('carries the result to the wallet: the row opens the Wallet tab and closes the sheet', async () => {
    const user = userEvent.setup()
    useNav.getState().openSheet({ name: 'monthReview', month: '2026-10' })
    renderReview(reviewData())
    await user.click(screen.getByRole('button', { name: named('Wallet after closing, 1.990,00 €') }))
    expect(useNav.getState().tab).toBe('wallet')
    expect(useNav.getState().sheets).toEqual([])
  })

  it('shows where the money went, with the change in words and the fold', () => {
    renderReview(reviewData())
    expect(screen.getByRole('img', { name: 'Daily spending in October by category' })).toBeInTheDocument()
    expect(legend()).toEqual([
      'Groceries, 110,00 €, 10 percent more than September',
      'Eating, 64,00 €, 20 percent less than September',
      'Shopping, 20,00 €, New in October',
      'Health, 15,00 €, New in October',
      'Transport, 10,00 €, New in October',
      '2 more, 11,00 €, Coffee & snacks and Other',
    ])
    const groceries = screen.getAllByTestId('review-category')[0]
    expect(plain(groceries?.textContent)).toContain('10 % more than September')
    expect(groceries?.querySelector('[data-icon="arrow-up"]')).not.toBeNull()
  })

  it('shows a single remaining category by name, and no change words without a month before', () => {
    // Without the "Other" entry only Coffee & snacks is left past the top five.
    renderReview(
      reviewData((data) => ({
        ...data,
        transactions: data.transactions.filter((tx) => tx.id !== 'oct-other' && !tx.id.startsWith('sep-')),
      })),
    )
    expect(legend()).toEqual([
      'Groceries, 110,00 €',
      'Eating, 64,00 €',
      'Shopping, 20,00 €',
      'Health, 15,00 €',
      'Transport, 10,00 €',
      'Coffee & snacks, 6,00 €',
    ])
  })

  it('gives a single remaining category its change against the month before', () => {
    // Without the "Other" entry only Coffee & snacks is left past the top five: 6,00 € after 5,00 €.
    renderReview(
      reviewData((data) => ({
        ...data,
        transactions: [
          ...data.transactions.filter((tx) => tx.id !== 'oct-other'),
          expense('sep-coffee', 500, C.coffee, '2026-09-14'),
        ],
      })),
    )
    expect(legend().at(-1)).toBe('Coffee & snacks, 6,00 €, 20 percent more than September')
    expect(screen.getAllByTestId('review-category').at(-1)).toHaveAttribute('data-id', C.coffee)
  })

  it('counts the month in numbers', async () => {
    const user = userEvent.setup()
    useNav.getState().openSheet({ name: 'monthReview', month: '2026-10' })
    renderReview(reviewData())
    expect(fact('review-biggest')).toBe('Biggest expense41,30 €Edeka, Sat 24 Oct')
    // 31 days, 11 of them with spending.
    expect(fact('review-no-spend-days')).toBe('Days without spending20')
    expect(fact('review-entries')).toBe('Entries11')
    expect(fact('review-fixed-paid')).toBe('Fixed costs paid1 of 1')
    expect(screen.getByText('Changing entries from October updates this statement and your wallet.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: named('Still owed to you, 8,00 €') }))
    expect(useNav.getState().tab).toBe('home')
    expect(useNav.getState().stacks.home).toEqual([{ name: 'owed' }])
    expect(useNav.getState().sheets).toEqual([])
  })

  it('leaves out the facts that do not apply', () => {
    renderReview(
      reviewData((data) => ({
        ...data,
        recurring: data.recurring.filter((item) => item.kind === 'income'),
        months: {},
        transactions: data.transactions.map((tx) => (tx.id === 'oct-pizza' ? { ...tx, splits: [] } : tx)),
      })),
    )
    expect(screen.queryByTestId('review-fixed-paid')).toBeNull()
    expect(screen.queryByRole('button', { name: /Still owed to you/ })).toBeNull()
  })

  it('takes money from the wallet in critical words when more went out than came in', () => {
    renderReview(
      reviewData((data) => ({
        ...data,
        transactions: [...data.transactions, expense('oct-laptop', 70000, C.shopping, '2026-10-20', { note: 'Laptop' })],
        wallet: {
          ...data.wallet,
          entries: [{ id: 'w-1', kind: 'withdrawal', amount: 200000, date: '2026-10-30', note: 'Savings account', createdAt: 0 }],
        },
      })),
    )
    expect(screen.getByText('Taken from your wallet')).toBeInTheDocument()
    expect(figure(screen.getByTestId('review-result'))).toBe('130,00€')
    expect(screen.getByTestId('review-result')).toHaveAttribute('data-tone', 'critical')
    expect(screen.getByText(printed('You spent 130,00 € more than came in.'))).toBeInTheDocument()
    expect(plain(screen.getByTestId('review-result-line').textContent)).toBe('=From your wallet−130,00€')
    // 800,00 + 620,00 − 130,00 − 2.000,00 withdrawn.
    expect(screen.getByRole('button', { name: named('Wallet after closing, short by 710,00 €') })).toBeInTheDocument()
    expect(screen.getByText('Laptop, Tue 20 Oct', { exact: false })).toBeInTheDocument()
  })

  it("reads as Home's closed month before the wallet's start", () => {
    renderReview(reviewData((data) => ({ ...data, wallet: { ...data.wallet, startMonth: '2026-11' } })))
    expect(screen.getByText('Left over')).toBeInTheDocument()
    expect(figure(screen.getByTestId('review-result'))).toBe('470,00€')
    expect(screen.getByText(printed('You spent 230,00 € on daily life.'))).toBeInTheDocument()
    const rows = within(screen.getByRole('table', { name: 'Money in and out' })).getAllByRole('row').map((row) => plain(row.textContent))
    expect(rows).toEqual(['+Income1.450,00', '−Fixed costs650,00', '−Savings100,00', '−Daily spending230,00', '=Left470,00€'])
    expect(screen.queryByRole('button', { name: /Wallet after closing/ })).toBeNull()
    expect(screen.getByText('Changing entries from October updates this statement.')).toBeInTheDocument()
  })

  it('says "None" for days without spending, and leaves the row out before the install', () => {
    renderReview(reviewData(installedOn31st))
    expect(plain(screen.getByTestId('review-no-spend-days').textContent)).toBe('Days without spendingNone')
    cleanup()

    renderReview(reviewData(installedOn31st), '2026-09')
    expect(screen.queryByTestId('review-no-spend-days')).toBeNull()
    expect(screen.queryByTestId('review-biggest')).toBeNull()
    expect(screen.queryByRole('img', { name: /Daily spending in/ })).toBeNull()
  })

  it('hides every amount behind "•••" while amounts are hidden', () => {
    renderReview(reviewData((data) => ({ ...data, settings: { ...data.settings, hideAmounts: true } })))
    expect(figure(screen.getByTestId('review-result'))).toBe('•••')
    expect(screen.getByRole('button', { name: 'Wallet after closing, amount hidden' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Still owed to you, amount hidden' })).toBeInTheDocument()
    expect(legend()[0]).toBe('Groceries, amount hidden, 10 percent more than September')
    expect(screen.queryByText(/570/)).toBeNull()
  })
})
