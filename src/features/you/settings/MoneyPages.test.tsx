import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests } from '@/app/nav'
import { CURRENCIES, NUMBER_LOCALES } from '@/domain/catalog'
import { makeData, makeRecurring, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { CurrencyScreen } from '@/features/you/CurrencyScreen'
import { MonthStartScreen } from '@/features/you/MonthStartScreen'
import { NumberFormatScreen } from '@/features/you/NumberFormatScreen'
import { getData, useAppStore } from '@/store/appStore'
import { ConfirmHost, ToastHost } from '@/ui'
import { currentToast, dismissToast } from '@/ui/toast'

// Rendering whole screens is slow while the machine is busy; a real failure still fails.
vi.setConfig({ testTimeout: 30_000 })

function seed(patch: Partial<AppData> = {}, settings: Partial<AppData['settings']> = {}): void {
  const data = makeData(patch)
  useAppStore.setState({ data: { ...data, settings: { ...data.settings, ...settings } }, status: 'ready' })
}

function radioNames(group: HTMLElement): string[] {
  return within(group)
    .getAllByRole('radio')
    .map((radio) => radio.closest('label')?.textContent ?? '')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // Wed 14 Oct 2026
  __resetNavForTests()
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

describe('CurrencyScreen (SPEC §3.7)', () => {
  it('lists every currency with a sample, the chosen one checked', () => {
    render(<CurrencyScreen />)
    const list = screen.getByRole('radiogroup', { name: 'Currency' })
    expect(within(list).getAllByRole('radio')).toHaveLength(CURRENCIES.length)
    expect(within(list).getByRole('radio', { name: /^Euro/ })).toBeChecked()
    // No minor unit: whole units.
    expect(radioNames(list).find((name) => name.startsWith('Japanese yen'))).toMatch(/1\.235\s¥/)
    expect(screen.getByText('Changing the currency changes the symbol only. Amounts are not converted.')).toBeInTheDocument()
  })

  it('searches by name or code, without accents', async () => {
    const user = userEvent.setup()
    render(<CurrencyScreen />)
    const search = screen.getByRole('searchbox', { name: 'Search currencies' })
    await user.type(search, 'zloty')
    expect(radioNames(screen.getByRole('radiogroup', { name: 'Currency' }))).toEqual([expect.stringMatching(/^Polish złoty/)])
    await user.clear(search)
    await user.type(search, 'chf')
    expect(radioNames(screen.getByRole('radiogroup', { name: 'Currency' }))).toEqual([expect.stringMatching(/^Swiss franc/)])
    await user.clear(search)
    await user.type(search, 'xyz')
    expect(screen.getByText('No currency found')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('changes the currency, never the amounts', async () => {
    const user = userEvent.setup()
    const before = getData().transactions
    render(<CurrencyScreen />)
    await user.click(screen.getByRole('radio', { name: /^Swiss franc/ }))
    expect(getData().settings.currency).toBe('CHF')
    expect(getData().transactions).toBe(before)
    expect(screen.getByRole('radio', { name: /^Swiss franc/ })).toBeChecked()
  })

  it('keeps a currency from outside the list at the top', () => {
    seed({}, { currency: 'BRL' })
    render(<CurrencyScreen />)
    const first = within(screen.getByRole('radiogroup', { name: 'Currency' })).getAllByRole('radio')[0]
    expect(first).toBeChecked()
    expect(first?.closest('label')).toHaveTextContent(/^BRL/)
  })
})

describe('NumberFormatScreen (SPEC §3.7)', () => {
  it('shows a live sample for each format and applies the one tapped', async () => {
    const user = userEvent.setup()
    render(<NumberFormatScreen />)
    const list = screen.getByRole('radiogroup', { name: 'Number format' })
    expect(within(list).getAllByRole('radio')).toHaveLength(NUMBER_LOCALES.length)
    expect(within(list).getByRole('radio', { name: /^Germany/ })).toBeChecked()
    expect(within(list).getByRole('radio', { name: /^Germany/ }).closest('label')).toHaveTextContent(/1\.234,56\s€/)
    expect(within(list).getByRole('radio', { name: /^Ireland/ }).closest('label')).toHaveTextContent('€1,234.56')
    await user.click(within(list).getByRole('radio', { name: /^Ireland/ }))
    expect(getData().settings.locale).toBe('en-IE')
  })

  it('samples stay readable while amounts are hidden', () => {
    seed({}, { hideAmounts: true })
    render(<NumberFormatScreen />)
    expect(screen.getByRole('radio', { name: /^Germany/ }).closest('label')).toHaveTextContent(/1\.234,56\s€/)
  })
})

describe('MonthStartScreen (SPEC §3.7, §4.3)', () => {
  it('offers days 1 to 28 with the live line', async () => {
    const user = userEvent.setup()
    render(
      <>
        <MonthStartScreen />
        <ToastHost />
        <ConfirmHost />
      </>,
    )
    const days = screen.getByRole('radiogroup', { name: 'Day each month starts on' })
    expect(within(days).getAllByRole('radio')).toHaveLength(28)
    expect(within(days).getByRole('radio', { name: '1st' })).toBeChecked()
    expect(screen.getByText('This month runs from 1 Oct to 31 Oct.')).toBeInTheDocument()
    expect(screen.getByText('Pick your payday to make each month run from one payday to the next.')).toBeInTheDocument()
    const apply = screen.getByRole('button', { name: 'Start months on the 1st' })
    expect(apply).toBeDisabled()

    // 14 Oct lies in the period that starts on 25 Sep.
    await user.click(within(days).getByRole('radio', { name: '25th' }))
    expect(screen.getByText('This month will run from 25 Sep to 24 Oct.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start months on the 25th' })).toBeEnabled()
  })

  it('applies at once without data, with Undo', async () => {
    const user = userEvent.setup()
    render(
      <>
        <MonthStartScreen />
        <ToastHost />
        <ConfirmHost />
      </>,
    )
    await user.click(screen.getByRole('radio', { name: '25th' }))
    await user.click(screen.getByRole('button', { name: 'Start months on the 25th' }))
    await waitFor(() => expect(getData().settings.monthStartDay).toBe(25))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(currentToast()?.message).toBe('Months now start on the 25th')
    act(() => currentToast()?.action?.onClick())
    expect(getData().settings.monthStartDay).toBe(1)
  })

  it('asks first when there is data, and remaps through setMonthStartDay', async () => {
    const user = userEvent.setup()
    seed({ recurring: [makeRecurring({ startMonth: '2026-01', amounts: [{ from: '2026-01', amount: 65000 }] })] })
    render(
      <>
        <MonthStartScreen />
        <ToastHost />
        <ConfirmHost />
      </>,
    )
    await user.click(screen.getByRole('radio', { name: '25th' }))
    await user.click(screen.getByRole('button', { name: 'Start months on the 25th' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Start each month on the 25th?')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(getData().settings.monthStartDay).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Start months on the 25th' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Change' }))
    await waitFor(() => expect(getData().settings.monthStartDay).toBe(25))
    // Rent due on the 1st keeps its due dates: its first period moves back (§4.3 test).
    expect(getData().recurring[0]?.startMonth).toBe('2025-12')
  })
})
