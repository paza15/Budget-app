import { describe, expect, it } from 'vitest'
import {
  APP_ID,
  APP_NAME,
  BEFORE_APP_NOTE,
  LS_KEYS,
  LS_PREFIX,
  MAX_CENTS,
  MAX_LENGTHS,
  MAX_MONTH_START_DAY,
  MAX_QUICK_ADDS,
} from '@/domain/constants'
import { createDefaultQuickAdds } from '@/domain/defaults'

describe('constants', () => {
  it('names the app as §5.3 does', () => {
    expect(APP_NAME).toBe('On a Budget')
    expect(APP_ID).toBe('on-a-budget')
    expect(BEFORE_APP_NOTE).toBe(`Before ${APP_NAME}`)
  })

  it('caps amounts at 8 integer digits, exactly representable', () => {
    expect(MAX_CENTS).toBe(9_999_999_999)
    expect(String(Math.floor(MAX_CENTS / 100))).toHaveLength(8)
    expect(Number.isSafeInteger(MAX_CENTS * 1000)).toBe(true)
  })

  it('limits text lengths as §4.7 does', () => {
    expect(MAX_LENGTHS).toEqual({ name: 24, category: 24, quickAdd: 16, recurring: 40, note: 80 })
  })

  it('lets periods start on any day every month has', () => {
    expect(MAX_MONTH_START_DAY).toBe(28)
  })

  it('allows 8 quick add buttons as §3.7 does, room for more than the defaults', () => {
    expect(MAX_QUICK_ADDS).toBe(8)
    expect(createDefaultQuickAdds().length).toBeLessThan(MAX_QUICK_ADDS)
  })

  it('keeps every localStorage key distinct and under the app prefix', () => {
    const keys = Object.values(LS_KEYS)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.filter((key) => !key.startsWith(LS_PREFIX))).toEqual([])
    expect(LS_KEYS).toEqual({
      theme: 'onabudget:theme',
      accent: 'onabudget:accent',
      rescue: 'onabudget:rescue',
      draft: 'onabudget:draft',
      onboardingStep: 'onabudget:onboardingStep',
      installHintDismissed: 'onabudget:installHintDismissed',
      backupNudgeUntil: 'onabudget:backupNudgeUntil',
    })
  })
})
