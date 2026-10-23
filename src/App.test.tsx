import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import { __resetNavForTests } from '@/app/nav'
import { createDefaultSecurity } from '@/domain/defaults'
import { makeData, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { useAppStore } from '@/store/appStore'
import { __resetPersistenceForTests, useStorageStatus } from '@/store/persistence'
import { useSecurityStore, type SecurityState } from '@/store/securityStore'
import { toast } from '@/ui'
import { currentToast, dismissToast } from '@/ui/toast'

vi.mock('@/features/lock/LockScreen', () => ({
  LockScreen: () => <div data-testid="lock-screen">Enter your PIN</div>,
}))
vi.mock('@/features/onboarding/Onboarding', () => ({
  Onboarding: () => <div data-testid="onboarding">Welcome</div>,
}))
vi.mock('@/features/home/HomeScreen', () => ({ HomeScreen: StatefulHome }))

/** A Home root with state of its own, to show what a lock keeps. */
function StatefulHome() {
  const [note, setNote] = useState('')
  return (
    <label>
      Home note
      <input value={note} onChange={(event) => setNote(event.target.value)} />
    </label>
  )
}

function onboardedData(): AppData {
  const data = makeData()
  return { ...data, settings: { ...data.settings, name: 'Alex', onboarded: true } }
}

const PIN = { ...createDefaultSecurity(), pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==' }

function setSecurity(patch: Partial<SecurityState>): void {
  act(() => useSecurityStore.setState(patch))
}

function appRoot(): HTMLElement | null {
  return document.getElementById('app-root')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  __resetPersistenceForTests()
  __resetNavForTests()
  useSecurityStore.setState(useSecurityStore.getInitialState(), true)
})

afterEach(() => {
  cleanup()
  const shown = currentToast()
  if (shown !== null) dismissToast(shown.id)
  __resetPersistenceForTests()
  __resetNavForTests()
  useSecurityStore.setState(useSecurityStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('App gates (docs/SPEC.md §5.6)', () => {
  it('shows only the loading screen until both stores have loaded', () => {
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(appRoot()).toBeNull()

    // The data alone is not enough: the lock state decides what may show.
    act(() => useAppStore.setState({ data: onboardedData(), status: 'ready' }))
    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(appRoot()).toBeNull()
    expect(screen.queryByTestId('tab-home')).toBeNull()

    setSecurity({ status: 'ready', locked: false, unlockedOnce: true })
    expect(screen.queryByText('Loading')).toBeNull()
    expect(screen.getByTestId('tab-home')).toBeInTheDocument()
    expect(screen.getByTestId('screen-home')).toHaveAttribute('data-active', 'true')
  })

  it('renders nothing but the lock screen on a cold start with a PIN', () => {
    useAppStore.setState({ data: onboardedData(), status: 'ready' })
    useSecurityStore.setState({ config: PIN, status: 'ready', locked: true, unlockedOnce: false })
    render(<App />)
    expect(screen.getByTestId('lock-screen')).toBeInTheDocument()
    expect(appRoot()).toBeNull()
    expect(screen.queryByTestId('tab-home')).toBeNull()
    expect(screen.queryByLabelText('Home note')).toBeNull()

    // After the first unlock the app mounts.
    setSecurity({ locked: false, unlockedOnce: true })
    expect(screen.queryByTestId('lock-screen')).toBeNull()
    expect(screen.getByTestId('tab-home')).toBeInTheDocument()
  })

  it('stays locked when the lock state cannot be read', () => {
    useAppStore.setState({ data: onboardedData(), status: 'ready' })
    useSecurityStore.setState({ status: 'error', locked: true, unlockedOnce: false })
    render(<App />)
    expect(screen.getByTestId('lock-screen')).toBeInTheDocument()
    expect(appRoot()).toBeNull()
  })

  it('keeps the app mounted, inert and hidden under a later lock', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ data: onboardedData(), status: 'ready' })
    useSecurityStore.setState({ config: PIN, status: 'ready', locked: false, unlockedOnce: true })
    render(<App />)
    await user.type(screen.getByLabelText('Home note'), 'Rent')
    expect(appRoot()).not.toHaveAttribute('inert')

    setSecurity({ locked: true })
    expect(screen.getByTestId('lock-screen')).toBeInTheDocument()
    expect(appRoot()).toHaveAttribute('inert')
    expect(appRoot()).toHaveAttribute('aria-hidden', 'true')
    // Still mounted, but out of reach of VoiceOver.
    expect(appRoot()?.querySelector('input')).toHaveValue('Rent')
    expect(screen.queryByRole('textbox', { name: 'Home note' })).toBeNull()

    setSecurity({ locked: false })
    expect(screen.queryByTestId('lock-screen')).toBeNull()
    expect(appRoot()).not.toHaveAttribute('inert')
    expect(screen.getByRole('textbox', { name: 'Home note' })).toHaveValue('Rent')
  })

  it('shows onboarding until the user has been through it', () => {
    useAppStore.setState({ data: makeData(), status: 'ready' })
    useSecurityStore.setState({ status: 'ready', locked: false, unlockedOnce: true })
    render(<App />)
    expect(screen.getByTestId('onboarding')).toBeInTheDocument()
    expect(screen.queryByTestId('tab-home')).toBeNull()
  })

  it('replaces the app with the storage screen while storage cannot be used', () => {
    useAppStore.setState({ data: onboardedData(), status: 'ready' })
    useStorageStatus.setState({ phase: 'conflict' })
    useSecurityStore.setState({ status: 'ready', locked: false, unlockedOnce: true })
    render(<App />)
    expect(screen.getByRole('heading', { name: 'The app was changed in another window.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.queryByTestId('tab-home')).toBeNull()
  })

  it('shows toasts during onboarding, from outside the gates', () => {
    useAppStore.setState({ data: makeData(), status: 'ready' })
    useSecurityStore.setState({ status: 'ready', locked: false, unlockedOnce: true })
    render(<App />)
    expect(screen.getByTestId('onboarding')).toBeInTheDocument()
    act(() => {
      toast({ message: 'Backup restored', tone: 'success' })
    })
    const shown = screen.getByTestId('toast')
    expect(shown).toHaveTextContent('Backup restored')
    // Outside #app-root, so a storage screen that replaces the app keeps it too.
    expect(appRoot()).not.toContainElement(shown)
  })

  it('applies the theme and accent from the settings', () => {
    const data = onboardedData()
    useAppStore.setState({ data: { ...data, settings: { ...data.settings, theme: 'dark', accent: 'teal' } }, status: 'ready' })
    useSecurityStore.setState({ status: 'ready', locked: false, unlockedOnce: true })
    render(<App />)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.accent).toBe('teal')
  })
})
