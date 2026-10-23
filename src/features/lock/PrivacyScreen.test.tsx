import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav, type SheetRoute } from '@/app/nav'
import type { SecurityConfig } from '@/domain/types'
import { makeData } from '@/domain/test-helpers/dataFixtures'
import { forgetBiometric, platformAuthenticatorAvailable, registerBiometric } from '@/features/lock/biometric'
import { PrivacyScreen } from '@/features/lock/PrivacyScreen'
import { pinConfig } from '@/features/lock/test-helpers'
import { __resetVerifyOwnerForTests, confirmOwner } from '@/features/lock/verifyOwner'
import { useAppStore } from '@/store/appStore'
import { KEYS, setKvBackend } from '@/store/db'
import { __resetSecurityForTests, initSecurity, unlockApp, useSecurityStore } from '@/store/securityStore'
import { createTestBackend, type TestBackend } from '@/store/test-helpers/backends'
import { useUiStore } from '@/store/uiStore'
import { ToastHost } from '@/ui'
import { currentToast, dismissToast } from '@/ui/toast'

vi.mock('@/features/lock/biometric', () => ({
  verifyBiometric: vi.fn<(credentialId: string, signal: AbortSignal) => Promise<boolean>>(async () => false),
  forgetBiometric: vi.fn<(credentialId: string) => void>(),
  registerBiometric: vi.fn<() => Promise<string | null>>(async () => 'bmV3'),
  platformAuthenticatorAvailable: vi.fn<() => Promise<boolean>>(async () => false),
}))

let backend: TestBackend

async function security(patch: Partial<SecurityConfig> | null): Promise<void> {
  if (patch !== null) await backend.inner.set(KEYS.security, await pinConfig('1234', patch))
  await initSecurity()
  unlockApp()
}

function renderPrivacy() {
  return render(
    <>
      <PrivacyScreen />
      <ToastHost />
    </>,
  )
}

/** The sheet verifyOwner opened, or the one on top. */
function topSheet(): SheetRoute | undefined {
  return useNav.getState().sheets.at(-1)?.route
}

/** Answers the open verify sheet as the owner would. */
function confirmVerifySheet(): void {
  const route = topSheet()
  if (route?.name !== 'verifyOwner') throw new Error('no verify sheet')
  act(() => confirmOwner(route))
}

function appLockSwitch(): HTMLElement {
  return screen.getByRole('switch', { name: 'App lock' })
}

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true)
  __resetSecurityForTests()
  __resetNavForTests()
  backend = createTestBackend()
  setKvBackend(backend)
  useAppStore.setState({ data: makeData(), status: 'ready' })
  vi.mocked(platformAuthenticatorAvailable).mockResolvedValue(false)
  vi.mocked(registerBiometric).mockReset().mockResolvedValue('bmV3')
  vi.mocked(forgetBiometric).mockClear()
})

afterEach(() => {
  cleanup()
  const toast = currentToast()
  if (toast) dismissToast(toast.id)
  __resetVerifyOwnerForTests()
  __resetSecurityForTests()
  __resetNavForTests()
  setKvBackend(null)
  useAppStore.setState(useAppStore.getInitialState(), true)
  useUiStore.setState(useUiStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

describe('PrivacyScreen without a PIN (docs/SPEC.md §3.8)', () => {
  it('shows the lock off, the explanation and Hide amounts, and nothing that needs a PIN', async () => {
    await security(null)
    renderPrivacy()
    expect(screen.getByRole('heading', { name: 'App lock' })).toBeInTheDocument()
    expect(appLockSwitch()).not.toBeChecked()
    expect(appLockSwitch()).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Change PIN' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Lock after' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Unlock with Face ID' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Hide amounts' })).not.toBeChecked()
    expect(screen.getByText(/The lock keeps people who pick up your unlocked iPhone out of the app\./)).toBeInTheDocument()
  })

  it('turns the lock on through PIN setup', async () => {
    await security(null)
    renderPrivacy()
    fireEvent.click(appLockSwitch())
    expect(topSheet()).toEqual({ name: 'pinSetup', mode: 'enable' })
  })

  it('cannot turn the lock on outside the https address', async () => {
    vi.stubGlobal('isSecureContext', false)
    await security(null)
    renderPrivacy()
    expect(appLockSwitch()).toBeDisabled()
    expect(screen.getByText("App lock needs the app's https:// address.")).toBeInTheDocument()
  })
})

