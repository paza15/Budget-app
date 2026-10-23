import { afterEach, describe, expect, it, vi } from 'vitest'
import { ID_PATTERN, newId } from '@/domain/ids'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * Replaces crypto with one that only has getRandomValues, as on the LAN dev server (randomUUID
 * needs a secure context). With `fill`, every random byte is that value.
 */
function stubInsecureCrypto(fill?: number): void {
  const real = globalThis.crypto
  const insecure: Pick<Crypto, 'getRandomValues'> = {
    getRandomValues(array) {
      if (fill === undefined) return real.getRandomValues(array)
      new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(fill)
      return array
    },
  }
  vi.stubGlobal('crypto', insecure)
}

describe('ID_PATTERN', () => {
  it.each(['a', 'Z', '0', 'cat-rent', 'A_b-1', 'a'.repeat(64), '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'])(
    'accepts %s',
    (id) => {
      expect(ID_PATTERN.test(id)).toBe(true)
    },
  )

  it.each(['', '-a', '_a', '__none__', 'a'.repeat(65), 'a b', 'a.b', 'ä', 'a/b', 'a\n'])('rejects %j', (id) => {
    expect(ID_PATTERN.test(id)).toBe(false)
  })
})

describe('newId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns a UUID that matches ID_PATTERN', () => {
    const id = newId()
    expect(id).toMatch(ID_PATTERN)
    expect(id).toMatch(UUID_V4)
  })

  it('never repeats', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId()))
    expect(ids.size).toBe(2000)
  })

  describe('without crypto.randomUUID (pages outside a secure context)', () => {
    it('builds a version 4 UUID from getRandomValues', () => {
      stubInsecureCrypto()
      expect(crypto.randomUUID).toBeUndefined()
      const ids = Array.from({ length: 500 }, () => newId())
      for (const id of ids) {
        expect(id).toMatch(UUID_V4)
        expect(id).toMatch(ID_PATTERN)
      }
      expect(new Set(ids).size).toBe(500)
    })

    it('sets the version and variant bits whatever the random bytes are', () => {
      stubInsecureCrypto(0x00)
      expect(newId()).toBe('00000000-0000-4000-8000-000000000000')
      stubInsecureCrypto(0xff)
      expect(newId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    })
  })
})
