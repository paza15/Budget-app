import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav } from '@/app/nav'
import { createDefaultSecurity } from '@/domain/defaults'
import { makeData, NOW } from '@/domain/test-helpers/dataFixtures'
import { forgetBiometric } from '@/features/lock/biometric'
import { verifyOwner } from '@/features/lock/verifyOwner'
import { exportBackup } from '@/features/you/backupIO'
import { EraseSheet } from '@/features/you/EraseSheet'
import { useAppStore } from '@/store/appStore'
import { eraseEverything, STORAGE_MESSAGES } from '@/store/persistence'
import { useSecurityStore } from '@/store/securityStore'
import { currentToast, dismissToast } from '@/ui/toast'

vi.mock('@/features/lock/verifyOwner', () => ({ verifyOwner: vi.fn<(reason: string) => Promise<boolean>>() }))
vi.mock('@/features/lock/biometric', () => ({
  forgetBiometric: vi.fn<(credentialId: string) => void>(),
  registerBiometric: vi.fn<() => Promise<string | null>>(),
  verifyBiometric: vi.fn<(credentialId: string, signal: AbortSignal) => Promise<boolean>>(),
}))
vi.mock('@/features/you/backupIO', () => ({
  exportBackup: vi.fn<() => Promise<'shared' | 'downloaded' | 'cancelled'>>(),
}))
vi.mock('@/store/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/persistence')>()
  return { ...actual, eraseEverything: vi.fn<typeof actual.eraseEverything>() }
})

const DAY = 86_400_000

function show() {
  const onClose = vi.fn<() => void>()
  const setDirty = vi.fn<(dirty: boolean) => void>()
  render(<EraseSheet route={{ name: 'erase' }} onClose={onClose} setDirty={setDirty} />)
  return { onClose, setDirty, eraseButton: screen.getByRole('button', { name: 'Erase' }) }
}

