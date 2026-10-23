import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PinSetupFlow } from '@/features/lock/PinSetupFlow'
import { verifyPin } from '@/features/lock/pin'
import { setKvBackend } from '@/store/db'
import { __resetSecurityForTests, initSecurity, useSecurityStore } from '@/store/securityStore'
import { createTestBackend, type TestBackend } from '@/store/test-helpers/backends'

vi.mock('@/features/lock/biometric', () => ({
  forgetBiometric: vi.fn<(credentialId: string) => void>(),
  platformAuthenticatorAvailable: vi.fn<() => Promise<boolean>>(async () => false),
}))

let backend: TestBackend

function typeKeys(keys: string): void {
  for (const key of keys) fireEvent.click(screen.getByTestId(`keypad-${key}`))
}

function dots(): HTMLElement {
  return screen.getByTestId('pin-dots')
}

function dotCount(): number {
  return dots().querySelectorAll('[aria-hidden="true"]').length
}

/** Types the first entry and waits for the confirmation to start empty. */
async function chooseFirst(pin: string): Promise<void> {
  typeKeys(pin)
  await screen.findByText('Enter it again')
  expect(dots()).toHaveAttribute('data-filled', '0')
}

beforeEach(async () => {
  vi.stubGlobal('isSecureContext', true)
  __resetSecurityForTests()
  backend = createTestBackend()
  setKvBackend(backend)
  await initSecurity()
})

afterEach(() => {
  cleanup()
  __resetSecurityForTests()
  setKvBackend(null)
  vi.unstubAllGlobals()
})

describe('PinSetupFlow (docs/SPEC.md §3.8)', () => {
  it('starts with a 4-digit PIN, the length choice labelled "4 digits" and "6 digits"', () => {
    render(<PinSetupFlow mode="enable" onDone={vi.fn<() => void>()} onCancel={vi.fn<() => void>()} />)
    expect(screen.getByText('Choose a PIN')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'PIN length' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '4 digits' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '6 digits' })).not.toBeChecked()
    expect(dotCount()).toBe(4)
  })

  it('confirms the PIN with empty dots, saves it and finishes', async () => {
    const onDone = vi.fn<() => void>()
    render(<PinSetupFlow mode="enable" onDone={onDone} onCancel={vi.fn<() => void>()} />)
    await chooseFirst('2580')
    expect(screen.getByRole('radiogroup', { name: 'PIN length' }).closest('[inert]')).not.toBeNull()
    typeKeys('2580')
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { timeout: 5000 })
    expect(useSecurityStore.getState().config).toMatchObject({ pinLength: 4 })
    await expect(verifyPin('2580')).resolves.toBe('ok')
  })

  it('starts over when the confirmation does not match', async () => {
    const onDone = vi.fn<() => void>()
    render(<PinSetupFlow mode="enable" onDone={onDone} onCancel={vi.fn<() => void>()} />)
    await chooseFirst('1111')
    typeKeys('2222')
    expect(await screen.findByText("The PINs didn't match. Try again.")).toBeInTheDocument()
    expect(screen.getByText('Choose a PIN')).toBeInTheDocument()
    expect(dots()).toHaveAttribute('data-filled', '0')
    expect(onDone).not.toHaveBeenCalled()
    expect(useSecurityStore.getState().config.pinHash).toBeNull()
  })

  it('takes six digits when chosen, dropping what was typed', async () => {
    const onDone = vi.fn<() => void>()
    render(<PinSetupFlow mode="change" onDone={onDone} onCancel={vi.fn<() => void>()} />)
    expect(screen.getByText('Choose a new PIN')).toBeInTheDocument()
    typeKeys('12')
    fireEvent.click(screen.getByText('6 digits'))
    expect(dotCount()).toBe(6)
    expect(dots()).toHaveAttribute('data-filled', '0')
    await chooseFirst('135790')
    typeKeys('135790')
    await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 5000 })
    expect(useSecurityStore.getState().config.pinLength).toBe(6)
  })

  it('deletes the last digit', () => {
    render(<PinSetupFlow mode="enable" onDone={vi.fn<() => void>()} onCancel={vi.fn<() => void>()} />)
    typeKeys('12')
    fireEvent.click(screen.getByTestId('keypad-back'))
    expect(dots()).toHaveAttribute('data-filled', '1')
  })

  it('says so when the PIN cannot be saved, and starts over', async () => {
    const onDone = vi.fn<() => void>()
    render(<PinSetupFlow mode="enable" onDone={onDone} onCancel={vi.fn<() => void>()} />)
    await chooseFirst('1234')
    backend.failAlways('update')
    typeKeys('1234')
    expect(await screen.findByText("Couldn't save the PIN. Try again.", undefined, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByText('Choose a PIN')).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('offers its own way out only when given a label', () => {
    const onCancel = vi.fn<() => void>()
    const { rerender } = render(<PinSetupFlow mode="enable" onDone={vi.fn<() => void>()} onCancel={onCancel} />)
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()
    rerender(<PinSetupFlow mode="enable" onDone={vi.fn<() => void>()} onCancel={onCancel} cancelLabel="Not now" />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
