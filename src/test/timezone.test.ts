import { describe, expect, it } from 'vitest'

describe('test environment', () => {
  it('runs in Europe/Berlin so DST tests are meaningful', () => {
    // 29 March 2026 is the first day of summer time in Germany (UTC+2).
    expect(new Date(2026, 2, 29, 12).getTimezoneOffset()).toBe(-120)
    expect(new Date(2026, 0, 15, 12).getTimezoneOffset()).toBe(-60)
  })
})
