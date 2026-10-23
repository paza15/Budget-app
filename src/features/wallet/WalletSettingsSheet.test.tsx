import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { walletData } from '@/features/wallet/testData'
import { endTest, plain, renderWithApp, setData, startTest } from '@/features/wallet/testUtils'
import { WalletSettingsSheet } from '@/features/wallet/WalletSettingsSheet'
import { getData } from '@/store/appStore'
import { currentToast } from '@/ui/toast'

beforeEach(() => startTest(walletData()))

afterEach(() => {
  cleanup()
  endTest()
})

function renderSheet() {
  const onClose = vi.fn<() => void>()
  const setDirty = vi.fn<(dirty: boolean) => void>()
  renderWithApp(<WalletSettingsSheet route={{ name: 'walletSettings' }} onClose={onClose} setDirty={setDirty} />)
  return { onClose, setDirty }
}

describe('wallet settings (SPEC §3.12)', () => {
  it('shows the opening balance and the month the wallet counts from', () => {
    renderSheet()
    expect(screen.getByRole('heading', { name: 'Wallet settings' })).toBeInTheDocument()
    expect(plain((screen.getByRole('textbox', { name: 'Opening balance' }) as HTMLInputElement).value)).toBe('500,00 €')
    expect(screen.getByText('Money you had saved when you started.')).toBeInTheDocument()
    const start = screen.getByRole('combobox', { name: 'Counts from' })
    // From the first month with data to the current one.
    expect(within(start).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'August 2026',
      'September 2026',
      'October 2026',
    ])
    expect(start).toHaveDisplayValue('August 2026')
    expect(screen.getByText("Months before this don't change your wallet.")).toBeInTheDocument()
  })

  it('saves a new opening balance, with Undo', async () => {
    const user = userEvent.setup()
    const { onClose, setDirty } = renderSheet()
    const opening = screen.getByRole('textbox', { name: 'Opening balance' })
    await user.clear(opening)
    await user.type(opening, '750')
    expect(setDirty).toHaveBeenLastCalledWith(true)
    await user.click(screen.getByTestId('sheet-save'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(getData().wallet.opening).toBe(75000)
    await waitFor(() => expect(currentToast()?.message).toBe('Saved'))
    act(() => currentToast()?.action?.onClick())
    expect(getData().wallet.opening).toBe(50000)
  })

  it('stores the chosen first month, and the setup month as the default', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Counts from' }), 'September 2026')
    await user.click(screen.getByTestId('sheet-save'))
    expect(getData().wallet.startMonth).toBe('2026-09')

    cleanup()
    renderSheet()
    expect(screen.getByRole('combobox', { name: 'Counts from' })).toHaveDisplayValue('September 2026')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Counts from' }), 'August 2026')
    await user.click(screen.getByTestId('sheet-save'))
    // August is the month the app was set up in: stored as null, it follows start-day changes.
    expect(getData().wallet.startMonth).toBeNull()
  })

  it('changes nothing when nothing changed', async () => {
    const user = userEvent.setup()
    const before = getData()
    const { onClose } = renderSheet()
    await user.click(screen.getByTestId('sheet-save'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(getData()).toBe(before)
  })

  it('leaves the field empty without an opening balance, and saves an empty field as 0', async () => {
    const user = userEvent.setup()
    setData(walletData({ opening: 0 }))
    renderSheet()
    const opening = screen.getByRole('textbox', { name: 'Opening balance' })
    expect(opening).toHaveValue('')
    expect(opening).toHaveAttribute('placeholder', expect.stringMatching(/^0,00\s€$/))
    await user.type(opening, '20')
    await user.clear(opening)
    await user.click(screen.getByTestId('sheet-save'))
    expect(getData().wallet.opening).toBe(0)
  })
})
