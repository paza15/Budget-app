import { DEFAULT_PIN_ITERATIONS } from '@/domain/defaults'
import type { SecurityConfig } from '@/domain/types'
import { forgetBiometric, platformAuthenticatorAvailable } from '@/features/lock/biometric'
import { base64ToBytes, bytesToBase64, equalBytes } from '@/features/lock/encoding'
import { initSecurity, updateSecurity, useSecurityStore } from '@/store/securityStore'

/**
 * The app lock's PIN (docs/SPEC.md §3.8, §8): a PBKDF2-SHA256 hash through WebCrypto with a fresh
 * 16-byte salt, 210,000 iterations and a 32-byte output. The PIN itself is never stored, logged
 * or kept: the bytes fed to WebCrypto are zeroed once hashed. The lock is a privacy gate, not
 * encryption.
 */

/** What the app lock can use here (docs/SPEC.md §3.8, §8). */
export interface LockSupport {
  /** PIN hashing needs WebCrypto, which needs a secure context (https). */
  pin: boolean
  /** Resolves true when a platform authenticator (Face ID, Touch ID) is available. */
  biometric: () => Promise<boolean>
}

export type VerifyPinResult = 'ok' | 'wrong' | 'lockedOut'

/** Failed PINs in a row before PIN entry is blocked (§3.8). */
export const LOCKOUT_THRESHOLD = 5
/** The first lockout; it doubles with each further failure. */
const FIRST_LOCKOUT_MS = 30_000
/** The longest lockout. */
export const MAX_LOCKOUT_MS = 15 * 60_000

const SALT_BYTES = 16
const HASH_BITS = 256

/** WebCrypto's PBKDF2 is there: a secure context with crypto.subtle. */
function canHash(): boolean {
  return globalThis.isSecureContext === true && typeof globalThis.crypto?.subtle?.deriveBits === 'function'
}

export function lockSupport(): LockSupport {
  const pin = canHash()
  return { pin, biometric: () => (pin ? platformAuthenticatorAvailable() : Promise.resolve(false)) }
}

/**
 * How long PIN entry is blocked after `failedAttempts` failures in a row: nothing below 5, then 30
 * seconds, doubling with each further failure, at most 15 minutes (§3.8).
 */
export function lockoutDurationMs(failedAttempts: number): number {
  if (failedAttempts < LOCKOUT_THRESHOLD) return 0
  return Math.min(FIRST_LOCKOUT_MS * 2 ** (failedAttempts - LOCKOUT_THRESHOLD), MAX_LOCKOUT_MS)
}

/**
 * How long PIN entry stays blocked at `now`, in ms; 0 when it is not. A lockout that would end
 * further away than the longest one means the clock was set back since: it counts as over, so a
 * changed clock never shuts the owner out for longer than the schedule allows.
 */
export function lockoutRemainingMs(config: Pick<SecurityConfig, 'lockoutUntil'>, now: number): number {
  if (config.lockoutUntil === null) return 0
  const remaining = config.lockoutUntil - now
  return remaining > 0 && remaining <= MAX_LOCKOUT_MS ? remaining : 0
}

/** `pin` is all digits, `length` of them. */
export function isPin(pin: string, length: number): boolean {
  return pin.length === length && /^[0-9]+$/.test(pin)
}

/** PBKDF2-SHA256 of the PIN's UTF-8 bytes; the bytes are zeroed afterwards. */
async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const secret = new TextEncoder().encode(pin)
  try {
    const key = await crypto.subtle.importKey('raw', secret, 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, HASH_BITS)
    return new Uint8Array(bits)
  } finally {
    secret.fill(0)
  }
}

/**
 * setPin, verifyPin and clearPin run one at a time, in call order: two checks started together
 * (a double tap) must each count their failure, and none may read a config the other is changing.
 */
let queue: Promise<unknown> = Promise.resolve()

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

function requireHashing(): void {
  if (!canHash()) throw new Error("The app lock needs the app's https:// address.")
}

