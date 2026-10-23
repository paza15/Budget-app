import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSecurity, DEFAULT_PIN_ITERATIONS } from '@/domain/defaults'
import type { SecurityConfig } from '@/domain/types'
import { forgetBiometric, platformAuthenticatorAvailable } from '@/features/lock/biometric'
import { base64ToBytes, bytesToBase64 } from '@/features/lock/encoding'
import {
  clearFailedAttempts,
  clearPin,
  isPin,
  LOCKOUT_THRESHOLD,
  lockoutDurationMs,
  lockoutRemainingMs,
  lockSupport,
  MAX_LOCKOUT_MS,
  setPin,
  verifyPin,
} from '@/features/lock/pin'
import { KEYS, setKvBackend } from '@/store/db'
import { __resetSecurityForTests, initSecurity, useSecurityStore } from '@/store/securityStore'
import { createTestBackend, type TestBackend } from '@/store/test-helpers/backends'

vi.mock('@/features/lock/biometric', () => ({
  forgetBiometric: vi.fn<(credentialId: string) => void>(),
  platformAuthenticatorAvailable: vi.fn<() => Promise<boolean>>(async () => true),
}))

const NOW = Date.UTC(2026, 9, 14, 8)
/** Stored PINs in these tests use few iterations, so checks are quick; setPin uses the real count. */
const FAST = 1000
const SALT = new Uint8Array(16).fill(7)

async function pbkdf2(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

let backend: TestBackend

/** Stores a config whose PIN is `pin`, as setPin would (with FAST iterations), and loads it. */
async function seedPin(pin = '1234', patch: Partial<SecurityConfig> = {}): Promise<void> {
  const config: SecurityConfig = {
    ...createDefaultSecurity(),
    pinHash: bytesToBase64(await pbkdf2(pin, SALT, FAST)),
    pinSalt: bytesToBase64(SALT),
    pinIterations: FAST,
    pinLength: pin.length === 6 ? 6 : 4,
    ...patch,
  }
  await backend.inner.set(KEYS.security, config)
  await initSecurity()
}

function stored(): Promise<SecurityConfig> {
  return backend.peek(KEYS.security) as Promise<SecurityConfig>
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('isSecureContext', true)
  __resetSecurityForTests()
  backend = createTestBackend()
  setKvBackend(backend)
})

