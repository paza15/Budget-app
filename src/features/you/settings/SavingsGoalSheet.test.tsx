import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests } from '@/app/nav'
import { makeData, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData, MonthKey } from '@/domain/types'
import { SavingsGoalSheet } from '@/features/you/SavingsGoalSheet'
import { getData, useAppStore } from '@/store/appStore'

// Rendering whole screens is slow while the machine is busy; a real failure still fails.
vi.setConfig({ testTimeout: 30_000 })

const onClose = vi.fn<() => void>()
const setDirty = vi.fn<(dirty: boolean) => void>()

function seed(patch: Partial<AppData> = {}, savingsGoal = 10000): void {
  const data = makeData(patch)
  useAppStore.setState({ data: { ...data, settings: { ...data.settings, savingsGoal } }, status: 'ready' })
}

function renderSheet(month?: MonthKey) {
  return render(
    <SavingsGoalSheet route={month === undefined ? { name: 'savingsGoal' } : { name: 'savingsGoal', month }} onClose={onClose} setDirty={setDirty} />,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // Wed 14 Oct 2026; installed 3 Aug 2026
  __resetNavForTests()
  onClose.mockReset()
  setDirty.mockReset()
  seed()
})

afterEach(() => {
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('SavingsGoalSheet (SPEC §3.7, §5.4)', () => {
  it('changes the amount for every month and keeps past months as they were', async () => {
    const user = userEvent.setup()
    renderSheet()
    expect(screen.getByText("Set aside before daily spending. It lowers what's left to spend.")).toBeInTheDocument()
    const amount = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(amount)
    await user.type(amount, '150')
    expect(setDirty).toHaveBeenLastCalledWith(true)
    await user.click(screen.getByTestId('sheet-save'))
    const data = getData()
    expect(data.settings.savingsGoal).toBe(15000)
    // setSavingsGoal froze August and September at the old goal.
    expect(data.months['2026-08']?.savingsGoal).toBe(10000)
    expect(data.months['2026-09']?.savingsGoal).toBe(10000)
    expect(data.months['2026-10']).toBeUndefined()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sets a different amount for this month only', async () => {
    const user = userEvent.setup()
    renderSheet()
    expect(screen.getByRole('heading', { name: 'This month' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Different amount this month/ }))
    const field = screen.getByRole('textbox', { name: 'Different amount this month' })
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('placeholder', expect.stringMatching(/100,00\s€/))
    await user.type(field, '40')
    await user.click(screen.getByTestId('sheet-save'))
    expect(getData().months['2026-10']?.savingsGoal).toBe(4000)
    expect(getData().settings.savingsGoal).toBe(10000)
  })

  it('names another month and goes back to the usual amount', async () => {
    const user = userEvent.setup()
    seed({ months: { '2026-11': { savingsGoal: 2500 } } })
    renderSheet('2026-11')
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    expect((screen.getByRole('textbox', { name: 'Different amount in November' }) as HTMLInputElement).value).toMatch(/^25,00\s€$/)
    await user.click(screen.getByRole('button', { name: 'Use the usual amount' }))
    await user.click(screen.getByTestId('sheet-save'))
    expect(getData().months['2026-11']).toBeUndefined()
  })

  it('says months that have ended keep their savings when opened for one', () => {
    renderSheet('2026-09')
    expect(screen.getByText(/Months that have ended keep what they had\./)).toBeInTheDocument()
  })

  it('closes without changes when nothing changed', async () => {
    const user = userEvent.setup()
    const before = getData()
    renderSheet()
    await user.click(screen.getByTestId('sheet-save'))
    expect(getData()).toBe(before)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
