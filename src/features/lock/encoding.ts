/**
 * Byte helpers for the app lock (docs/SPEC.md §8): the PIN hash and salt are stored as base64, the
 * Face ID credential id as base64url (the form WebAuthn's signal API takes).
 */

/** base64 of `bytes`. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** The bytes of a base64 text, or null when it is not base64. */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  let binary: string
  try {
    binary = atob(text)
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** base64url without padding (RFC 4648 §5) of `bytes`. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** The bytes of a base64url text (padding optional), or null when it is not base64url. */
export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(text)) return null
  const plain = text.replace(/=+$/, '').replaceAll('-', '+').replaceAll('_', '/')
  return base64ToBytes(plain.padEnd(Math.ceil(plain.length / 4) * 4, '='))
}

/**
 * Whether two byte strings are equal, in time that depends only on their length: every byte is
 * compared, whatever differs first, so the time taken says nothing about where they differ.
 */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return difference === 0
}
