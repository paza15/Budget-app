import { describe, expect, it } from 'vitest'
import { base64ToBytes, base64UrlToBytes, bytesToBase64, bytesToBase64Url, equalBytes } from '@/features/lock/encoding'

const ALL_BYTES = Uint8Array.from({ length: 256 }, (_, i) => i)

describe('base64', () => {
  it('round-trips every byte value', () => {
    expect(base64ToBytes(bytesToBase64(ALL_BYTES))).toEqual(ALL_BYTES)
  })

  it('matches the standard alphabet with padding', () => {
    expect(bytesToBase64(new TextEncoder().encode('hash'))).toBe('aGFzaA==')
    expect(bytesToBase64(new Uint8Array([251, 255]))).toBe('+/8=')
    expect(bytesToBase64(new Uint8Array())).toBe('')
  })

  it('reads null for text that is not base64', () => {
    expect(base64ToBytes('not base64!')).toBeNull()
    expect(base64ToBytes('a')).toBeNull()
  })
})

describe('base64url', () => {
  it('uses - and _ and drops the padding', () => {
    expect(bytesToBase64Url(new Uint8Array([251, 255]))).toBe('-_8')
    expect(bytesToBase64Url(new TextEncoder().encode('cred'))).toBe('Y3JlZA')
  })

  it('round-trips every byte value, with or without padding', () => {
    const text = bytesToBase64Url(ALL_BYTES)
    expect(text).not.toMatch(/[+/=]/)
    expect(base64UrlToBytes(text)).toEqual(ALL_BYTES)
    expect(base64UrlToBytes('Y3JlZA==')).toEqual(new TextEncoder().encode('cred'))
  })

  it('reads null for the standard alphabet or other text', () => {
    expect(base64UrlToBytes('+/8=')).toBeNull()
    expect(base64UrlToBytes('Y3J lZA')).toBeNull()
  })
})

describe('equalBytes', () => {
  it('compares length and every byte', () => {
    expect(equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true)
    expect(equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false)
    expect(equalBytes(new Uint8Array([9, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(false)
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false)
    expect(equalBytes(new Uint8Array(), new Uint8Array())).toBe(true)
  })
})