afterEach(() => {
  __resetSecurityForTests()
  setKvBackend(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('lockSupport', () => {
  it('offers the PIN in a secure context with WebCrypto, and asks the platform about Face ID', async () => {
    const support = lockSupport()
    expect(support.pin).toBe(true)
    await expect(support.biometric()).resolves.toBe(true)
    expect(platformAuthenticatorAvailable).toHaveBeenCalled()
  })

  it('offers neither outside a secure context (the LAN dev address)', async () => {
    vi.stubGlobal('isSecureContext', false)
    vi.mocked(platformAuthenticatorAvailable).mockClear()
    const support = lockSupport()
    expect(support.pin).toBe(false)
    await expect(support.biometric()).resolves.toBe(false)
    expect(platformAuthenticatorAvailable).not.toHaveBeenCalled()
  })
})

describe('lockout schedule (docs/SPEC.md §3.8)', () => {
  it.each([
    [0, 0],
    [LOCKOUT_THRESHOLD - 1, 0],
    [5, 30_000],
    [6, 60_000],
    [7, 120_000],
    [8, 240_000],
    [9, 480_000],
    [10, MAX_LOCKOUT_MS],
    [11, MAX_LOCKOUT_MS],
    [400, MAX_LOCKOUT_MS],
  ])('after %i failures blocks for %i ms', (failures, ms) => {
    expect(lockoutDurationMs(failures)).toBe(ms)
  })

  it('counts down to the end of a lockout', () => {
    expect(lockoutRemainingMs({ lockoutUntil: null }, NOW)).toBe(0)
    expect(lockoutRemainingMs({ lockoutUntil: NOW + 30_000 }, NOW)).toBe(30_000)
    expect(lockoutRemainingMs({ lockoutUntil: NOW + 30_000 }, NOW + 30_000)).toBe(0)
    expect(lockoutRemainingMs({ lockoutUntil: NOW - 1 }, NOW)).toBe(0)
  })

  it('treats a lockout ending further away than the longest one as over (the clock was set back)', () => {
    expect(lockoutRemainingMs({ lockoutUntil: NOW + MAX_LOCKOUT_MS }, NOW)).toBe(MAX_LOCKOUT_MS)
    expect(lockoutRemainingMs({ lockoutUntil: NOW + MAX_LOCKOUT_MS + 1 }, NOW)).toBe(0)
  })
})

describe('isPin', () => {
  it('accepts exactly `length` ASCII digits', () => {
    expect(isPin('1234', 4)).toBe(true)
    expect(isPin('012345', 6)).toBe(true)
    expect(isPin('123', 4)).toBe(false)
    expect(isPin('12345', 4)).toBe(false)
    expect(isPin('12a4', 4)).toBe(false)
    expect(isPin('１２３４', 4)).toBe(false)
  })
})

describe('setPin (docs/SPEC.md §8)', () => {
  it('stores a PBKDF2-SHA256 hash with a fresh 16-byte salt, 210,000 iterations and a 32-byte output', async () => {
    await initSecurity()
    await setPin('2580', 4)
    const config = await stored()
    const salt = base64ToBytes(config.pinSalt ?? '')
    const hash = base64ToBytes(config.pinHash ?? '')
    expect(salt).toHaveLength(16)
    expect(hash).toHaveLength(32)
    expect(config.pinIterations).toBe(DEFAULT_PIN_ITERATIONS)
    expect(DEFAULT_PIN_ITERATIONS).toBe(210_000)
    expect(config.pinLength).toBe(4)
    expect(hash).toEqual(await pbkdf2('2580', salt ?? new Uint8Array(), 210_000))
    // The PIN itself is never stored.
    expect(JSON.stringify(config)).not.toContain('2580')
    expect(useSecurityStore.getState().config).toEqual(config)
  })

  it('uses a new salt each time and clears failed attempts, keeping Face ID and Lock after', async () => {
    await seedPin('1234', { failedAttempts: 6, lockoutUntil: NOW + 60_000, biometricCredentialId: 'Y3JlZA', autoLockMinutes: 5 })
    const before = await stored()
    await setPin('987654', 6)
    const after = await stored()
    expect(after.pinSalt).not.toBe(before.pinSalt)
    expect(after).toMatchObject({ pinLength: 6, failedAttempts: 0, lockoutUntil: null, biometricCredentialId: 'Y3JlZA', autoLockMinutes: 5 })
  })

  it.each([
    ['too short', '123', 4],
    ['too long', '12345', 4],
    ['not digits', '12a4', 4],
    ['a length other than 4 or 6', '12345', 5],
  ])('refuses a PIN that is %s, writing nothing', async (_name, pin, length) => {
    await initSecurity()
    await expect(setPin(pin, length as 4 | 6)).rejects.toThrow(RangeError)
    expect(backend.writes()).toBe(0)
  })

  it('needs a secure context', async () => {
    vi.stubGlobal('isSecureContext', false)
    await initSecurity()
    await expect(setPin('1234', 4)).rejects.toThrow("The app lock needs the app's https:// address.")
    expect(backend.writes()).toBe(0)
  })
})

describe('verifyPin (docs/SPEC.md §8)', () => {
  it('accepts the right PIN and resets the failure count', async () => {
    await seedPin('1234', { failedAttempts: 3 })
    await expect(verifyPin('1234')).resolves.toBe('ok')
    expect(await stored()).toMatchObject({ failedAttempts: 0, lockoutUntil: null })
  })

  it('counts a wrong PIN', async () => {
    await seedPin('1234')
    await expect(verifyPin('4321')).resolves.toBe('wrong')
    expect(await stored()).toMatchObject({ failedAttempts: 1, lockoutUntil: null })
    await expect(verifyPin('12345')).resolves.toBe('wrong')
    await expect(verifyPin('12x4')).resolves.toBe('wrong')
    expect((await stored()).failedAttempts).toBe(3)
  })

  it('saves the failure count before it compares', async () => {
    await seedPin('1234', { failedAttempts: 2 })
    const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle)
    const seen: number[] = []
    const spy = vi.spyOn(crypto.subtle, 'deriveBits').mockImplementation(async (...args) => {
      seen.push((await stored()).failedAttempts)
      return deriveBits(...args)
    })
    await expect(verifyPin('1234')).resolves.toBe('ok')
    expect(seen).toEqual([3])
    spy.mockRestore()
  })

  it('locks PIN entry for 30 s at the fifth failure, doubling with each further one', async () => {
    await seedPin('1234', { failedAttempts: 4 })
    await expect(verifyPin('0000')).resolves.toBe('wrong')
    expect(await stored()).toMatchObject({ failedAttempts: 5, lockoutUntil: NOW + 30_000 })

    // During the lockout nothing is checked or counted.
    const derive = vi.spyOn(crypto.subtle, 'deriveBits')
    vi.setSystemTime(NOW + 29_000)
    await expect(verifyPin('1234')).resolves.toBe('lockedOut')
    expect(derive).not.toHaveBeenCalled()
    expect((await stored()).failedAttempts).toBe(5)
    derive.mockRestore()

    vi.setSystemTime(NOW + 30_000)
    await expect(verifyPin('0000')).resolves.toBe('wrong')
    expect(await stored()).toMatchObject({ failedAttempts: 6, lockoutUntil: NOW + 30_000 + 60_000 })
  })

  it('accepts the right PIN on the attempt that would have locked, and clears the lockout', async () => {
    await seedPin('1234', { failedAttempts: 4 })
    await expect(verifyPin('1234')).resolves.toBe('ok')
    expect(await stored()).toMatchObject({ failedAttempts: 0, lockoutUntil: null })
  })

  it('checks again once a lockout set before the clock went back counts as over', async () => {
    await seedPin('1234', { failedAttempts: 5, lockoutUntil: NOW + 24 * 3600_000 })
    await expect(verifyPin('0000')).resolves.toBe('wrong')
    expect(await stored()).toMatchObject({ failedAttempts: 6, lockoutUntil: NOW + 60_000 })
  })

  it('fails closed: when the count cannot be saved it rejects without comparing', async () => {
    await seedPin('1234')
    backend.fail('update')
    const derive = vi.spyOn(crypto.subtle, 'deriveBits')
    await expect(verifyPin('1234')).rejects.toBeInstanceOf(Error)
    expect(derive).not.toHaveBeenCalled()
    derive.mockRestore()
  })

  it('still answers ok when only clearing the count afterwards fails', async () => {
    await seedPin('1234', { failedAttempts: 1 })
    const update = backend.update.bind(backend)
    backend.update = async (key, change) => {
      const next = change(await backend.inner.get(key)) as SecurityConfig
      if (next.failedAttempts === 0) throw new Error('Disk full')
      return update(key, () => next)
    }
    await expect(verifyPin('1234')).resolves.toBe('ok')
    expect((await stored()).failedAttempts).toBe(2)
  })

  it('counts two checks started together as two failures', async () => {
    await seedPin('1234')
    await expect(Promise.all([verifyPin('0000'), verifyPin('1111')])).resolves.toEqual(['wrong', 'wrong'])
    expect((await stored()).failedAttempts).toBe(2)
  })

  it('rejects when there is no PIN, or the lock settings could not be read', async () => {
    await initSecurity()
    await expect(verifyPin('1234')).rejects.toThrow('No PIN is set.')
    __resetSecurityForTests()
    backend.failAlways('get')
    await initSecurity()
    await expect(verifyPin('1234')).rejects.toThrow("The app lock settings couldn't be read.")
    expect(backend.writes()).toBe(0)
  })
})

describe('clearPin', () => {
  it('turns the lock off with Face ID, keeps Lock after, and tells Passwords the passkey is gone', async () => {
    await seedPin('1234', { biometricCredentialId: 'Y3JlZA', failedAttempts: 2, autoLockMinutes: 15 })
    await clearPin()
    expect(await stored()).toMatchObject({
      pinHash: null,
      pinSalt: null,
      biometricCredentialId: null,
      failedAttempts: 0,
      lockoutUntil: null,
      autoLockMinutes: 15,
    })
    expect(forgetBiometric).toHaveBeenCalledWith('Y3JlZA')
  })

  it('forgets no passkey when Face ID was off', async () => {
    vi.mocked(forgetBiometric).mockClear()
    await seedPin('1234')
    await clearPin()
    expect(forgetBiometric).not.toHaveBeenCalled()
  })
})

describe('clearFailedAttempts', () => {
  it('clears failures and a lockout after Face ID, and writes nothing when there are none', async () => {
    await seedPin('1234', { failedAttempts: 5, lockoutUntil: NOW + 30_000 })
    await clearFailedAttempts()
    expect(await stored()).toMatchObject({ failedAttempts: 0, lockoutUntil: null })
    const writes = backend.writes()
    await clearFailedAttempts()
    expect(backend.writes()).toBe(writes)
  })
})
