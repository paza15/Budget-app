import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LS_KEYS } from '@/domain/constants'
import {
  clearStoredStep,
  initialStep,
  isStep,
  nextStep,
  previousStep,
  readStoredStep,
  resolveStep,
  stepApplies,
  storeStep,
  visibleSteps,
  type StepContext,
} from '@/features/onboarding/flow'
import { createMemoryStorage } from '@/store/test-helpers/backends'

// docs/SPEC.md §3.9: the order of the steps, which ones apply, and the stored step.

/** Storage that throws, as Safari's does with blocked site data. */
function blocked(): never {
  throw new DOMException('The operation is insecure.', 'SecurityError')
}

const ALL: StepContext = { needsInstall: true, pastFirstDay: true, lockSupported: true }
const NONE: StepContext = { needsInstall: false, pastFirstDay: false, lockSupported: false }

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('stepApplies', () => {
  it('shows the gate only outside the installed iOS app, step 5 after the first day, step 6 with PIN support', () => {
    expect(stepApplies(0, ALL)).toBe(true)
    expect(stepApplies(0, NONE)).toBe(false)
    expect(stepApplies(5, ALL)).toBe(true)
    expect(stepApplies(5, NONE)).toBe(false)
    expect(stepApplies(6, ALL)).toBe(true)
    expect(stepApplies(6, NONE)).toBe(false)
    for (const step of [1, 2, 3, 4, 7] as const) expect(stepApplies(step, NONE)).toBe(true)
  })
})

describe('visibleSteps', () => {
  it('counts Welcome to Done, without the gate and the steps that do not apply', () => {
    expect(visibleSteps(ALL)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(visibleSteps(NONE)).toEqual([1, 2, 3, 4, 7])
    expect(visibleSteps({ ...NONE, lockSupported: true })).toEqual([1, 2, 3, 4, 6, 7])
  })
})

describe('nextStep and previousStep', () => {
  it('walk every step when all apply', () => {
    expect(nextStep(0, ALL)).toBe(1)
    expect(nextStep(1, ALL)).toBe(2)
    expect(nextStep(4, ALL)).toBe(5)
    expect(nextStep(5, ALL)).toBe(6)
    expect(nextStep(6, ALL)).toBe(7)
    expect(nextStep(7, ALL)).toBe(7)
    expect(previousStep(7, ALL)).toBe(6)
    expect(previousStep(5, ALL)).toBe(4)
    expect(previousStep(2, ALL)).toBe(1)
  })

  it('skip Spent so far on the first day of the period and the lock without PIN support', () => {
    expect(nextStep(4, NONE)).toBe(7)
    expect(previousStep(7, NONE)).toBe(4)
    expect(nextStep(4, { ...NONE, lockSupported: true })).toBe(6)
    expect(previousStep(6, { ...NONE, pastFirstDay: true, lockSupported: true })).toBe(5)
  })

  it('never lead Back to the install gate', () => {
    expect(previousStep(1, ALL)).toBe(1)
    expect(previousStep(2, ALL)).toBe(1)
  })
})

describe('resolveStep', () => {
  it('keeps a step that applies and moves on from one that does not', () => {
    expect(resolveStep(3, NONE)).toBe(3)
    expect(resolveStep(5, NONE)).toBe(7)
    expect(resolveStep(5, { ...NONE, lockSupported: true })).toBe(6)
    expect(resolveStep(6, NONE)).toBe(7)
  })

  it('opens Welcome instead of a gate that no longer applies', () => {
    expect(resolveStep(0, ALL)).toBe(0)
    expect(resolveStep(0, NONE)).toBe(1)
  })
})

describe('initialStep', () => {
  it('starts at the gate in iOS Safari and at Welcome elsewhere', () => {
    expect(initialStep(null, ALL)).toBe(0)
    expect(initialStep(null, NONE)).toBe(1)
  })

  it('resumes at the stored step, or the next one that applies', () => {
    expect(initialStep(3, ALL)).toBe(3)
    expect(initialStep(1, ALL)).toBe(1)
    expect(initialStep(5, NONE)).toBe(7)
  })
})

describe('the stored step', () => {
  it('round-trips through localStorage and can be cleared', () => {
    expect(readStoredStep()).toBeNull()
    storeStep(4)
    expect(localStorage.getItem(LS_KEYS.onboardingStep)).toBe('4')
    expect(readStoredStep()).toBe(4)
    clearStoredStep()
    expect(localStorage.getItem(LS_KEYS.onboardingStep)).toBeNull()
    expect(readStoredStep()).toBeNull()
  })

  it('ignores values that are not a step', () => {
    for (const value of ['8', '-1', '2.5', 'three', '', ' 3', '03']) {
      localStorage.setItem(LS_KEYS.onboardingStep, value)
      expect(readStoredStep()).toBeNull()
    }
  })

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(readStoredStep()).toBeNull()
    expect(() => storeStep(3)).not.toThrow()
    expect(() => clearStoredStep()).not.toThrow()
  })
})

describe('isStep', () => {
  it('accepts the integers 0 to 7 only', () => {
    expect([0, 1, 7].every(isStep)).toBe(true)
    expect([-1, 8, 2.5, Number.NaN, '3', null].some(isStep)).toBe(false)
  })
})
