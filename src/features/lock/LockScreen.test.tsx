import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests } from '@/app/nav'
import type { SecurityConfig } from '@/domain/types'
import { makeData } from '@/domain/test-helpers/dataFixtures'
import { forgetBiometric, verifyBiometric } from '@/features/lock/biometric'
import { __resetFaceIdForTests } from '@/features/lock/faceId'
import { LockScreen } from '@/features/lock/LockScreen'
import { verifyPin } from '@/features/lock/pin'
import { pinConfig } from '@/features/lock/test-helpers'
import { useAppStore } from '@/store/appStore'
import { KEYS, setKvBackend } from '@/store/db'
import { eraseEverything } from '@/store/persistence'
import { __resetSecurityForTests, initSecurity, lockApp, resetSecurity, useSecurityStore } from '@/store/securityStore'
import { createTestBackend, type TestBackend } from '@/store/test-helpers/backends'
import { useUiStore } from '@/store/uiStore'
import { ToastHost } from '@/ui'

vi.mock('@/features/lock/biometric', () => ({
  verifyBiometric: vi.fn<(credentialId: string, signal: AbortSignal) => Promise<boolean>>(async () => false),
  forgetBiometric: vi.fn<(credentialId: string) => void>(),
  registerBiometric: vi.fn<() => Promise<string | null>>(async () => null),
  platformAuthenticatorAvailable: vi.fn<() => Promise<boolean>>(async () => true),
}))

vi.mock('@/store/persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/persistence')>()),
  // Erasing resets the lock to its defaults, unlocked (docs/SPEC.md §5.4 rule 8).
  eraseEverything: vi.fn<() => Promise<void>>(async () => resetSecurity()),
}))

const NOW = Date.UTC(2026, 9, 14, 8)
const DAY = 86_400_000

let backend: TestBackend

async function lockedWith(pin: string, patch: Partial<SecurityConfig> = {}): Promise<void> {
  await backend.inner.set(KEYS.security, await pinConfig(pin, patch))
  await initSecurity()
}

function renderLock() {
  return render(
    <>
      <LockScreen />
      <ToastHost />
    </>,
  )
}

function typeKeys(keys: string): void {
  for (const key of keys) fireEvent.click(screen.getByTestId(`keypad-${key}`))
}

function dots(): HTMLElement {
  return screen.getByTestId('pin-dots')
}

function locked(): boolean {
  return useSecurityStore.getState().locked
}

/** Face ID requests waiting for an answer. */
function faceIdRequests(): { signal: AbortSignal; answer(ok: boolean): void }[] {
  const requests: { signal: AbortSignal; answer(ok: boolean): void }[] = []
  vi.mocked(verifyBiometric).mockImplementation(
    (_id, signal) =>
      new Promise((resolve) => {
        requests.push({ signal, answer: resolve })
        signal.addEventListener('abort', () => resolve(false))
      }),
  )
  return requests
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('isSecureContext', true)
  __resetSecurityForTests()
  __resetNavForTests()
  backend = createTestBackend()
  setKvBackend(backend)
  useAppStore.setState({ data: makeData(), status: 'ready' })
  vi.mocked(verifyBiometric).mockReset().mockResolvedValue(false)
  vi.mocked(forgetBiometric).mockClear()
  vi.mocked(eraseEverything).mockClear()
})