function setPin(biometricCredentialId: string | null = null): void {
  useSecurityStore.setState({
    config: { ...createDefaultSecurity(), pinHash: 'hash', pinSalt: 'salt', pinLength: 4, biometricCredentialId },
    status: 'ready',
    locked: false,
    unlockedOnce: true,
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  useAppStore.setState({ data: makeData(), status: 'ready' })
  useSecurityStore.setState({ config: createDefaultSecurity(), status: 'ready', locked: false, unlockedOnce: true })
  vi.mocked(eraseEverything).mockResolvedValue()
  vi.mocked(verifyOwner).mockResolvedValue(true)
  vi.mocked(exportBackup).mockResolvedValue('downloaded')
  __resetNavForTests()
  useNav.setState({
    stacks: { home: [{ name: 'you' }, { name: 'you.about' }], daily: [], fixed: [], wallet: [] },
    sheets: [{ key: 'sheet-1', route: { name: 'erase' } }],
  })
})

afterEach(() => {
  cleanup()
  const toast = currentToast()
  if (toast !== null) dismissToast(toast.id)
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  __resetNavForTests()
  useSecurityStore.setState(useSecurityStore.getInitialState(), true)
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('EraseSheet (docs/SPEC.md §3.7)', () => {
  it('asks the question, says what goes and when the last backup was', () => {
    useAppStore.setState({ data: makeData({ settings: { ...makeData().settings, lastBackupAt: NOW - 3 * DAY } }) })
    show()
    expect(screen.getByRole('heading', { name: 'Erase all data' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Erase everything on this iPhone?' })).toBeInTheDocument()
    expect(
      screen.getByText('This deletes your entries, fixed costs, categories, settings and PIN. Last backup: 3 days ago.'),
    ).toBeInTheDocument()
  })

  it('says "never" without a backup', () => {
    show()
    expect(screen.getByText(/Last backup: never\.$/)).toBeInTheDocument()
  })

  it('enables Erase only once the field says erase, in any case and spacing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { eraseButton } = show()
    const field = screen.getByRole('textbox', { name: 'Type erase to confirm' })
    // iOS leaves the word as typed: no capital E, no correction.
    expect(field).toHaveAttribute('autocapitalize', 'none')
    expect(field).toHaveAttribute('autocorrect', 'off')
    expect(eraseButton).toBeDisabled()
    await user.type(field, 'eras')
    expect(eraseButton).toBeDisabled()
    await user.type(field, 'e')
    expect(eraseButton).toBeEnabled()
    await user.clear(field)
    await user.type(field, '  Erase ')
    expect(eraseButton).toBeEnabled()
    await user.type(field, 'd')
    expect(eraseButton).toBeDisabled()
  })

  it('puts the keyboard away on Done without erasing', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { eraseButton } = show()
    const field = screen.getByRole('textbox', { name: 'Type erase to confirm' })
    await user.type(field, 'erase{Enter}')
    expect(field).not.toHaveFocus()
    expect(eraseButton).toBeEnabled()
    expect(eraseEverything).not.toHaveBeenCalled()
  })

  it('erases without asking for a PIN when none is set, and starts over from Home', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { eraseButton } = show()
    await user.type(screen.getByRole('textbox', { name: 'Type erase to confirm' }), 'erase')
    await user.click(eraseButton)
    await waitFor(() => expect(eraseEverything).toHaveBeenCalledTimes(1))
    expect(verifyOwner).not.toHaveBeenCalled()
    await waitFor(() => expect(useNav.getState().sheets).toEqual([]))
    expect(useNav.getState().stacks.home).toEqual([])
    expect(forgetBiometric).not.toHaveBeenCalled()
  })

  it('with a PIN, checks the PIN or Face ID first', async () => {
    setPin()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { eraseButton } = show()
    await user.type(screen.getByRole('textbox', { name: 'Type erase to confirm' }), 'erase')

    vi.mocked(verifyOwner).mockResolvedValueOnce(false)
    await user.click(eraseButton)
    await waitFor(() => expect(verifyOwner).toHaveBeenCalledWith('Erase all data'))
    expect(eraseEverything).not.toHaveBeenCalled()
    await waitFor(() => expect(eraseButton).toBeEnabled())

    await user.click(eraseButton)
    await waitFor(() => expect(eraseEverything).toHaveBeenCalledTimes(1))
    expect(verifyOwner).toHaveBeenCalledTimes(2)
    expect(vi.mocked(verifyOwner).mock.invocationCallOrder[1]).toBeLessThan(
      vi.mocked(eraseEverything).mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('erases nothing when the PIN check itself fails', async () => {
    setPin()
    vi.mocked(verifyOwner).mockRejectedValue(new Error('not available'))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { eraseButton } = show()
    await user.type(screen.getByRole('textbox', { name: 'Type erase to confirm' }), 'erase')
    await user.click(eraseButton)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't check your PIN or Face ID, so nothing was erased.")
    expect(eraseEverything).not.toHaveBeenCalled()
  })

  it('with Face ID, tells iOS the passkey is gone once everything is erased', async () => {
    setPin('passkey-1')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { eraseButton } = show()
    await user.type(screen.getByRole('textbox', { name: 'Type erase to confirm' }), 'erase')
    await user.click(eraseButton)
    await waitFor(() => expect(eraseEverything).toHaveBeenCalledTimes(1))
    expect(verifyOwner).toHaveBeenCalledWith('Erase all data')
    // The passkey goes with the PIN (docs/SPEC.md §8).
    await waitFor(() => expect(forgetBiometric).toHaveBeenCalledWith('passkey-1'))
    expect(useNav.getState().sheets).toEqual([])
  })

  it('keeps the sheet and says so when erasing fails', async () => {
    setPin('passkey-1')
    vi.mocked(verifyOwner).mockResolvedValue(true)
    vi.mocked(eraseEverything).mockRejectedValue(new Error(STORAGE_MESSAGES.eraseFailed))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { eraseButton } = show()
    await user.type(screen.getByRole('textbox', { name: 'Type erase to confirm' }), 'erase')
    await user.click(eraseButton)
    expect(await screen.findByRole('alert')).toHaveTextContent(STORAGE_MESSAGES.eraseFailed)
    expect(eraseButton).toBeEnabled()
    expect(forgetBiometric).not.toHaveBeenCalled()
    expect(useNav.getState().sheets).toHaveLength(1)
  })

  it('exports a backup first from the tap itself, and says it was exported', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    await user.click(screen.getByRole('button', { name: 'Export backup first' }))
    expect(exportBackup).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(currentToast()).toMatchObject({ message: 'Backup exported', tone: 'success' }))
  })

  it('says nothing when the export was cancelled', async () => {
    vi.mocked(exportBackup).mockResolvedValue('cancelled')
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    await user.click(screen.getByRole('button', { name: 'Export backup first' }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(currentToast()).toBeNull()
  })

  it('closes with Cancel and never marks itself dirty', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const { onClose, setDirty } = show()
    await user.type(screen.getByRole('textbox', { name: 'Type erase to confirm' }), 'erase')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(setDirty).not.toHaveBeenCalled()
    expect(eraseEverything).not.toHaveBeenCalled()
  })
})
