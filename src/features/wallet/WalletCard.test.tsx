import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useNav } from '@/app/nav'
import { daysAfterInstall, makeTransaction } from '@/domain/test-helpers/dataFixtures'
import { GRANDMA, SAVINGS, emptyWalletData, walletData } from '@/features/wallet/testData'
import { endTest, plain, renderWithApp, setData, startTest } from '@/features/wallet/testUtils'
import { WalletCard } from '@/features/wallet/WalletCard'

beforeEach(() => startTest(walletData()))

afterEach(() => {
  cleanup()
  endTest()
})

function card(): HTMLElement {
  return screen.getByTestId('wallet-card')
}

describe('the Home Wallet card (SPEC §3.1 wallet, DESIGN.md §9.26)', () => {
  it("shows today's balance and what the current month adds when it closes", async () => {
    const user = userEvent.setup()
    renderWithApp(<WalletCard month="2026-10" />)
    expect(screen.getByRole('heading', { name: 'Wallet' })).toBeInTheDocument()
    expect(plain(screen.getByTestId('wallet-card-balance').textContent)).toBe('1.450,00€')
    expect(plain(screen.getByTestId('wallet-card-line').textContent)).toBe('October adds 700,00 € when it closes')
    expect(plain(card().getAttribute('aria-label'))).toBe('Wallet, 1.450,00 €. October adds 700,00 € when it closes.')
    await user.click(card())
    expect(useNav.getState().tab).toBe('wallet')
  })

  it('says what a past month added or took out', () => {
    renderWithApp(<WalletCard month="2026-09" />)
    expect(plain(screen.getByTestId('wallet-card-line').textContent)).toBe('September added 600,00 €')
    cleanup()
    const data = walletData()
    setData({ ...data, transactions: [...data.transactions, makeTransaction({ id: 'tx-big', amount: 100000, date: '2026-09-20' })] })
    renderWithApp(<WalletCard month="2026-09" />)
    expect(plain(screen.getByTestId('wallet-card-line').textContent)).toBe('September took 400,00 € out')
  })

  it('has no line for a future month or one before the wallet starts', () => {
    renderWithApp(<WalletCard month="2026-11" />)
    expect(screen.queryByTestId('wallet-card-line')).toBeNull()
    expect(plain(card().getAttribute('aria-label'))).toBe('Wallet, 1.450,00 €.')
    cleanup()
    renderWithApp(<WalletCard month="2026-07" />)
    expect(screen.queryByTestId('wallet-card-line')).toBeNull()
  })

  it('says "Short by" below zero, in critical ink', () => {
    const big = { id: 'entry-big', kind: 'withdrawal' as const, amount: 160000, date: '2026-10-06' as const, note: '', createdAt: daysAfterInstall(64) }
    setData(walletData({ entries: [GRANDMA, SAVINGS, big] }))
    renderWithApp(<WalletCard month="2026-10" />)
    expect(screen.getByText('Short by')).toBeInTheDocument()
    expect(screen.getByTestId('wallet-card-balance').className).toMatch(/critical/)
    expect(plain(screen.getByTestId('wallet-card-balance').textContent)).toBe('150,00€')
    expect(plain(card().getAttribute('aria-label'))).toBe('Wallet, short by 150,00 €. October adds 700,00 € when it closes.')
  })

  it('hides the amounts while they are hidden', () => {
    const data = walletData()
    setData({ ...data, settings: { ...data.settings, hideAmounts: true } })
    renderWithApp(<WalletCard month="2026-10" />)
    expect(screen.getByTestId('wallet-card-balance')).toHaveTextContent(/^•••$/)
    expect(plain(screen.getByTestId('wallet-card-line').textContent)).toBe('October adds ••• when it closes')
    expect(card().getAttribute('aria-label')).toBe('Wallet, amount hidden. October adds amount hidden when it closes.')
  })

  it('leaves itself out while the wallet has nothing to show', () => {
    setData(emptyWalletData())
    const { container } = renderWithApp(<WalletCard month="2026-10" />)
    expect(container).toBeEmptyDOMElement()
  })
})
