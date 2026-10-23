import { create } from 'zustand'
import { createDefaultSecurity } from '@/domain/defaults'
import { isRecord, ownValue } from '@/domain/normalize'
import type { SecurityConfig } from '@/domain/types'
import { getKv, KEYS } from '@/store/db'
import { useUiStore } from '@/store/uiStore'

/**
 * App lock state (docs/SPEC.md §3.8, §5.4, §8). The config is stored under its own IndexedDB key
 * and is never part of backups. Until it has loaded the app counts as locked, so nothing renders
 * early, and anything that cannot be read keeps it locked (fail closed).
 */

export interface SecurityState {
  config: SecurityConfig
  /** error: the config could not be read; the app stays locked (fail closed). */
  status: 'loading' | 'ready' | 'error'
  locked: boolean
  /** Increases with every lock, so one-shot work (automatic Face ID) runs once per episode. */
  lockEpisode: number
  /** The app has been unlocked at least once since launch, so its content may stay mounted. */
  unlockedOnce: boolean
}

/** Before load: the default config (createDefaultSecurity), status 'loading', locked. */
export const useSecurityStore = create<SecurityState>()(() => ({
  config: createDefaultSecurity(),
  status: 'loading',
  locked: true,
  lockEpisode: 0,
  unlockedOnce: false,
}))

/** initSecurity's promise: the config is read once per launch. */
let loading: Promise<void> | null = null

// ---------------------------------------------------------------------------------------------
// Reading and validating the stored config

type Field = keyof SecurityConfig

const FIELDS: readonly Field[] = [
  'pinHash',
  'pinSalt',
  'pinIterations',
  'pinLength',
  'biometricCredentialId',
  'autoLockMinutes',
  'failedAttempts',
  'lockoutUntil',
]

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** Field validators: what each field may hold. */
const VALID: { readonly [K in Field]: (value: unknown) => value is SecurityConfig[K] } = {
  pinHash: (value): value is string | null => value === null || isNonEmptyString(value),
  pinSalt: (value): value is string | null => value === null || isNonEmptyString(value),
  pinIterations: (value): value is number => Number.isSafeInteger(value) && (value as number) > 0,
  pinLength: (value): value is 4 | 6 => value === 4 || value === 6,
  biometricCredentialId: (value): value is string | null => value === null || isNonEmptyString(value),
  autoLockMinutes: (value): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0,
  failedAttempts: (value): value is number => Number.isSafeInteger(value) && (value as number) >= 0,
  lockoutUntil: (value): value is number | null =>
    value === null || (typeof value === 'number' && Number.isFinite(value)),
}

/** The value of `field` in `record` when valid, else its default. */
function fieldOr<K extends Field>(record: Record<string, unknown>, field: K, fallback: SecurityConfig[K]): SecurityConfig[K] {
  const value = ownValue(record, field)
  return VALID[field](value) ? value : fallback
}

/**
 * The stored config, rebuilt field by field, or null when it cannot be trusted: not an object, or
 * a PIN whose hash, salt, iterations or length is unusable (then nobody could unlock with it, and
 * treating it as "no PIN" would open the app). Fields that only tune the lock fall back to their
 * defaults.
 */
export function readSecurityConfig(value: unknown): SecurityConfig | null {
  if (!isRecord(value)) return null
  const defaults = createDefaultSecurity()
  const pinHash = ownValue(value, 'pinHash')
  if (!VALID.pinHash(pinHash)) return null

  const pin = {
    pinHash,
    pinSalt: defaults.pinSalt,
    pinIterations: fieldOr(value, 'pinIterations', defaults.pinIterations),
    pinLength: fieldOr(value, 'pinLength', defaults.pinLength),
  }
  if (pinHash !== null) {
    const pinSalt = ownValue(value, 'pinSalt')
    const pinIterations = ownValue(value, 'pinIterations')
    const pinLength = ownValue(value, 'pinLength')
    if (!isNonEmptyString(pinSalt) || !VALID.pinIterations(pinIterations) || !VALID.pinLength(pinLength)) {
      return null
    }
    pin.pinSalt = pinSalt
  }

  return {
    ...pin,
    biometricCredentialId: fieldOr(value, 'biometricCredentialId', defaults.biometricCredentialId),
    autoLockMinutes: fieldOr(value, 'autoLockMinutes', defaults.autoLockMinutes),
    failedAttempts: fieldOr(value, 'failedAttempts', defaults.failedAttempts),
    lockoutUntil: fieldOr(value, 'lockoutUntil', defaults.lockoutUntil),
  }
}

