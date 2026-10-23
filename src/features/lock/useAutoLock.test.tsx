import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSecurity } from '@/domain/defaults'
import type { SecurityConfig } from '@/domain/types'
import { verifyBiometric } from '@/features/lock/biometric'
import { __resetFaceIdForTests, askFaceId } from '@/features/lock/faceId'
import { useAutoLock } from '@/features/lock/useAutoLock'
import { __resetSecurityForTests, useSecurityStore } from '@/store/securityStore'
import { useUiStore } from '@/store/uiStore'

vi.mock('@/features/lock/biometric', () => ({
  verifyBiometric: vi.fn<(credentialId: string, signal: AbortSignal) => Promise<boolean>>(),
}))

const NOW = Date.UTC(2026, 9, 14, 8)
const MINUTE = 60_000

function Harness() {
  useAutoLock()
  return null
}

/** Unlocked with a PIN, as after the first unlock. */
function withPin(patch: Partial<SecurityConfig> = {}): void {
  useSecurityStore.setState({
    config: { ...createDefaultSecurity(), pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==', ...patch },
    status: 'ready',
    locked: false,
    unlockedOnce: true,
  })
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function awayFor(ms: number): void {
  setVisibility('hidden')
  vi.setSystemTime(Date.now() + ms)
  setVisibility('visible')
}

function locked(): boolean {
  return useSecurityStore.getState().locked
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  __resetSecurityForTests()
  render(<Harness />)
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document, 'visibilityState')
  __resetSecurityForTests()
  __resetFaceIdForTests()
  useUiStore.setState(useUiStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('useAutoLock (docs/SPEC.md §3.8)', () => {
  it('locks after the app was away for Lock after (1 minute by default)', () => {
    withPin()
    awayFor(MINUTE - 1)
    expect(locked()).toBe(false)
    awayFor(MINUTE)
    expect(locked()).toBe(true)
    expect(useSecurityStore.getState().lockEpisode).toBe(1)
  })

  it('locks the moment the app is hidden when Lock after is Immediately', () => {
    withPin({ autoLockMinutes: 0 })
    setVisibility('hidden')
    expect(locked()).toBe(true)
  })

  it('reads Lock after when the app comes back, not when it left', () => {
    withPin({ autoLockMinutes: 15 })
    setVisibility('hidden')
    vi.setSystemTime(NOW + 5 * MINUTE)
    useSecurityStore.setState({ config: { ...useSecurityStore.getState().config, autoLockMinutes: 5 } })
    setVisibility('visible')
    expect(locked()).toBe(true)
  })

  it('locks when the clock went back while the app was away', () => {
    withPin({ autoLockMinutes: 60 })
    setVisibility('hidden')
    vi.setSystemTime(NOW - MINUTE)
    setVisibility('visible')
    expect(locked()).toBe(true)
  })

  it('counts from the first of hidden and pagehide', () => {
    withPin({ autoLockMinutes: 1 })
    setVisibility('hidden')
    vi.setSystemTime(NOW + 40_000)
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    vi.setSystemTime(NOW + MINUTE)
    setVisibility('visible')
    expect(locked()).toBe(true)
  })

  it('hides revealed amounts when the app is hidden', () => {
    withPin({ autoLockMinutes: 60 })
    useUiStore.setState({ amountsRevealed: true })
    setVisibility('hidden')
    expect(useUiStore.getState().amountsRevealed).toBe(false)
  })

  it('never locks without a PIN, and never on blur', () => {
    useSecurityStore.setState({ status: 'ready', locked: false, unlockedOnce: true, config: { ...createDefaultSecurity(), autoLockMinutes: 0 } })
    awayFor(10 * MINUTE)
    expect(locked()).toBe(false)
    withPin({ autoLockMinutes: 0 })
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(locked()).toBe(false)
  })

  it('ignores the app going hidden for a system sheet it opened, unless it stays away a minute', () => {
    withPin({ autoLockMinutes: 0 })
    useUiStore.setState({ systemSheetOpen: true })
    setVisibility('hidden')
    expect(locked()).toBe(false)
    vi.setSystemTime(NOW + 30_000)
    setVisibility('visible')
    expect(locked()).toBe(false)

    vi.setSystemTime(NOW)
    awayFor(MINUTE)
    expect(locked()).toBe(true)
  })

  it('ends a Face ID request when the app is hidden', async () => {
    withPin({ biometricCredentialId: 'Y3JlZA' })
    let signal: AbortSignal | undefined
    vi.mocked(verifyBiometric).mockImplementation(
      (_id, s) =>
        new Promise((resolve) => {
          signal = s
          s.addEventListener('abort', () => resolve(false))
        }),
    )
    const answer = askFaceId('Y3JlZA')
    setVisibility('hidden')
    expect(signal?.aborted).toBe(true)
    await expect(answer).resolves.toBe(false)
  })
})
