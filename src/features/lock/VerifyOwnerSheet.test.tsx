import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav, type SheetRoute } from '@/app/nav'
import type { SecurityConfig } from '@/domain/types'
import { makeData } from '@/domain/test-helpers/dataFixtures'
import { verifyBiometric } from '@/features/lock/biometric'
import { __resetFaceIdForTests } from '@/features/lock/faceId'
import { pinConfig } from '@/features/lock/test-helpers'
import { __resetVerifyOwnerForTests, verifyOwner } from '@/features/lock/verifyOwner'
import { VerifyOwnerSheet } from '@/features/lock/VerifyOwnerSheet'
import { useAppStore } from '@/store/appStore'
import { KEYS, setKvBackend } from '@/store/db'
import { __resetSecurityForTests, initSecurity, unlockApp, useSecurityStore } from '@/store/securityStore'
import { createTestBackend, type TestBackend } from '@/store/test-helpers/backends'

vi.mock('@/features/lock/biometric', () => ({
  verifyBiometric: vi.fn<(credentialId: string, signal: AbortSignal) => Promise<boolean>>(async () => false),
  forgetBiometric: vi.fn<(credentialId: string) => void>(),
  platformAuthenticatorAvailable: vi.fn<() => Promise<boolean>>(async () => true),
}))

let backend: TestBackend

/** Unlocked with PIN 1234; verifyOwner(reason) has opened the sheet, rendered here. */
async function openSheet(reason: string, patch: Partial<SecurityConfig> = {}) {
  await backend.inner.set(KEYS.security, await pinConfig('1234', patch))
  await initSecurity()
  unlockApp()
  const answer = verifyOwner(reason)
  const route = useNav.getState().sheets.at(-1)?.route as Extract<SheetRoute, { name: 'verifyOwner' }>
  const onClose = vi.fn<() => void>(() => useNav.getState().closeSheet())
  render(<VerifyOwnerSheet route={route} onClose={onClose} setDirty={vi.fn<(dirty: boolean) => void>()} />)
  return { answer, onClose }
}

function typeKeys(keys: string): void {
  for (const key of keys) fireEvent.click(screen.getByTestId(`keypad-${key}`))
}

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true)
  __resetSecurityForTests()
  __resetNavForTests()
  backend = createTestBackend()
  setKvBackend(backend)
  useAppStore.setState({ data: makeData(), status: 'ready' })
  vi.mocked(verifyBiometric).mockReset().mockResolvedValue(false)
})

afterEach(() => {
  cleanup()
  __resetVerifyOwnerForTests()
  __resetFaceIdForTests()
  __resetSecurityForTests()
  __resetNavForTests()
  setKvBackend(null)
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('VerifyOwnerSheet (docs/SPEC.md §3.8)', () => {
  it('names the change and asks for the PIN', async () => {
    await openSheet('Turn off the app lock')
    expect(screen.getByRole('heading', { name: 'Turn off the app lock' })).toBeInTheDocument()
    expect(screen.getByText('Enter your PIN')).toBeInTheDocument()
    expect(screen.getByTestId('pin-dots')).toHaveAttribute('data-filled', '0')
    expect(screen.queryByRole('button', { name: 'Use Face ID' })).toBeNull()
  })

  it('confirms with the right PIN and closes', async () => {
    const { answer, onClose } = await openSheet('Change your PIN')
    typeKeys('0000')
    expect(await screen.findByText('Wrong PIN')).toBeInTheDocument()
    typeKeys('1234')
    await expect(answer).resolves.toBe(true)
    expect(onClose).toHaveBeenCalled()
  })

  it('answers false when cancelled', async () => {
    const { answer } = await openSheet('Change your PIN')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(answer).resolves.toBe(false)
  })

  it('asks for Face ID on its own once, and confirms with it', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    vi.mocked(verifyBiometric).mockResolvedValue(true)
    const { answer } = await openSheet('Turn off the app lock', { biometricCredentialId: 'Y3JlZA' })
    await expect(answer).resolves.toBe(true)
    expect(verifyBiometric).toHaveBeenCalledTimes(1)
  })

  it('never asks for a passkey made while it was open (turning Face ID on is verified here)', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    await openSheet('Turn on Face ID')
    act(() => {
      useSecurityStore.setState({ config: { ...useSecurityStore.getState().config, biometricCredentialId: 'Y3JlZA' } })
    })
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(verifyBiometric).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Use Face ID' })).toBeNull()
  })

  it('keeps the Face ID key after a cancel', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const { answer } = await openSheet('Erase all data', { biometricCredentialId: 'Y3JlZA' })
    await waitFor(() => expect(verifyBiometric).toHaveBeenCalledTimes(1))
    vi.mocked(verifyBiometric).mockResolvedValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Use Face ID' }))
    await expect(answer).resolves.toBe(true)
  })
})
