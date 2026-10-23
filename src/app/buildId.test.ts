import { describe, expect, it } from 'vitest'

// vite.config.ts defines __BUILD_ID__ for Diagnostics; Vitest runs with the same defines.

describe('__BUILD_ID__', () => {
  it('is a short commit id or the UTC minute the build ran', () => {
    expect(typeof __BUILD_ID__).toBe('string')
    expect(__BUILD_ID__).toMatch(/^(?:[0-9a-f]{7}|\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/)
  })
})
