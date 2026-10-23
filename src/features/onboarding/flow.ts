import { LS_KEYS } from '@/domain/constants'

/**
 * The order of onboarding (docs/SPEC.md §3.9): which steps apply, where Continue and Back lead,
 * and the step kept in localStorage so a relaunch resumes there. Pure apart from the storage
 * helpers, which never throw.
 */

/**
 * 0 Install first, 1 Welcome, 2 About you, 3 Money in, 4 Fixed costs, 5 Spent so far, 6 Lock,
 * 7 Done: the step numbers of SPEC §3.9, also the root's data-step.
 */
export type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export const WELCOME: Step = 1
export const LOCK_STEP: Step = 6
export const DONE: Step = 7

/** What decides whether the optional steps show. */
export interface StepContext {
  /** iOS outside the installed app, where step 0 asks to install first. */
  needsInstall: boolean
  /** Today is after the first day of the current period: step 5 asks what was spent already. */
  pastFirstDay: boolean
  /** A PIN can be hashed here (lockSupport().pin): step 6 offers the lock. */
  lockSupported: boolean
}

/** The steps after the gate, in order. */
const STEPS: readonly Step[] = [1, 2, 3, 4, 5, 6, 7]

export function isStep(value: unknown): value is Step {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= DONE
}

export function stepApplies(step: Step, ctx: StepContext): boolean {
  switch (step) {
    case 0:
      return ctx.needsInstall
    case 5:
      return ctx.pastFirstDay
    case 6:
      return ctx.lockSupported
    default:
      return true
  }
}

/** The steps the progress ruler counts (Welcome to Done), without those that do not apply. */
export function visibleSteps(ctx: StepContext): Step[] {
  return STEPS.filter((step) => stepApplies(step, ctx))
}

/**
 * The step to show for `step`: itself when it applies, else the next one that does. A gate that
 * no longer applies (the app was installed meanwhile) gives Welcome.
 */
export function resolveStep(step: Step, ctx: StepContext): Step {
  if (step === 0) return ctx.needsInstall ? 0 : WELCOME
  return STEPS.find((candidate) => candidate >= step && stepApplies(candidate, ctx)) ?? DONE
}

/** Where Continue (or Skip) leads: the next step that applies. Done is the last. */
export function nextStep(step: Step, ctx: StepContext): Step {
  return STEPS.find((candidate) => candidate > step && stepApplies(candidate, ctx)) ?? DONE
}

/** Where Back leads: the previous step that applies, never the install gate. */
export function previousStep(step: Step, ctx: StepContext): Step {
  return STEPS.findLast((candidate) => candidate < step && stepApplies(candidate, ctx)) ?? WELCOME
}

/**
 * Where onboarding opens: the stored step (resolved, in case it no longer applies), or the start:
 * the install gate in iOS Safari, else Welcome. Having passed the gate once ("Continue in Safari")
 * stores step 1, so a relaunch in Safari does not ask again.
 */
export function initialStep(stored: Step | null, ctx: StepContext): Step {
  return resolveStep(stored ?? 0, ctx)
}

/** The step kept by the last session, or null when there is none or it cannot be read. */
export function readStoredStep(): Step | null {
  try {
    const raw = localStorage.getItem(LS_KEYS.onboardingStep)
    if (raw === null || !/^\d$/.test(raw)) return null
    const step = Number(raw)
    return isStep(step) ? step : null
  } catch {
    // Storage is blocked (private browsing, cleared site data): start from the beginning.
    return null
  }
}

/** Keeps the step for the next launch. Without storage the session simply does not resume. */
export function storeStep(step: Step): void {
  try {
    localStorage.setItem(LS_KEYS.onboardingStep, String(step))
  } catch {
    // Storage is blocked or full: nothing to resume, which only costs a few taps.
  }
}

export function clearStoredStep(): void {
  try {
    localStorage.removeItem(LS_KEYS.onboardingStep)
  } catch {
    // Storage is blocked: there is nothing stored either.
  }
}