/**
 * Stores a PBKDF2-SHA256 hash of a new PIN with a fresh salt (docs/SPEC.md §8) and clears any
 * failed attempts. Replaces the current PIN; Face ID stays as it is. Throws a RangeError for
 * anything but `length` digits.
 */
export function setPin(pin: string, length: 4 | 6): Promise<void> {
  if (length !== 4 && length !== 6) return Promise.reject(new RangeError('A PIN has 4 or 6 digits.'))
  if (!isPin(pin, length)) return Promise.reject(new RangeError(`A PIN is ${length} digits.`))
  return serialized(async () => {
    requireHashing()
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
    const hash = await derive(pin, salt, DEFAULT_PIN_ITERATIONS)
    try {
      await updateSecurity({
        pinHash: bytesToBase64(hash),
        pinSalt: bytesToBase64(salt),
        pinIterations: DEFAULT_PIN_ITERATIONS,
        pinLength: length,
        failedAttempts: 0,
        lockoutUntil: null,
      })
    } finally {
      hash.fill(0)
    }
  })
}

/**
 * Checks a PIN against the stored hash (docs/SPEC.md §8). During a lockout it answers 'lockedOut'
 * without checking or counting. Otherwise it first saves the failure count plus one (and the
 * lockout this attempt would start), so quitting the app mid-check never wins a free guess; only
 * then it compares, in constant time, and a match resets both. Rejects, without comparing, when
 * that count cannot be saved or there is no PIN to check.
 */
export function verifyPin(pin: string): Promise<VerifyPinResult> {
  return serialized(async () => {
    await initSecurity()
    const { status, config } = useSecurityStore.getState()
    if (status !== 'ready') throw new Error("The app lock settings couldn't be read.")
    if (config.pinHash === null || config.pinSalt === null) throw new Error('No PIN is set.')
    requireHashing()
    const expected = base64ToBytes(config.pinHash)
    const salt = base64ToBytes(config.pinSalt)
    if (expected === null || salt === null) throw new Error('The stored PIN cannot be read.')

    const now = Date.now()
    if (lockoutRemainingMs(config, now) > 0) return 'lockedOut'
    const failedAttempts = config.failedAttempts + 1
    const lockout = lockoutDurationMs(failedAttempts)
    await updateSecurity({ failedAttempts, lockoutUntil: lockout > 0 ? now + lockout : null })

    // Anything but digits never matches; it still counted above.
    const actual = /^[0-9]+$/.test(pin) ? await derive(pin, salt, config.pinIterations) : null
    const match = actual !== null && equalBytes(actual, expected)
    actual?.fill(0)
    if (!match) return 'wrong'
    // The PIN was right even if clearing the count fails; the next success clears it.
    await updateSecurity({ failedAttempts: 0, lockoutUntil: null }).catch(() => {})
    return 'ok'
  })
}

/**
 * Removes the PIN, which turns the app lock off, and Face ID with it (a passkey without a lock
 * opens nothing), telling the platform the passkey is gone. Lock after stays as chosen.
 */
export function clearPin(): Promise<void> {
  return serialized(async () => {
    const credentialId = useSecurityStore.getState().config.biometricCredentialId
    await updateSecurity({
      pinHash: null,
      pinSalt: null,
      biometricCredentialId: null,
      failedAttempts: 0,
      lockoutUntil: null,
    })
    if (credentialId !== null) forgetBiometric(credentialId)
  })
}

/**
 * After Face ID opened the app: the owner is confirmed, so failed PIN attempts start over. Best
 * effort; a failed write only keeps the old count.
 */
export function clearFailedAttempts(): Promise<void> {
  return serialized(async () => {
    const { status, config } = useSecurityStore.getState()
    if (status !== 'ready' || (config.failedAttempts === 0 && config.lockoutUntil === null)) return
    await updateSecurity({ failedAttempts: 0, lockoutUntil: null }).catch(() => {})
  })
}
