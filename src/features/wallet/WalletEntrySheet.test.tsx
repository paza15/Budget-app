import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SheetRoute } from '@/app/nav'
import { TODAY } from '@/domain/test-helpers/dataFixtures'
import { GRANDMA, SAVINGS, walletData } from '@/features/wallet/testData'
import { endTest, plain, renderWithApp, startTest } from '@/features/wallet/testUtils'
import { WalletEntrySheet } from '@/features/wallet/WalletEntrySheet'
import { getData } from '@/store/appStore'
import { currentToast } from '@/ui/toast'

beforeEach(() => startTest(walletData()))

afterEach(() => {
  cleanup()
  endTest()
})

function renderSheet(route: Extract<SheetRoute, { name: 'walletEntry' }>) {
  const onClose = vi.fn<() => void>()
  const setDirty = vi.fn<(dirty: boolean) => void>()
  renderWithApp(<WalletEntrySheet route={route} onClose={onClose} setDirty={setDirty} />)
  return { onClose, setDirty }
}

async function press(user: ReturnType<typeof userEvent.setup>, keys: string): Promise<void> {
  for (const key of keys) {
    const id = key === ',' ? 'keypad-dec' : key === '<' ? 'keypad-back' : `keypad-${key}`
    await user.click(screen.getByTestId(id))
  }
}

function display(): string {
  return plain(screen.getByTestId('amount-display').textContent)
}

function walletAfter(): string {
  return plain(screen.getByTestId('wallet-consequence').textContent)
}

describe('adding money (SPEC §3.12)', () => {
  it('adds what is typed on the keypad, then offers Undo', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ name: 'walletEntry', kind: 'deposit' })
    expect(screen.getByRole('heading', { name: 'Add money' })).toBeInTheDocument()
    const save = screen.getByTestId('sheet-save')
    expect(save).toHaveTextContent('Add money')
    expect(save).toBeDisabled()
    expect(walletAfter()).toBe('')

    await press(user, '50')
    expect(display()).toBe('Amount 50€')
    expect(walletAfter()).toBe('Wallet after: 1.500,00 €')

    await user.click(save)
    expect(onClose).toHaveBeenCalledOnce()
    expect(getData().wallet.entries.at(-1)).toMatchObject({ kind: 'deposit', amount: 5000, date: TODAY, note: '' })
    await waitFor(() => expect(plain(currentToast()?.message)).toBe('Added 50,00 € to your wallet'))
    act(() => currentToast()?.action?.onClick())
    expect(getData().wallet.entries).toEqual([GRANDMA, SAVINGS])
  })

  it('keeps a note and the date picked with the chips', async () => {
    const user = userEvent.setup()
    renderSheet({ name: 'walletEntry', kind: 'deposit' })
    await press(user, '12,5')
    expect(display()).toBe('Amount 12,5€')
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Sold my old phone')
    const yesterday = screen.getByRole('button', { name: 'Yesterday' })
    await user.click(yesterday)
    expect(yesterday).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByTestId('sheet-save'))
    expect(getData().wallet.entries.at(-1)).toMatchObject({ amount: 1250, date: '2026-10-13', note: 'Sold my old phone' })
  })

  it('offers dates up to today and shows a picked one on the third chip', () => {
    renderSheet({ name: 'walletEntry', kind: 'deposit' })
    const other = screen.getByLabelText('Other date')
    expect(other).toHaveAttribute('max', TODAY)
    fireEvent.change(other, { target: { value: '2026-10-20' } })
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(other, { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(other, { target: { value: '2026-09-01' } })
    expect(screen.getByLabelText('Other date, Tuesday 1 September 2026')).toBeInTheDocument()
    expect(screen.getByText('1 Sep')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('hides the keypad while the note is typed', async () => {
    const user = userEvent.setup()
    renderSheet({ name: 'walletEntry', kind: 'deposit' })
    await user.click(screen.getByRole('textbox', { name: 'Note' }))
    expect(screen.queryByRole('group', { name: 'Amount keypad' })).toBeNull()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('group', { name: 'Amount keypad' })).toBeInTheDocument()
  })

  it('reports unsaved changes', async () => {
    const user = userEvent.setup()
    const { setDirty } = renderSheet({ name: 'walletEntry', kind: 'deposit' })
    await press(user, '5')
    expect(setDirty).toHaveBeenLastCalledWith(true)
    await press(user, '<')
    expect(setDirty).toHaveBeenLastCalledWith(false)
  })
})

describe('taking money out', () => {
  it('warns in critical words when the wallet would go below zero, and still allows it', async () => {
    const user = userEvent.setup()
    renderSheet({ name: 'walletEntry', kind: 'withdrawal' })
    expect(screen.getByRole('heading', { name: 'Take money out' })).toBeInTheDocument()
    await press(user, '2000')
    expect(walletAfter()).toBe('Wallet after: short by 550,00 €')
    expect(screen.getByTestId('wallet-consequence').className).toMatch(/critical/)
    const save = screen.getByTestId('sheet-save')
    expect(save).toHaveTextContent('Take money out')
    await user.click(save)
    expect(getData().wallet.entries.at(-1)).toMatchObject({ kind: 'withdrawal', amount: 200000 })
    await waitFor(() => expect(plain(currentToast()?.message)).toBe('Took 2.000,00 € out of your wallet'))
  })
})

describe('editing an entry', () => {
  it('starts with the entry; the first digit replaces the amount', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ name: 'walletEntry', id: SAVINGS.id })
    expect(screen.getByRole('heading', { name: 'Edit entry' })).toBeInTheDocument()
    expect(display()).toBe('Amount 200€')
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Moved to my savings account')
    expect(screen.getByText('5 Oct')).toBeInTheDocument()
    // Its own 200,00 € comes back in before the new amount goes out: 1.650,00 − 5,00.
    await press(user, '5')
    expect(display()).toBe('Amount 5€')
    expect(walletAfter()).toBe('Wallet after: 1.645,00 €')
    await user.click(screen.getByTestId('sheet-save'))
    expect(screen.getByTestId('sheet-save')).toHaveTextContent('Save changes')
    expect(onClose).toHaveBeenCalledOnce()
    expect(getData().wallet.entries.find((entry) => entry.id === SAVINGS.id)).toMatchObject({ amount: 500, date: '2026-10-05' })
    await waitFor(() => expect(currentToast()?.message).toBe('Saved'))
  })

  it('lets backspace edit the amount instead of replacing it', async () => {
    const user = userEvent.setup()
    renderSheet({ name: 'walletEntry', id: GRANDMA.id })
    await press(user, '<')
    expect(display()).toBe('Amount 5€')
  })

  it('deletes from the header, with Undo', async () => {
    const user = userEvent.setup()
    const { onClose } = renderSheet({ name: 'walletEntry', id: SAVINGS.id })
    await user.click(screen.getByTestId('sheet-delete'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(getData().wallet.entries).toEqual([GRANDMA])
    await waitFor(() => expect(currentToast()?.message).toBe('Deleted Moved to my savings account'))
    act(() => currentToast()?.action?.onClick())
    expect(getData().wallet.entries).toEqual([GRANDMA, SAVINGS])
  })

  it('says so when the entry is gone', () => {
    renderSheet({ name: 'walletEntry', id: 'entry-missing' })
    expect(screen.getByText('This entry was deleted')).toBeInTheDocument()
    expect(screen.queryByTestId('sheet-save')).toBeNull()
  })
})
