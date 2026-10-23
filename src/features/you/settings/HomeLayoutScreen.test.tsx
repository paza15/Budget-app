import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests } from '@/app/nav'
import { HOME_CARDS } from '@/domain/catalog'
import { makeData, NOW } from '@/domain/test-helpers/dataFixtures'
import type { HomeCardKey } from '@/domain/types'
import { HomeLayoutScreen } from '@/features/you/HomeLayoutScreen'
import { getData, useAppStore } from '@/store/appStore'

// Rendering whole screens is slow while the machine is busy; a real failure still fails.
vi.setConfig({ testTimeout: 30_000 })

const ALL: HomeCardKey[] = HOME_CARDS.map(({ key }) => key)

function seed(homeCards: HomeCardKey[]): void {
  const data = makeData()
  useAppStore.setState({ data: { ...data, settings: { ...data.settings, homeCards } }, status: 'ready' })
}

/** The switches' names in the order the page lists them. */
function listed(): string[] {
  return screen.getAllByRole('switch').map((toggle) => toggle.getAttribute('aria-labelledby') ?? '').map((id) => document.getElementById(id)?.textContent ?? '')
}

function name(key: HomeCardKey): string {
  return HOME_CARDS.find((card) => card.key === key)?.name ?? key
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  __resetNavForTests()
  seed(ALL)
})

afterEach(() => {
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('HomeLayoutScreen (SPEC §3.7)', () => {
  it('has a switch per card, named as in HOME_CARDS', () => {
    render(<HomeLayoutScreen />)
    expect(listed()).toEqual(HOME_CARDS.map((card) => card.name))
    expect(screen.getByRole('switch', { name: 'Show the sums above the total' })).toBeChecked()
    for (const card of HOME_CARDS) {
      expect(screen.getByRole('button', { name: `Move ${card.name} up` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Move ${card.name} down` })).toBeInTheDocument()
    }
    // The top card cannot go up, the bottom one cannot go down.
    expect(screen.getByRole('button', { name: `Move ${name('equation')} up` })).toBeDisabled()
    expect(screen.getByRole('button', { name: `Move ${name('recent')} down` })).toBeDisabled()
    expect(screen.getByRole('button', { name: `Move ${name('recent')} up` })).toBeEnabled()
  })

  it('moves a card to the top, where its up button is disabled', async () => {
    const user = userEvent.setup()
    render(<HomeLayoutScreen />)
    const up = screen.getByRole('button', { name: 'Move Recent up' })
    for (let step = 0; step < ALL.length - 1; step += 1) await user.click(up)
    expect(up).toBeDisabled()
    expect(getData().settings.homeCards).toEqual(['recent', ...ALL.filter((key) => key !== 'recent')])
    expect(listed()[0]).toBe('Recent')
    // Focus stays on the row: the down button, since up went away.
    expect(screen.getByRole('button', { name: 'Move Recent down' })).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Recent is now first')
  })

  it('hides a card where it is and shows it again in the same place', async () => {
    const user = userEvent.setup()
    render(<HomeLayoutScreen />)
    await user.click(screen.getByRole('switch', { name: 'Where it went' }))
    expect(getData().settings.homeCards).toEqual(ALL.filter((key) => key !== 'whereItWent'))
    expect(screen.getByRole('switch', { name: 'Where it went' })).not.toBeChecked()
    expect(listed()).toEqual(HOME_CARDS.map((card) => card.name))

    // Moving a shown card past the hidden one, then showing it again: it comes back where it sits.
    await user.click(screen.getByRole('button', { name: 'Move Limits up' }))
    expect(listed().slice(2, 5)).toEqual(['Owed to you', 'Limits', 'Where it went'])
    await user.click(screen.getByRole('switch', { name: 'Where it went' }))
    expect(getData().settings.homeCards).toEqual(['equation', 'wallet', 'owed', 'budgets', 'whereItWent', 'comingUp', 'trend', 'recent'])
  })

  it('lists hidden cards near their default place on a new visit', () => {
    seed(['recent', 'equation', 'budgets'])
    render(<HomeLayoutScreen />)
    expect(listed()).toEqual(['Recent', 'Show the sums above the total', 'Wallet', 'Owed to you', 'Where it went', 'Limits', 'Coming up', 'Last 6 months'])
    const recent = screen.getByRole('switch', { name: 'Recent' })
    expect(recent).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Wallet' })).not.toBeChecked()
  })

  it('turns the sums above the total off', async () => {
    const user = userEvent.setup()
    render(<HomeLayoutScreen />)
    await user.click(screen.getByRole('switch', { name: 'Show the sums above the total' }))
    expect(getData().settings.homeCards).not.toContain('equation')
    const footer = screen.getByText(/Home shows the cards in this order/)
    expect(within(footer).queryByRole('button')).toBeNull()
  })
})
