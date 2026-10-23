import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultSecurity } from '@/domain/defaults'
import type { SecurityConfig } from '@/domain/types'
import { KEYS, setKvBackend } from '@/store/db'
import {
  __resetSecurityForTests,
  hasPin,
  initSecurity,
  lockApp,
  readSecurityConfig,
  resetSecurity,
  unlockApp,
  updateSecurity,
  useSecurityStore,
} from '@/store/securityStore'
import { createTestBackend, type TestBackend } from '@/store/test-helpers/backends'
import { useUiStore } from '@/store/uiStore'

/** A config with a PIN, as setPin stores it. */
const WITH_PIN: SecurityConfig = {
  ...createDefaultSecurity(),
  pinHash: 'aGFzaA==',
  pinSalt: 'c2FsdA==',
  pinLength: 6,
  biometricCredentialId: 'Y3JlZA',
  autoLockMinutes: 5,
}

let backend: TestBackend

beforeEach(() => {
  __resetSecurityForTests()
  backend = createTestBackend()
  setKvBackend(backend)
})

afterEach(() => {
  __resetSecurityForTests()
  useUiStore.setState(useUiStore.getInitialState(), true)
  setKvBackend(null)
})

describe('before loading', () => {
  it('counts as locked with the default config', () => {
    expect(useSecurityStore.getState()).toEqual({
      config: createDefaultSecurity(),
      status: 'loading',
      locked: true,
      lockEpisode: 0,
      unlockedOnce: false,
    })
    expect(hasPin()).toBe(false)
  })

  it('ignores unlockApp until the config has loaded', () => {
    unlockApp()
    expect(useSecurityStore.getState().locked).toBe(true)
  })
})

describe('initSecurity', () => {
  it('starts unlocked with the defaults when nothing is stored', async () => {
    await initSecurity()
    expect(useSecurityStore.getState()).toMatchObject({
      config: createDefaultSecurity(),
      status: 'ready',
      locked: false,
      unlockedOnce: true,
    })
    expect(backend.writes()).toBe(0)
  })

  it('starts locked when a PIN is set', async () => {
    await backend.inner.set(KEYS.security, WITH_PIN)
    await initSecurity()
    expect(useSecurityStore.getState()).toMatchObject({ config: WITH_PIN, status: 'ready', locked: true, unlockedOnce: false })
    expect(hasPin()).toBe(true)
  })

  it('fails closed when the config cannot be read', async () => {
    backend.failAlways('get')
    await initSecurity()
    expect(useSecurityStore.getState()).toMatchObject({ status: 'error', locked: true, unlockedOnce: false })
    unlockApp()
    expect(useSecurityStore.getState().locked).toBe(true)
  })

  it.each<[string, unknown]>([
    ['not an object', 'pin'],
    ['a PIN hash that is not text', { ...WITH_PIN, pinHash: 42 }],
    ['a PIN without its salt', { ...WITH_PIN, pinSalt: null }],
    ['a PIN without iterations', { ...WITH_PIN, pinIterations: 0 }],
    ['a PIN of another length', { ...WITH_PIN, pinLength: 5 }],
  ])('fails closed on a stored config with %s', async (_name, stored) => {
    await backend.inner.set(KEYS.security, stored)
    await initSecurity()
    expect(useSecurityStore.getState()).toMatchObject({ status: 'error', locked: true })
  })

  it('falls back to defaults for settings that only tune the lock', async () => {
    await backend.inner.set(KEYS.security, {
      ...WITH_PIN,
      autoLockMinutes: 'soon',
      failedAttempts: -1,
      lockoutUntil: 'later',
      biometricCredentialId: 7,
      extra: 'ignored',
    })
    await initSecurity()
    const defaults = createDefaultSecurity()
    expect(useSecurityStore.getState()).toMatchObject({
      status: 'ready',
      locked: true,
      config: {
        ...WITH_PIN,
        autoLockMinutes: defaults.autoLockMinutes,
        failedAttempts: 0,
        lockoutUntil: null,
        biometricCredentialId: null,
      },
    })
  })

  it('is idempotent', async () => {
    const first = initSecurity()
    expect(initSecurity()).toBe(first)
    await first
    expect(backend.count('get')).toBe(1)
  })
})

