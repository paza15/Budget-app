import { createDefaultSecurity } from '@/domain/defaults'
import type { SecurityConfig } from '@/domain/types'
import { bytesToBase64 } from '@/features/lock/encoding'

/**
 * Test helpers for the lock feature. A stored PIN made here uses few PBKDF2 iterations, so checking
 * it is quick; verifyPin reads the iterations from the config like any other.
 */

export const FAST_ITERATIONS = 1000

/** A security config whose PIN is `pin`, as setPin stores it (with FAST_ITERATIONS). */
export async function pinConfig(pin: string, patch: Partial<SecurityConfig> = {}): Promise<SecurityConfig> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: FAST_ITERATIONS },
    key,
    256,
  )
  return {
    ...createDefaultSecurity(),
    pinHash: bytesToBase64(new Uint8Array(bits)),
    pinSalt: bytesToBase64(salt),
    pinIterations: FAST_ITERATIONS,
    pinLength: pin.length === 6 ? 6 : 4,
    ...patch,
  }
}
