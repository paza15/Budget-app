import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonthPickerSheet } from '@/app/MonthPickerSheet'
import { __resetNavForTests, useNav } from '@/app/nav'
import { makeData, makeTransaction, NOW } from '@/domain/test-helpers/dataFixtures'
import { useAppStore } from '@/store/appStore'

const onClose = vi.fn<() => void>()

function renderPicker() {
  return render(<MonthPickerSheet route={{ name: 'monthPicker' }} onClose={onClose} setDirty={() => {}} />)
}

function month(name: RegExp) {
  return screen.getByRole('button', { name })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // 14 Oct 2026
  __resetNavForTests()
  onClose.mockReset()
  // Installed 3 Aug 2026, with an expense from 20 Jul 2026: the first period is July 2026.
  useAppStore.setState({
    data: makeData({ transactions: [makeTransaction({ id: 'tx-old', date: '2026-07-20' })] }),
    status: 'ready',
  })
})

afterEach(() => {
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('MonthPickerSheet (DESIGN.md §9.3)', () => {
  it('offers the periods from the first one with data to twelve months ahead', async () => {
    const user = userEvent.setup()
    renderPicker()
    expect(screen.getByRole('heading', { name: '2026' })).toBeInTheDocument()
    expect(month(/^June 2026/)).toBeDisabled()
    expect(month(/^July 2026/)).toBeEnabled()
    expect(month(/^December 2026/)).toBeEnabled()
    // Nothing before 2026 has data.
    expect(screen.getByRole('button', { name: 'Previous year, 2025' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Next year, 2027' }))
    expect(screen.getByRole('heading', { name: '2027' })).toBeInTheDocument()
    expect(month(/^October 2027/)).toBeEnabled()
    expect(month(/^November 2027/)).toBeDisabled()
    // October 2027 is twelve months ahead: 2028 is out of reach.
    expect(screen.getByRole('button', { name: 'Next year, 2028' })).toBeDisabled()
  })

  it('marks the current and the selected period', () => {
    useNav.getState().setMonth('2026-08')
    renderPicker()
    expect(month(/^October 2026/)).toHaveAttribute('aria-current', 'date')
    expect(month(/^October 2026/)).toHaveAttribute('aria-pressed', 'false')
    expect(month(/^August 2026/)).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects a period and closes', async () => {
    const user = userEvent.setup()
    renderPicker()
    await user.click(month(/^August 2026/))
    expect(useNav.getState().month).toBe('2026-08')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stores the current period as null', async () => {
    const user = userEvent.setup()
    useNav.getState().setMonth('2026-08')
    renderPicker()
    await user.click(month(/^October 2026/))
    expect(useNav.getState().month).toBeNull()
  })

  it('opens on the year of the selected period', () => {
    useNav.getState().setMonth('2027-02')
    renderPicker()
    expect(screen.getByRole('heading', { name: '2027' })).toBeInTheDocument()
  })

  it('names periods with their range when the month starts on another day', () => {
    const data = useAppStore.getState().data
    useAppStore.setState({ data: { ...data, settings: { ...data.settings, monthStartDay: 25 } } })
    renderPicker()
    expect(month(/^October 2026/)).toHaveAccessibleName('October 2026, 25 Oct – 24 Nov')
    // 14 Oct lies in the period that starts on 25 Sep.
    expect(month(/^September 2026/)).toHaveAttribute('aria-current', 'date')
  })
})