describe('readSecurityConfig', () => {
  it('reads a stored config field by field', () => {
    expect(readSecurityConfig({ ...WITH_PIN })).toEqual(WITH_PIN)
    expect(readSecurityConfig(createDefaultSecurity())).toEqual(createDefaultSecurity())
  })

  it('drops a salt without a PIN', () => {
    expect(readSecurityConfig({ ...createDefaultSecurity(), pinSalt: 'c2FsdA==' })?.pinSalt).toBeNull()
  })

  it('reads inherited fields as missing, and a config without its own PIN field cannot be trusted', () => {
    const inherited = Object.create({ pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==' }) as Record<string, unknown>
    expect(readSecurityConfig(inherited)).toBeNull()
    expect(readSecurityConfig({})).toBeNull()
    expect(readSecurityConfig(Object.assign(inherited, { pinHash: null }))).toEqual(createDefaultSecurity())
  })
})

describe('updateSecurity', () => {
  it('merges into the stored config in one update and into the store', async () => {
    await initSecurity()
    await updateSecurity({ autoLockMinutes: 15 })
    expect(backend.count('update')).toBe(1)
    expect(backend.count('set')).toBe(0)
    expect(await backend.peek(KEYS.security)).toEqual({ ...createDefaultSecurity(), autoLockMinutes: 15 })
    expect(useSecurityStore.getState().config.autoLockMinutes).toBe(15)
  })

  it('starts from the stored value, so it keeps changes made since loading', async () => {
    await backend.inner.set(KEYS.security, WITH_PIN)
    await initSecurity()
    await backend.inner.set(KEYS.security, { ...WITH_PIN, failedAttempts: 3 })
    await updateSecurity({ autoLockMinutes: 0 })
    expect(await backend.peek(KEYS.security)).toEqual({ ...WITH_PIN, failedAttempts: 3, autoLockMinutes: 0 })
    expect(useSecurityStore.getState().config.failedAttempts).toBe(3)
  })

  it('sets and clears a PIN', async () => {
    await initSecurity()
    await updateSecurity({ pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==', pinLength: 4 })
    expect(hasPin()).toBe(true)
    await updateSecurity({ pinHash: null, pinSalt: null, biometricCredentialId: null })
    expect(hasPin()).toBe(false)
  })

  it('loads the config first when called early', async () => {
    await backend.inner.set(KEYS.security, WITH_PIN)
    await updateSecurity({ failedAttempts: 1 })
    expect(useSecurityStore.getState()).toMatchObject({ status: 'ready', config: { ...WITH_PIN, failedAttempts: 1 } })
  })

  it('never writes after a read error', async () => {
    backend.failAlways('get')
    await initSecurity()
    await expect(updateSecurity({ autoLockMinutes: 5 })).rejects.toThrow("The app lock settings couldn't be read, so they can't be changed.")
    expect(backend.writes()).toBe(0)
  })

  it.each<[string, Partial<SecurityConfig>]>([
    ['an unknown field', { pin: '1234' } as never],
    ['a PIN length of 5', { pinLength: 5 as never }],
    ['negative failed attempts', { failedAttempts: -1 }],
    ['a PIN hash without a salt', { pinHash: 'aGFzaA==' }],
    ['an empty credential id', { biometricCredentialId: '' }],
  ])('rejects %s without writing', async (_name, patch) => {
    await initSecurity()
    await expect(updateSecurity(patch)).rejects.toBeInstanceOf(RangeError)
    expect(backend.writes()).toBe(0)
  })

  it('keeps the store as it was when the write fails', async () => {
    await initSecurity()
    backend.fail('update')
    await expect(updateSecurity({ autoLockMinutes: 60 })).rejects.toThrow('update failed')
    expect(useSecurityStore.getState().config).toEqual(createDefaultSecurity())
  })
})

describe('locking', () => {
  beforeEach(async () => {
    await backend.inner.set(KEYS.security, WITH_PIN)
    await initSecurity()
    unlockApp()
  })

  it('locks with a new episode and hides revealed amounts', () => {
    useUiStore.getState().setAmountsRevealed(true)
    lockApp()
    expect(useSecurityStore.getState()).toMatchObject({ locked: true, lockEpisode: 1, unlockedOnce: true })
    expect(useUiStore.getState().amountsRevealed).toBe(false)
    lockApp()
    expect(useSecurityStore.getState().lockEpisode).toBe(2)
  })

  it('unlocks and remembers that it was unlocked', () => {
    lockApp()
    unlockApp()
    expect(useSecurityStore.getState()).toMatchObject({ locked: false, unlockedOnce: true })
  })

  it('only hides amounts when there is no PIN to unlock with', async () => {
    await updateSecurity({ pinHash: null, pinSalt: null })
    useUiStore.getState().setAmountsRevealed(true)
    lockApp()
    expect(useSecurityStore.getState()).toMatchObject({ locked: false, lockEpisode: 0 })
    expect(useUiStore.getState().amountsRevealed).toBe(false)
  })
})

describe('resetSecurity', () => {
  it('returns to the defaults, unlocked, after an erase', async () => {
    backend.failAlways('get')
    await initSecurity()
    resetSecurity()
    expect(useSecurityStore.getState()).toMatchObject({
      config: createDefaultSecurity(),
      status: 'ready',
      locked: false,
      unlockedOnce: true,
    })
    backend.heal()
    await updateSecurity({ autoLockMinutes: 5 })
    expect(backend.count('update')).toBe(1)
  })
})