describe('PrivacyScreen with a PIN (docs/SPEC.md §3.8)', () => {
  it('turns the lock off once the owner is verified', async () => {
    await security({ biometricCredentialId: 'Y3JlZA' })
    renderPrivacy()
    expect(appLockSwitch()).toBeChecked()
    fireEvent.click(appLockSwitch())
    expect(topSheet()).toEqual({ name: 'verifyOwner', reason: 'Turn off the app lock' })
    expect(useSecurityStore.getState().config.pinHash).not.toBeNull()
    confirmVerifySheet()
    await waitFor(() => expect(appLockSwitch()).not.toBeChecked())
    expect(useSecurityStore.getState().config).toMatchObject({ pinHash: null, biometricCredentialId: null })
    expect(forgetBiometric).toHaveBeenCalledWith('Y3JlZA')
    expect(screen.getByTestId('toast')).toHaveTextContent('App lock is off')
  })

  it('keeps the lock when the verification is cancelled', async () => {
    await security({})
    renderPrivacy()
    fireEvent.click(appLockSwitch())
    act(() => useNav.getState().closeSheet())
    await waitFor(() => expect(appLockSwitch()).toBeEnabled())
    expect(appLockSwitch()).toBeChecked()
    expect(useSecurityStore.getState().config.pinHash).not.toBeNull()
  })

  it('changes the PIN after verifying the current one', async () => {
    await security({})
    renderPrivacy()
    fireEvent.click(screen.getByRole('button', { name: 'Change PIN' }))
    expect(topSheet()).toEqual({ name: 'verifyOwner', reason: 'Change your PIN' })
    confirmVerifySheet()
    await waitFor(() => expect(topSheet()).toEqual({ name: 'pinSetup', mode: 'change' }))
  })

  it('offers Lock after: Immediately, 1 minute, 5 minutes, 15 minutes and 1 hour', async () => {
    await security({ autoLockMinutes: 1 })
    renderPrivacy()
    const lockAfter = screen.getByRole('combobox', { name: 'Lock after' })
    expect(within(lockAfter).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Immediately',
      '1 minute',
      '5 minutes',
      '15 minutes',
      '1 hour',
    ])
    expect(screen.getByText('1 minute', { selector: 'span' })).toBeInTheDocument()
    fireEvent.change(lockAfter, { target: { value: '0' } })
    await waitFor(() => expect(useSecurityStore.getState().config.autoLockMinutes).toBe(0))
  })

  it('shows Face ID only where a platform authenticator exists', async () => {
    await security({})
    renderPrivacy()
    // The platform's answer arrives after the first render.
    await act(async () => {})
    expect(platformAuthenticatorAvailable).toHaveBeenCalled()
    expect(screen.queryByRole('switch', { name: 'Unlock with Face ID' })).toBeNull()
  })
})

describe('Face ID on the Privacy page (docs/SPEC.md §3.8, §8)', () => {
  it('turns Face ID on after verifying the PIN, storing the new passkey', async () => {
    vi.mocked(platformAuthenticatorAvailable).mockResolvedValue(true)
    await security({})
    renderPrivacy()
    const faceId = await screen.findByRole('switch', { name: 'Unlock with Face ID' })
    expect(faceId).not.toBeChecked()
    expect(
      screen.getByText(/Face ID unlock uses a passkey saved in your Passwords app\. If Face ID fails, iOS lets you use your iPhone passcode instead/),
    ).toBeInTheDocument()
    fireEvent.click(faceId)
    expect(topSheet()).toEqual({ name: 'verifyOwner', reason: 'Turn on Face ID' })
    expect(registerBiometric).not.toHaveBeenCalled()
    confirmVerifySheet()
    await waitFor(() => expect(useSecurityStore.getState().config.biometricCredentialId).toBe('bmV3'))
    expect(screen.getByRole('switch', { name: 'Unlock with Face ID' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Set up Face ID again' })).toBeInTheDocument()
  })

  it('offers to try again from the toast when no passkey was made', async () => {
    vi.mocked(platformAuthenticatorAvailable).mockResolvedValue(true)
    vi.mocked(registerBiometric).mockResolvedValueOnce(null)
    await security({})
    renderPrivacy()
    fireEvent.click(await screen.findByRole('switch', { name: 'Unlock with Face ID' }))
    confirmVerifySheet()
    const toast = await screen.findByTestId('toast')
    expect(toast).toHaveTextContent("Face ID wasn't set up.")
    fireEvent.click(within(toast).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(useSecurityStore.getState().config.biometricCredentialId).toBe('bmV3'))
  })

  it('sets Face ID up again with a new passkey, forgetting the old one', async () => {
    await security({ biometricCredentialId: 'b2xk' })
    renderPrivacy()
    fireEvent.click(screen.getByRole('button', { name: 'Set up Face ID again' }))
    expect(topSheet()).toEqual({ name: 'verifyOwner', reason: 'Set up Face ID again' })
    confirmVerifySheet()
    await waitFor(() => expect(useSecurityStore.getState().config.biometricCredentialId).toBe('bmV3'))
    expect(forgetBiometric).toHaveBeenCalledWith('b2xk')
  })

  it('turns Face ID off and tells Passwords the passkey is gone', async () => {
    await security({ biometricCredentialId: 'Y3JlZA' })
    renderPrivacy()
    fireEvent.click(screen.getByRole('switch', { name: 'Unlock with Face ID' }))
    await waitFor(() => expect(useSecurityStore.getState().config.biometricCredentialId).toBeNull())
    expect(forgetBiometric).toHaveBeenCalledWith('Y3JlZA')
    expect(useSecurityStore.getState().config.pinHash).not.toBeNull()
  })
})

describe('Hide amounts', () => {
  it('turns on hidden amounts and hides any shown with the eye button', async () => {
    await security(null)
    useUiStore.setState({ amountsRevealed: true })
    renderPrivacy()
    fireEvent.click(screen.getByRole('switch', { name: 'Hide amounts' }))
    expect(useAppStore.getState().data.settings.hideAmounts).toBe(true)
    expect(useUiStore.getState().amountsRevealed).toBe(false)
    expect(screen.getByRole('switch', { name: 'Hide amounts' })).toBeChecked()
  })
})
