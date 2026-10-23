import { act, cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useNav } from '@/app/nav'
import { daysAfterInstall, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import type { WalletEntry } from '@/domain/types'
import { BIKE, GRANDMA, JACKET, JAPAN, SAVINGS, emptyWalletData, walletData } from '@/features/wallet/testData'
import { endTest, plain, renderWithApp, setData, startTest } from '@/features/wallet/testUtils'
import { WalletScreen } from '@/features/wallet/WalletScreen'
import { getData } from '@/store/appStore'
import { useUiStore } from '@/store/uiStore'

beforeEach(() => startTest(walletData()))

afterEach(() => {
  cleanup()
  endTest()
})

function heroText(): string {
  return plain(screen.getByTestId('wallet-hero').querySelector('.visually-hidden')?.textContent)
}

/** The text of each cell of a passbook line. */
function cells(row: Element | undefined): string[] {
  return [...(row?.querySelectorAll('[role="cell"]') ?? [])].map((cell) => plain(cell.textContent))
}

/** Whether `b` comes after `a` in the document. */
function follows(a: Node, b: Node): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

function sheets() {
  return useNav.getState().sheets.map((entry) => entry.route)
}

function withdrawal(id: string, amount: number, date: WalletEntry['date']): WalletEntry {
  return { id, kind: 'withdrawal', amount, date, note: '', createdAt: daysAfterInstall(60) }
}

describe('the hero (DESIGN.md §9.26)', () => {
  it('shows the balance as the title, what October adds and what the goals leave free', () => {
    renderWithApp(<WalletScreen />)
    expect(screen.getByRole('heading', { level: 1, name: 'Wallet' })).toBeInTheDocument()
    expect(plain(screen.getByTestId('wallet-balance').textContent)).toBe('1.450,00 €')
    expect(plain(screen.getByTestId('wallet-pending').textContent)).toBe('October adds 700,00 € when it closes')
    expect(plain(screen.getByTestId('wallet-free').textContent)).toBe('Not set aside: 0,00 €')
    // VoiceOver reads the hero as one label.
    expect(heroText()).toBe('Wallet, 1.450,00 €. October adds 700,00 € when it closes. Not set aside: 0,00 €.')
  })

  it('keeps the app banners above the balance, under the nav row', () => {
    const { container } = renderWithApp(<WalletScreen />)
    const slots = container.querySelectorAll('[data-banner-slot]')
    expect(slots).toHaveLength(1)
    expect(follows(screen.getByRole('banner'), slots[0] as Node)).toBe(true)
    expect(follows(slots[0] as Node, screen.getByTestId('wallet-hero'))).toBe(true)
  })

  it('says "Short by" below zero, in critical ink, and leaves out "Not set aside"', () => {
    setData(walletData({ entries: [GRANDMA, SAVINGS, withdrawal('entry-big', 160000, '2026-10-06')] }))
    renderWithApp(<WalletScreen />)
    expect(screen.getByText('Short by')).toBeInTheDocument()
    expect(screen.getByTestId('wallet-balance')).toHaveAttribute('data-tone', 'critical')
    expect(plain(screen.getByTestId('wallet-balance').textContent)).toBe('150,00 €')
    expect(screen.queryByTestId('wallet-free')).toBeNull()
    expect(heroText()).toBe('Wallet, short by 150,00 €. October adds 700,00 € when it closes.')
  })

  it('says what October takes out when it overspends', () => {
    setData({ ...walletData(), transactions: [...walletData().transactions, makeTransaction({ id: 'tx-big', amount: 90000, date: '2026-10-12' })] })
    renderWithApp(<WalletScreen />)
    expect(plain(screen.getByTestId('wallet-pending').textContent)).toBe('October takes 200,00 € out when it closes')
  })

  it('hides the month line while the current month is before the wallet starts', () => {
    setData(walletData({ startMonth: '2026-11' }))
    renderWithApp(<WalletScreen />)
    expect(screen.queryByTestId('wallet-pending')).toBeNull()
  })

  it('shows "Not set aside" only with active goals', () => {
    setData(walletData({ goals: [JACKET] }))
    renderWithApp(<WalletScreen />)
    expect(screen.queryByTestId('wallet-free')).toBeNull()
  })

  it('masks every figure while amounts are hidden, with an eye button to show them', async () => {
    const user = userEvent.setup()
    const data = walletData()
    setData({ ...data, settings: { ...data.settings, hideAmounts: true } })
    renderWithApp(<WalletScreen />)
    expect(heroText()).toBe('Wallet, amount hidden. October adds amount hidden when it closes. Not set aside: amount hidden.')
    expect(screen.getByTestId('wallet-balance')).toHaveTextContent('•••')
    expect(within(screen.getByRole('table', { name: 'Passbook' })).getAllByText('•••').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Show amounts' }))
    expect(useUiStore.getState().amountsRevealed).toBe(true)
    expect(plain(screen.getByTestId('wallet-balance').textContent)).toBe('1.450,00 €')
    expect(screen.getByRole('button', { name: 'Hide amounts' })).toBeInTheDocument()
  })

  it('has no eye button while amounts are shown', () => {
    renderWithApp(<WalletScreen />)
    expect(screen.queryByRole('button', { name: 'Show amounts' })).toBeNull()
  })
})

describe('actions', () => {
  it('opens the entry sheet with its kind, and the settings', async () => {
    const user = userEvent.setup()
    renderWithApp(<WalletScreen />)
    await user.click(screen.getByRole('button', { name: 'Add money' }))
    await user.click(screen.getByRole('button', { name: 'Take money out' }))
    await user.click(screen.getByRole('button', { name: 'Wallet settings' }))
    expect(sheets()).toEqual([
      { name: 'walletEntry', kind: 'deposit' },
      { name: 'walletEntry', kind: 'withdrawal' },
      { name: 'walletSettings' },
    ])
  })
})

describe('goals (SPEC §3.14)', () => {
  it('lists the active goals in fill order with what each holds and where it stands', () => {
    renderWithApp(<WalletScreen />)
    const list = screen.getByRole('list', { name: 'Goals, filled from the top' })
    const rows = within(list).getAllByTestId('goal-row')
    expect(rows.map((row) => row.dataset.id)).toEqual([JAPAN.id, BIKE.id])
    expect(plain(rows[0]?.textContent)).toContain('550,00 € to go')
    expect(plain(rows[1]?.textContent)).toContain('Fills after Japan trip')
    expect(plain(within(list).getAllByTestId('goal-open')[0]?.getAttribute('aria-label'))).toBe(
      'Japan trip, 1.450,00 € of 2.000,00 €, 550,00 € to go',
    )
    // The first goal cannot move up and the last cannot move down.
    expect(screen.queryByRole('button', { name: 'Fill Japan trip sooner' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Fill Japan trip later' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fill New bike sooner' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fill New bike later' })).toBeNull()
    expect(screen.getByText('Your wallet fills goals from the top.')).toBeInTheDocument()
  })

  it('shows the seal and "Reached" on a full goal', () => {
    setData(walletData({ goals: [{ ...JAPAN, target: 100000 }, BIKE] }))
    renderWithApp(<WalletScreen />)
    const [japan] = screen.getAllByTestId('goal-row')
    expect(japan).toHaveAttribute('data-phase', 'reached')
    expect(within(japan as HTMLElement).getByText('Reached')).toBeInTheDocument()
    expect(plain(within(japan as HTMLElement).getByTestId('goal-open').getAttribute('aria-label'))).toBe(
      'Japan trip, 1.000,00 € of 1.000,00 €, reached',
    )
  })

  it('says "Nothing set aside yet" for the first goal of a wallet below zero', () => {
    setData(walletData({ entries: [GRANDMA, SAVINGS, withdrawal('entry-big', 160000, '2026-10-06')] }))
    renderWithApp(<WalletScreen />)
    expect(screen.getByText('Nothing set aside yet')).toBeInTheDocument()
  })

  it('moves a goal up, keeps focus on its buttons and announces the new order', async () => {
    const user = userEvent.setup()
    renderWithApp(<WalletScreen />)
    await user.click(screen.getByRole('button', { name: 'Fill New bike sooner' }))
    // Winter jacket (done) keeps its place, so Put back still returns it first.
    expect(getData().wallet.goals.toSorted((a, b) => a.order - b.order).map((goal) => goal.id)).toEqual([JACKET.id, BIKE.id, JAPAN.id])
    expect(screen.getAllByTestId('goal-row').map((row) => row.dataset.id)).toEqual([BIKE.id, JAPAN.id])
    // The up button is gone now that New bike is first: focus moved to its other button.
    expect(screen.getByRole('button', { name: 'Fill New bike later' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('New bike fills first now')

    await user.click(screen.getByRole('button', { name: 'Fill New bike later' }))
    expect(screen.getAllByTestId('goal-row').map((row) => row.dataset.id)).toEqual([JAPAN.id, BIKE.id])
    expect(screen.getByRole('button', { name: 'Fill New bike sooner' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('New bike fills after Japan trip now')
  })

  it('opens a goal and adds one', async () => {
    const user = userEvent.setup()
    renderWithApp(<WalletScreen />)
    await user.click(screen.getAllByTestId('goal-open')[1] as HTMLElement)
    await user.click(screen.getByRole('button', { name: 'Add a goal' }))
    expect(sheets()).toEqual([{ name: 'goal', id: BIKE.id }, { name: 'goal' }])
  })

  it('keeps done goals collapsed under "Done", each with "Put back"', async () => {
    const user = userEvent.setup()
    renderWithApp(<WalletScreen />)
    const head = screen.getByRole('button', { name: 'Done, 1' })
    expect(head).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Put back Winter jacket' })).toBeNull()

    await user.click(head)
    expect(head).toHaveAttribute('aria-expanded', 'true')
    expect(head).toHaveAttribute('aria-controls', screen.getByRole('list', { name: 'Done goals' }).id)
    expect(plain(screen.getByTestId('goal-done-row').textContent)).toContain('120,00 €, done 3 Oct')

    await user.click(screen.getByRole('button', { name: 'Put back Winter jacket' }))
    expect(getData().wallet.goals.find((goal) => goal.id === JACKET.id)?.doneAt).toBeNull()
    // It returns to its place, the top, and focus follows it there.
    expect(screen.getAllByTestId('goal-row').map((row) => row.dataset.id)).toEqual([JACKET.id, JAPAN.id, BIKE.id])
    expect(screen.queryByRole('button', { name: /^Done/ })).toBeNull()
    expect(screen.getAllByTestId('goal-open')[0]).toHaveFocus()
  })

  it('invites a first goal', () => {
    setData(walletData({ goals: [] }))
    renderWithApp(<WalletScreen />)
    expect(screen.queryByRole('list', { name: 'Goals, filled from the top' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add a goal' })).toBeInTheDocument()
    expect(screen.getByText('Saving for something? Add it here and your wallet fills it.')).toBeInTheDocument()
  })
})

describe('the passbook (SPEC §3.12, DESIGN.md §9.26)', () => {
  it('lists every movement oldest first with signed amounts and running balances', () => {
    renderWithApp(<WalletScreen />)
    const table = screen.getByRole('table', { name: 'Passbook' })
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Date', 'Entry', 'Amount', 'Balance'])
    const rows = within(table).getAllByTestId('wallet-row')
    expect(rows.map((row) => row.dataset.kind)).toEqual(['opening', 'month', 'deposit', 'month', 'withdrawal'])
    // Month closings carry the seal in the date column, with the date for screen readers only.
    expect(rows.map((row) => cells(row))).toEqual([
      ['1 Aug', 'Opening balance', '+500,00', '500,00'],
      ['31 August', 'August closed', '+500,00', '1.000,00'],
      ['12 Sep', 'Birthday money from grandma', '+50,00', '1.050,00'],
      ['30 September', 'September closed', '+600,00', '1.650,00'],
      ['5 Oct', 'Moved to my savings account', '−200,00', '1.450,00'],
    ])
    expect(within(rows[4] as HTMLElement).getByRole('button')).toHaveAccessibleName(
      /^5 October, taken out, Moved to my savings account, minus 200,00\s€, balance 1\.450,00\s€$/,
    )
    expect(screen.getByText(/When a month closes, its savings and what was left over move here/)).toBeInTheDocument()
  })

  it('opens what made each line', async () => {
    const user = userEvent.setup()
    const data = walletData()
    setData({
      ...data,
      transactions: [
        ...data.transactions,
        makeTransaction({ id: 'tx-laptop', amount: 54900, note: 'Laptop', fromWallet: true, date: '2026-10-14' }),
      ],
    })
    renderWithApp(<WalletScreen />)
    await user.click(screen.getByRole('button', { name: /Opening balance/ }))
    await user.click(screen.getByRole('button', { name: /Birthday money from grandma/ }))
    await user.click(screen.getByRole('button', { name: /Paid: Laptop/ }))
    expect(sheets()).toEqual([
      { name: 'walletSettings' },
      { name: 'walletEntry', id: GRANDMA.id },
      { name: 'transaction', id: 'tx-laptop' },
    ])

    // A month closing is not edited here: Home shows that month.
    await user.click(screen.getByRole('button', { name: /August closed/ }))
    expect(useNav.getState().tab).toBe('home')
    expect(useNav.getState().month).toBe('2026-08')
    expect(useNav.getState().sheets).toEqual([])
  })

  it('closes the book on today\'s balance, critical below zero', () => {
    setData(walletData({ entries: [GRANDMA, SAVINGS, withdrawal('entry-big', 160000, '2026-10-06')] }))
    renderWithApp(<WalletScreen />)
    const last = screen.getAllByTestId('wallet-row').at(-1) as HTMLElement
    expect(cells(last)).toEqual(['6 Oct', 'Taken out', '−1.600,00', '−150,00'])
    expect(within(last).getByRole('button')).toHaveAccessibleName(/^6 October, Taken out, minus 1\.600,00\s€, balance minus 150,00\s€$/)
  })

  it('opens a long book on its latest 24 movements under "Brought forward"', async () => {
    const user = userEvent.setup()
    const entries = Array.from({ length: 40 }, (_, i): WalletEntry => ({
      id: `entry-${i}`,
      kind: 'deposit',
      amount: 100,
      date: '2026-10-01',
      note: `Coins ${i}`,
      createdAt: daysAfterInstall(60) + i,
    }))
    setData(walletData({ entries }))
    renderWithApp(<WalletScreen />)
    let rows = screen.getAllByTestId('wallet-row')
    expect(rows).toHaveLength(25)
    expect(rows[0]).toHaveAttribute('data-kind', 'forward')
    // 43 movements (opening, two closings, 40 coins): the 19 before the latest 24 end at 1.616,00 €.
    expect(cells(rows[0])).toEqual(['', 'Brought forward', '', '1.616,00'])

    await user.click(screen.getByRole('button', { name: /^Brought forward/ }))
    rows = screen.getAllByTestId('wallet-row')
    expect(rows).toHaveLength(43)
    expect(rows[0]).toHaveAttribute('data-kind', 'opening')
    // The button is gone, so focus moves to the first line.
    expect(within(rows[0] as HTMLElement).getByRole('button')).toHaveFocus()
  })

  it('adds a year row at each year in a book that spans years', () => {
    const old: WalletEntry = { ...GRANDMA, id: 'entry-old', date: '2025-12-20', note: 'Christmas money' }
    setData(walletData({ entries: [old, GRANDMA, SAVINGS] }))
    renderWithApp(<WalletScreen />)
    expect(screen.getAllByTestId('wallet-year').map((row) => row.textContent)).toEqual(['2025', '2026'])
    expect(screen.getByRole('button', { name: /^20 December 2025, added, Christmas money/ })).toBeInTheDocument()
  })

  it('invites an opening balance while the wallet is empty', async () => {
    const user = userEvent.setup()
    setData(emptyWalletData())
    renderWithApp(<WalletScreen />)
    expect(plain(screen.getByTestId('wallet-balance').textContent)).toBe('0,00 €')
    expect(screen.queryByRole('table', { name: 'Passbook' })).toBeNull()
    expect(screen.getByText('Your wallet fills up when a month closes')).toBeInTheDocument()
    expect(screen.queryByText(/When a month closes, its savings/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Set an opening balance' }))
    expect(sheets()).toEqual([{ name: 'walletSettings' }])
  })

  it('takes in a new movement while open', () => {
    renderWithApp(<WalletScreen />)
    act(() => {
      setData(walletData({ entries: [GRANDMA, SAVINGS, withdrawal('entry-new', 1000, '2026-10-14')] }))
    })
    expect(screen.getAllByTestId('wallet-row')).toHaveLength(6)
    expect(plain(screen.getByTestId('wallet-balance').textContent)).toBe('1.440,00 €')
  })
})