/**
 * `base` with `patch` applied. Throws a RangeError for an unknown field, an invalid value, or a
 * result whose PIN could never be verified (a hash without its salt).
 */
function mergeSecurity(base: SecurityConfig, patch: Partial<SecurityConfig>): SecurityConfig {
  const next: SecurityConfig = { ...base }
  for (const key of Object.keys(patch)) {
    if (!(FIELDS as readonly string[]).includes(key)) throw new RangeError(`Not a security setting: ${key}`)
    const field = key as Field
    const value: unknown = patch[field]
    if (!VALID[field](value)) throw new RangeError(`Invalid ${field}: ${String(value)}`)
    Object.assign(next, { [field]: value })
  }
  if (readSecurityConfig(next) === null) throw new RangeError('A PIN needs its salt, iterations and length.')
  return next
}

// ---------------------------------------------------------------------------------------------
// Loading and saving

/** Loaded: locked exactly when a PIN is set. A launch without a PIN counts as unlocked. */
function applyLoaded(config: SecurityConfig): void {
  const locked = config.pinHash !== null
  useSecurityStore.setState({ config, status: 'ready', locked, unlockedOnce: !locked })
}

/** Unreadable: stay locked with the defaults, and never write (fail closed). */
function failClosed(): void {
  useSecurityStore.setState({ config: createDefaultSecurity(), status: 'error', locked: true })
}

async function load(): Promise<void> {
  let stored: unknown
  try {
    stored = await getKv().get(KEYS.security)
  } catch {
    failClosed()
    return
  }
  if (stored === undefined) {
    applyLoaded(createDefaultSecurity())
    return
  }
  const config = readSecurityConfig(stored)
  if (config === null) failClosed()
  else applyLoaded(config)
}

/**
 * Loads the config. Idempotent: every call returns the first call's promise, which never rejects.
 * No stored value → defaults, unlocked; a read error or a config that cannot be trusted → status
 * 'error', locked.
 */
export function initSecurity(): Promise<void> {
  loading ??= load()
  return loading
}

/**
 * Merges a patch into the stored config in one transaction (KvBackend.update), then into the
 * store. The merge starts from the stored value, so it never undoes a change made elsewhere since
 * loading. Rejects without writing when the config could not be read (status 'error'), when the
 * patch is invalid (RangeError), or when the write fails; the store then keeps its config.
 */
export async function updateSecurity(patch: Partial<SecurityConfig>): Promise<void> {
  await initSecurity()
  if (useSecurityStore.getState().status !== 'ready') {
    throw new Error("The app lock settings couldn't be read, so they can't be changed.")
  }
  // Check the patch before touching storage; the merge in the transaction checks it again.
  mergeSecurity(useSecurityStore.getState().config, patch)

  // The merged value is captured here because update() resolves without it.
  const written: { config: SecurityConfig | null } = { config: null }
  await getKv().update(KEYS.security, (old) => {
    const base =
      old === undefined ? createDefaultSecurity() : (readSecurityConfig(old) ?? useSecurityStore.getState().config)
    written.config = mergeSecurity(base, patch)
    return written.config
  })
  if (written.config !== null) useSecurityStore.setState({ config: written.config })
}

/**
 * After eraseEverything has deleted the stored config: the defaults, unlocked. Not for features;
 * they change the config with updateSecurity.
 */
export function resetSecurity(): void {
  useSecurityStore.setState({ config: createDefaultSecurity(), status: 'ready', locked: false, unlockedOnce: true })
}

// ---------------------------------------------------------------------------------------------
// Locking

/** A PIN is set, so the app locks. */
export function hasPin(): boolean {
  return useSecurityStore.getState().config.pinHash !== null
}

/**
 * locked true, lockEpisode + 1, amounts hidden again. Without a PIN there would be no way to
 * unlock, so then it only hides the amounts.
 */
export function lockApp(): void {
  useUiStore.setState({ amountsRevealed: false })
  if (!hasPin()) return
  const { lockEpisode } = useSecurityStore.getState()
  useSecurityStore.setState({ locked: true, lockEpisode: lockEpisode + 1 })
}

/**
 * locked false, unlockedOnce true. Call it only after the PIN or Face ID was verified. Ignored
 * until the config has loaded, and when it could not be read (fail closed).
 */
export function unlockApp(): void {
  if (useSecurityStore.getState().status !== 'ready') return
  useSecurityStore.setState({ locked: false, unlockedOnce: true })
}

/** Resets module state between tests. */
export function __resetSecurityForTests(): void {
  loading = null
  useSecurityStore.setState(useSecurityStore.getInitialState(), true)
}