afterEach(() => {
  cleanup()
  __resetFaceIdForTests()
  __resetSecurityForTests()
  __resetNavForTests()
  setKvBackend(null)
  useAppStore.setState(useAppStore.getInitialState(), true)
  useUiStore.setState(useUiStore.getInitialState(), true)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('PIN entry (docs/SPEC.md §3.8)', () => {
  it('shows the vault, "Enter your PIN", four empty dots and Forgot PIN?', async () => {
    await lockedWith('1234')
    renderLock()
    expect(screen.getByTestId('lock-screen')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Enter your PIN' })).toHaveFocus()
    expect(dots()).toHaveAttribute('data-filled', '0')
    expect(dots().querySelectorAll('[aria-hidden="true"]')).toHaveLength(4)
    expect(screen.getByTestId('lock-forgot')).toHaveTextContent('Forgot PIN?')
    expect(screen.queryByRole('button', { name: 'Unlock with Face ID' })).toBeNull()
    expect(screen.queryByTestId('keypad-dec')).toBeNull()
  })

  it('fills and empties the dots, and keeps six for a 6-digit PIN', async () => {
    await lockedWith('123456')
    renderLock()
    expect(dots().querySelectorAll('[aria-hidden="true"]')).toHaveLength(6)
    typeKeys('12')
    expect(dots()).toHaveAttribute('data-filled', '2')
    expect(dots()).toHaveTextContent('2 of 6 digits entered')
    fireEvent.click(screen.getByTestId('keypad-back'))
    expect(dots()).toHaveAttribute('data-filled', '1')
  })

  it('says "Wrong PIN" and clears the dots after a wrong PIN, and unlocks with the right one', async () => {
    await lockedWith('1234')
    renderLock()
    typeKeys('0000')
    expect(await screen.findByText('Wrong PIN')).toBeInTheDocument()
    expect(dots()).toHaveAttribute('data-filled', '0')
    expect(locked()).toBe(true)
    typeKeys('1')
    expect(screen.queryByText('Wrong PIN')).toBeNull()
    typeKeys('234')
    await waitFor(() => expect(locked()).toBe(false))
    expect(useSecurityStore.getState().config.failedAttempts).toBe(0)
  })

  it('takes digits and Backspace from a hardware keyboard', async () => {
    await lockedWith('1234')
    renderLock()
    fireEvent.keyDown(document, { key: '1' })
    fireEvent.keyDown(document, { key: '2' })
    fireEvent.keyDown(document, { key: 'Backspace' })
    fireEvent.keyDown(document, { key: 'a' })
    expect(dots()).toHaveAttribute('data-filled', '1')
  })

  it('blocks PIN entry with a countdown after the fifth wrong PIN', async () => {
    await lockedWith('1234', { failedAttempts: 4 })
    renderLock()
    typeKeys('9999')
    expect(await screen.findByText('Try again in 0:30')).toBeInTheDocument()
    expect(within(screen.getByTestId('lock-screen')).getByRole('status')).toHaveTextContent(
      'Too many tries. PIN entry is paused for now.',
    )
    expect(screen.getByTestId('keypad-1')).toBeDisabled()
    expect(screen.getByTestId('lock-forgot')).toBeEnabled()

    // The countdown ends and the keypad works again.
    act(() => {
      vi.setSystemTime(NOW + 30_000)
    })
    await waitFor(() => expect(screen.getByTestId('keypad-1')).toBeEnabled())
    expect(screen.queryByText(/Try again in/)).toBeNull()
  })

  it('shows a lockout that is still running when the lock screen opens', async () => {
    await lockedWith('1234', { failedAttempts: 9, lockoutUntil: NOW + 8 * 60_000 })
    renderLock()
    expect(screen.getByText('Try again in 8:00')).toBeInTheDocument()
  })

  it('says it could not check the PIN when the attempt cannot be saved', async () => {
    await lockedWith('1234')
    renderLock()
    backend.failAlways('update')
    typeKeys('1234')
    expect(await screen.findByText("Couldn't check your PIN. Reopen the app.")).toBeInTheDocument()
    expect(locked()).toBe(true)
  })
})

describe('Face ID on the lock screen (docs/SPEC.md §3.8)', () => {
  it('asks on its own once per lock episode, and opens the app when it confirms', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    vi.mocked(verifyBiometric).mockResolvedValue(true)
    await lockedWith('1234', { biometricCredentialId: 'Y3JlZA', failedAttempts: 2 })
    renderLock()
    await waitFor(() => expect(locked()).toBe(false))
    expect(verifyBiometric).toHaveBeenCalledTimes(1)
    expect(verifyBiometric).toHaveBeenCalledWith('Y3JlZA', expect.any(AbortSignal))
    await waitFor(() => expect(useSecurityStore.getState().config.failedAttempts).toBe(0))
  })

  it('does not ask again after a cancel until the next lock; the Face ID key stays', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    await lockedWith('1234', { biometricCredentialId: 'Y3JlZA' })
    renderLock()
    await waitFor(() => expect(verifyBiometric).toHaveBeenCalledTimes(1))
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(verifyBiometric).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Unlock with Face ID' })).toBeInTheDocument()

    // The next lock episode asks once more.
    act(() => lockApp())
    await waitFor(() => expect(verifyBiometric).toHaveBeenCalledTimes(2))
  })

  it('waits for the app to have focus before asking', async () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    await lockedWith('1234', { biometricCredentialId: 'Y3JlZA' })
    renderLock()
    expect(verifyBiometric).not.toHaveBeenCalled()
    hasFocus.mockReturnValue(true)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(verifyBiometric).toHaveBeenCalledTimes(1)
  })

  it('ends the Face ID request at the first PIN key, and asks again from the Face ID key', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const requests = faceIdRequests()
    await lockedWith('1234', { biometricCredentialId: 'Y3JlZA' })
    renderLock()
    await waitFor(() => expect(requests).toHaveLength(1))
    typeKeys('1')
    expect(requests[0]?.signal.aborted).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Unlock with Face ID' }))
    expect(requests).toHaveLength(2)
    act(() => requests[1]?.answer(true))
    await waitFor(() => expect(locked()).toBe(false))
  })

  it('keeps Face ID working during a PIN lockout', async () => {
    vi.mocked(verifyBiometric).mockResolvedValue(true)
    await lockedWith('1234', { biometricCredentialId: 'Y3JlZA', failedAttempts: 5, lockoutUntil: NOW + 30_000 })
    renderLock()
    const faceId = screen.getByRole('button', { name: 'Unlock with Face ID' })
    expect(faceId).toBeEnabled()
    fireEvent.click(faceId)
    await waitFor(() => expect(locked()).toBe(false))
  })

  it('ignores a Face ID answer that arrives after the app locked again', async () => {
    const requests = faceIdRequests()
    await lockedWith('1234', { biometricCredentialId: 'Y3JlZA' })
    renderLock()
    fireEvent.click(screen.getByRole('button', { name: 'Unlock with Face ID' }))
    act(() => lockApp())
    act(() => requests[0]?.answer(true))
    await Promise.resolve()
    expect(locked()).toBe(true)
  })
})

