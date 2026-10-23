import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonthStepper, MonthSwitcher, MonthTitle } from '@/app/MonthSwitcher'
import { __resetNavForTests, useNav } from '@/app/nav'
import { makeData, NOW } from '@/domain/test-helpers/dataFixtures'
import { useAppStore } from '@/store/appStore'

function setStartDay(day: number): void {
  const data = useAppStore.getState().data
  useAppStore.setState({ data: { ...data, settings: { ...data.settings, monthStartDay: day } } })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // 14 Oct 2026
  __resetNavForTests()
  // Installed 3 Aug 2026: the first period is August 2026, the last October 2027.
  useAppStore.setState({ data: makeData(), status: 'ready' })
})

afterEach(() => {
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('MonthStepper (DESIGN.md §9.3)', () => {
  it('names the month each button goes to', () => {
    render(<MonthStepper />)
    expect(screen.getByTestId('month-prev')).toHaveAccessibleName('Previous month, September')
    expect(screen.getByTestId('month-next')).toHaveAccessibleName('Next month, November')
    expect(screen.getByRole('group', { name: 'Month' })).toBeInTheDocument()
  })

  it('steps through the shared month and stops at the bounds', async () => {
    const user = userEvent.setup()
    render(<MonthStepper />)
    await user.click(screen.getByTestId('month-prev'))
    expect(useNav.getState().month).toBe('2026-09')
    await user.click(screen.getByTestId('month-prev'))
    expect(useNav.getState().month).toBe('2026-08')
    expect(screen.getByTestId('month-prev')).toBeDisabled()

    act(() => useNav.getState().setMonth('2027-10'))
    expect(screen.getByTestId('month-next')).toBeDisabled()
    expect(screen.getByTestId('month-prev')).toHaveAccessibleName('Previous month, September 2027')
  })
})

describe('MonthTitle', () => {
  it('shows the month as a button that opens the month picker', async () => {
    const user = userEvent.setup()
    render(<MonthTitle />)
    const label = screen.getByTestId('month-label')
    expect(label).toHaveTextContent(/^October$/)
    expect(label).toHaveAccessibleName('October, choose month')
    await user.click(label)
    expect(useNav.getState().sheets.map((s) => s.route)).toEqual([{ name: 'monthPicker' }])
  })

  it('adds the year outside the current year and offers the way back', async () => {
    const user = userEvent.setup()
    useNav.getState().setMonth('2027-01')
    render(<MonthTitle />)
    expect(screen.getByTestId('month-label')).toHaveTextContent('January 2027')
    await user.click(screen.getByRole('button', { name: 'Back to this month' }))
    expect(useNav.getState().month).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back to this month' })).toBeNull()
    expect(screen.getByTestId('month-label')).toHaveTextContent(/^October$/)
  })

  it('moves keyboard focus to the month when the way back disappears', async () => {
    const user = userEvent.setup()
    useNav.getState().setMonth('2026-09')
    render(<MonthTitle />)
    screen.getByRole('button', { name: 'Back to this month' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('month-label')).toHaveFocus()
  })

  it('shows the range when the month starts on another day', () => {
    setStartDay(25)
    render(<MonthTitle />)
    // 14 Oct lies in the period that starts on 25 Sep.
    expect(screen.getByTestId('month-label')).toHaveAccessibleName('September, 25 Sep – 24 Oct, choose month')
    expect(screen.getByText('25 Sep – 24 Oct')).toBeInTheDocument()
  })

  it('has a compact capsule for category detail', async () => {
    const user = userEvent.setup()
    setStartDay(25)
    render(<MonthSwitcher variant="compact" />)
    expect(screen.getByTestId('month-label')).toHaveTextContent('September')
    expect(screen.getByText('25 Sep – 24 Oct')).toBeInTheDocument()
    await user.click(screen.getByTestId('month-next'))
    expect(useNav.getState().month).toBe('2026-10')
    expect(screen.getByRole('button', { name: 'Back to this month' })).toBeInTheDocument()
  })

  it('puts the title and the stepper in one row for places without a nav row', () => {
    render(<MonthSwitcher />)
    expect(screen.getByTestId('month-label')).toBeInTheDocument()
    expect(screen.getByTestId('month-prev')).toBeInTheDocument()
    expect(screen.getByTestId('month-next')).toBeInTheDocument()
  })
})
