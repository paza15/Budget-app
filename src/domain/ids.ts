/** Record ids (docs/SPEC.md §4.7, §5.3). */

/** A valid record id. Data loaded from storage or a backup is repaired to match it. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

/**
 * A version 4 UUID from crypto.getRandomValues, for pages without crypto.randomUUID: browsers
 * offer it only in secure contexts, so the LAN dev server lacks it.
 */
function uuidFromRandomValues(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = Array.from(bytes, (byte, i) => {
    // Byte 6 carries the version (0100), byte 8 the RFC 9562 variant (10xx).
    const value = i === 6 ? (byte & 0x0f) | 0x40 : i === 8 ? (byte & 0x3f) | 0x80 : byte
    return value.toString(16).padStart(2, '0')
  }).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** A new unique id: crypto.randomUUID(), else built from crypto.getRandomValues. Matches ID_PATTERN. */
export function newId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : uuidFromRandomValues()
}