describe('Forgot PIN (docs/SPEC.md §3.7, §3.8)', () => {
  it('without Face ID goes straight to erasing, which needs "erase" typed', async () => {
    await lockedWith('1234', { autoLockMinutes: 5 })
    const data = makeData()
    useAppStore.setState({ data: { ...data, settings: { ...data.settings, lastBackupAt: NOW - 3 * DAY } } })
    renderLock()
    fireEvent.click(screen.getByTestId('lock-forgot'))
    expect(screen.getByText('Erase everything on this iPhone?')).toBeInTheDocument()
    expect(
      screen.getByText('This deletes your entries, fixed costs, categories, settings and PIN. Last backup: 3 days ago.'),
    ).toBeInTheDocument()
    const erase = screen.getByRole('button', { name: 'Erase' })
    expect(erase).toBeDisabled()
    // iOS leaves the word as typed: no capital E, no correction.
    const field = screen.getByRole('textbox', { name: 'Type erase to confirm' })
    expect(field).toHaveAttribute('autocapitalize', 'none')
    expect(field).toHaveAttribute('autocorrect', 'off')
    fireEvent.change(screen.getByRole('textbox', { name: 'Type erase to confirm' }), { target: { value: 'eras' } })
    expect(erase).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Type erase to confirm' }), { target: { value: ' Erase ' } })
    expect(erase).toBeEnabled()
    fireEvent.click(erase)
    await waitFor(() => expect(eraseEverything).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(locked()).toBe(false))
    expect(forgetBiometric).not.toHaveBeenCalled()
  })

  it('goes back to the PIN from the erase step', async () => {
    await lockedWith('1234')
    renderLock()
    fireEvent.click(screen.getByTestId('lock-forgot'))
    expect(screen.getByText(/Last backup: never\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('heading', { name: 'Enter your PIN' })).toBeInTheDocument()
  })

  it('says so when erasing fails, and stays locked', async () => {
    vi.mocked(eraseEverything).mockRejectedValueOnce(new Error("Couldn't erase"))
    await lockedWith('1234')
    renderLock()
    fireEvent.click(screen.getByTestId('lock-forgot'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Type erase to confirm' }), { target: { value: 'erase' } })
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }))
    expect(await screen.findByText("Couldn't erase the app's data. Close it completely and try again.")).toBeInTheDocument()
    expect(locked()).toBe(true)
  })

  it('with Face ID offers a new PIN after Face ID, then opens the app', async () => {
    await lockedWith('1234', { biometricCredentialId: 'Y3JlZA' })
    renderLock()
    fireEvent.click(screen.getByTestId('lock-forgot'))
    expect(screen.getByRole('heading', { name: 'Forgot your PIN?' })).toBeInTheDocument()
    vi.mocked(verifyBiometric).mockResolvedValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Use Face ID to choose a new PIN' }))
    expect(await screen.findByText("Face ID didn't confirm it's you. Try again, or erase the app's data.")).toBeInTheDocument()

    vi.mocked(verifyBiometric).mockResolvedValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'Use Face ID to choose a new PIN' }))
    expect(await screen.findByText('Choose a new PIN')).toBeInTheDocument()
    typeKeys('5678')
    await waitFor(() => expect(screen.getByText('Enter it again')).toBeInTheDocument())
    expect(dots()).toHaveAttribute('data-filled', '0')
    typeKeys('5678')
    await waitFor(() => expect(locked()).toBe(false), { timeout: 5000 })
    await expect(verifyPin('5678')).resolves.toBe('ok')
    expect(screen.getByTestId('toast')).toHaveTextContent('PIN changed')
  })

  it('with Face ID still offers erasing, and forgets the passkey after it', async () => {
    await lockedWith('1234', { biometricCredentialId: 'Y3JlZA' })
    renderLock()
    fireEvent.click(screen.getByTestId('lock-forgot'))
    fireEvent.click(screen.getByRole('button', { name: 'Erase all data' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Type erase to confirm' }), { target: { value: 'erase' } })
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }))
    await waitFor(() => expect(forgetBiometric).toHaveBeenCalledWith('Y3JlZA'))
  })
})

describe('when the lock settings cannot be read', () => {
  it('stays locked, says what happened and offers Reload and erasing', async () => {
    backend.failAlways('get')
    await initSecurity()
    renderLock()
    expect(screen.getByRole('heading', { name: "Couldn't read the app lock settings" })).toBeInTheDocument()
    expect(screen.queryByTestId('pin-dots')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Erase all data' }))
    expect(screen.getByText('Erase everything on this iPhone?')).toBeInTheDocument()
  })
})
