import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav } from '@/app/nav'
import { ACCENTS } from '@/domain/catalog'
import { createDefaultSecurity } from '@/domain/defaults'
import { createMoneyFormat } from '@/domain/money'
import { makeData, makeSplit, makeTransaction, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { YouScreen } from '@/features/you/YouScreen'
import { getData, useAppStore } from '@/store/appStore'
import { useSecurityStore } from '@/store/securityStore'
import { useUiStore } from '@/store/uiStore'
import { MoneyFormatContext } from '@/ui'

// Rendering whole screens is slow while the machine is busy; a real failure still fails.
vi.setConfig({ testTimeout: 30_000 })

const DAY = 86_400_000

function seed(patch: Partial<AppData> = {}, settings: Partial<AppData['settings']> = {}): void {
  const data = makeData(patch)
  useAppStore.setState({ data: { ...data, settings: { ...data.settings, ...settings } }, status: 'ready' })
}

function renderYou(masked = false) {
  const money = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked })
  return render(
    <MoneyFormatContext value={money}>
      <YouScreen />
    </MoneyFormatContext>,
  )
}

/** A row's button by the start of its name (the e2e specs find them so). */
function row(name: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${name}`) })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW) // Wed 14 Oct 2026
  __resetNavForTests()
  seed({}, { name: 'Alex', savingsGoal: 10000 })
})

afterEach(() => {
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  useSecurityStore.setState(useSecurityStore.getInitialState(), true)
  useUiStore.setState({ amountsRevealed: false })
  vi.useRealTimers()
})

describe('YouScreen (SPEC §3.7)', () => {
  it('lists the settings in the order of the spec', () => {
    renderYou()
    const text = document.body.textContent ?? ''
    const labels = [
      'Name and monogram',
      'Theme',
      'Accent',
      'Show cents in the big number',
      'Home layout',
      'Currency',
      'Number format',
      'Month starts on',
      'Monthly savings',
      'Categories',
      'Quick add buttons',
      'Owed to you',
      'App lock',
      'Hide amounts',
      'Backup',
      'About',
    ]
    const positions = labels.map((label) => text.indexOf(label))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual(positions.toSorted((a, b) => a - b))
    expect(screen.getByRole('heading', { level: 1, name: 'You' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to Home' })).toBeInTheDocument()
  })

  it('shows each setting’s value', () => {
    seed({ transactions: [makeTransaction({ amount: 1800, splits: [makeSplit({ amount: 900 })] })] }, { name: 'Alex', savingsGoal: 10000 })
    renderYou()
    expect(row('Currency')).toHaveTextContent('Euro')
    expect(row('Number format')).toHaveTextContent(/1\.234,56\s€/)
    expect(row('Month starts on')).toHaveTextContent('1st')
    expect(row('Monthly savings')).toHaveTextContent(/100,00\s€/)
    expect(row('Categories')).toHaveTextContent('12')
    expect(row('Quick add buttons')).toHaveTextContent('3')
    expect(row('Owed to you')).toHaveTextContent(/9,00\s€/)
    expect(row('App lock')).toHaveTextContent('Off')
  })

  it('says None when nobody owes anything and On when the app lock is set', () => {
    useSecurityStore.setState({ config: { ...createDefaultSecurity(), pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==' } })
    renderYou()
    expect(row('Owed to you')).toHaveTextContent('None')
    expect(row('App lock')).toHaveTextContent('On')
  })

  it('changes the theme with a select named Theme', async () => {
    const user = userEvent.setup()
    renderYou()
    const theme = screen.getByRole('combobox', { name: 'Theme' })
    expect(within(theme).getAllByRole('option').map((option) => option.textContent)).toEqual(['System', 'Light', 'Dark'])
    await user.selectOptions(theme, 'Dark')
    expect(getData().settings.theme).toBe('dark')
    await user.selectOptions(theme, 'Light')
    expect(getData().settings.theme).toBe('light')
  })

  it('offers the eight accents by name and applies the one tapped', async () => {
    const user = userEvent.setup()
    renderYou()
    const accent = screen.getByRole('radiogroup', { name: 'Accent' })
    const radios = within(accent).getAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(ACCENTS.map(({ name }) => name))
    expect(within(accent).getByRole('radio', { name: 'Navy' })).toBeChecked()
    await user.click(within(accent).getByRole('radio', { name: 'Bottle green' }))
    expect(getData().settings.accent).toBe('bottle')
  })

  it('switches cents in the big number and hidden amounts', async () => {
    const user = userEvent.setup()
    useUiStore.setState({ amountsRevealed: true })
    renderYou()
    await user.click(screen.getByRole('switch', { name: 'Show cents in the big number' }))
    expect(getData().settings.showCents).toBe(false)
    await user.click(screen.getByRole('switch', { name: 'Hide amounts' }))
    expect(getData().settings.hideAmounts).toBe(true)
    // Amounts shown with the eye button hide again at once.
    expect(useUiStore.getState().amountsRevealed).toBe(false)
  })

  it('opens each subpage on the Home stack', async () => {
    const user = userEvent.setup()
    renderYou()
    const routes: [string, string][] = [
      ['Home layout', 'you.homeLayout'],
      ['Currency', 'you.currency'],
      ['Number format', 'you.numberFormat'],
      ['Month starts on', 'you.monthStart'],
      ['Categories', 'you.categories'],
      ['Quick add buttons', 'you.quickAdds'],
      ['Owed to you', 'owed'],
      ['App lock', 'you.privacy'],
      ['Backup', 'you.backup'],
      ['About', 'you.about'],
    ]
    for (const [name, route] of routes) {
      await user.click(row(name))
      expect(useNav.getState().stacks.home.at(-1)).toEqual({ name: route })
    }
  })

  it('opens the savings sheet from Monthly savings and shows this month’s own amount', async () => {
    const user = userEvent.setup()
    seed({ months: { '2026-10': { savingsGoal: 5000 } } }, { savingsGoal: 10000 })
    renderYou()
    expect(row('Monthly savings')).toHaveTextContent(/This month: 50,00\s€/)
    await user.click(row('Monthly savings'))
    expect(useNav.getState().sheets.map((entry) => entry.route)).toEqual([{ name: 'savingsGoal' }])
  })

  it('marks the Backup row while a backup is due', () => {
    // Installed 40 days ago, 10 entries, never backed up (§4.6 needsBackupReminder).
    const transactions = Array.from({ length: 10 }, (_, i) => makeTransaction({ id: `tx-${i}` }))
    seed({ transactions }, { createdAt: NOW - 40 * DAY })
    renderYou()
    expect(screen.getByRole('button', { name: 'Backup, backup due' })).toBeInTheDocument()
    expect(screen.getByTestId('backup-due')).toBeInTheDocument()
  })

  it('has no dot without a reason', () => {
    renderYou()
    expect(screen.getByRole('button', { name: 'Backup' })).toBeInTheDocument()
    expect(screen.queryByTestId('backup-due')).toBeNull()
  })

  it('masks money values but never the number format sample', () => {
    renderYou(true)
    expect(within(row('Monthly savings')).getByRole('img', { name: 'Amount hidden' })).toBeInTheDocument()
    expect(row('Number format')).toHaveTextContent(/1\.234,56\s€/)
  })
})

describe('the profile (SPEC §3.7)', () => {
  it('opens in place and saves the name as it is typed', async () => {
    const user = userEvent.setup()
    renderYou()
    const profile = screen.getByRole('button', { name: /^Alex/ })
    expect(profile).toHaveAttribute('aria-expanded', 'false')
    await user.click(profile)
    expect(profile).toHaveAttribute('aria-expanded', 'true')

    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Sam ')
    // The store keeps it trimmed; the field keeps the space while it has focus.
    expect(getData().settings.name).toBe('Sam')
    expect(name).toHaveValue('Sam ')
    expect(name).toHaveAttribute('maxlength', '24')
    await user.tab()
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Sam')
  })

  it('picks an emoji and goes back to the initial', async () => {
    const user = userEvent.setup()
    renderYou()
    await user.click(screen.getByRole('button', { name: /^Alex/ }))
    const picker = screen.getByRole('radiogroup', { name: 'Monogram' })
    expect(within(picker).getByRole('radio', { name: 'Use my initial' })).toBeChecked()
    await user.click(within(picker).getByRole('radio', { name: '🦊' }))
    expect(getData().settings.avatar).toBe('🦊')
    await user.click(within(picker).getByRole('radio', { name: 'Use my initial' }))
    expect(getData().settings.avatar).toBe('')
  })

  it('invites a name when there is none', () => {
    seed({}, { name: '' })
    renderYou()
    expect(screen.getByRole('button', { name: /^Add your name/ })).toBeInTheDocument()
  })
})
