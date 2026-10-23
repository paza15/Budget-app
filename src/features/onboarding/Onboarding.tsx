import { useEffect, useState } from 'react'
import { dayIndexInPeriod, periodOf } from '@/domain/period'
import type { AppData } from '@/domain/types'
import { lockSupport } from '@/features/lock/pin'
import { AboutYouStep } from '@/features/onboarding/AboutYouStep'
import { DoneStep } from '@/features/onboarding/DoneStep'
import { FixedCostsStep } from '@/features/onboarding/FixedCostsStep'
import {
  clearStoredStep,
  initialStep,
  LOCK_STEP,
  nextStep,
  previousStep,
  readStoredStep,
  resolveStep,
  storeStep,
  visibleSteps,
  WELCOME,
  type Step,
  type StepContext,
} from '@/features/onboarding/flow'
import { LockStep } from '@/features/onboarding/LockStep'
import { MoneyInStep } from '@/features/onboarding/MoneyInStep'
import styles from '@/features/onboarding/Onboarding.module.css'
import { SpentSoFarStep } from '@/features/onboarding/SpentSoFarStep'
import type { StepNav } from '@/features/onboarding/types'
import { Welcome } from '@/features/onboarding/Welcome'
import { InstallHint } from '@/features/pwa/InstallHint'
import { needsInstall } from '@/features/pwa/platform'
import { actions } from '@/store/actions'
import { useAppStore } from '@/store/appStore'
import { useToday } from '@/store/today'

type Direction = StepNav['direction']

/** "Start budgeting" (§3.9 step 7): forget the stored step, then mark onboarding done, last. */
function finish(): void {
  clearStoredStep()
  actions.updateSettings({ onboarded: true })
}

/** lockSupport().pin; a check that fails counts as no support, since the lock step is optional. */
function pinLockSupported(): boolean {
  try {
    return lockSupport().pin
  } catch {
    return false
  }
}

/**
 * First-run setup, one step at a time, resumable after a relaunch (docs/SPEC.md §3.9): the install
 * gate in iOS Safari, Welcome, About you, Money in, Fixed costs, Spent so far (after the period's
 * first day), the lock (where a PIN can be hashed) and Done. The root carries the test id
 * `onboarding` and the step number in data-step.
 *
 * Each step saves through actions when the user leaves it, so nothing waits for the end and every
 * step shows what the data already holds; only "Start budgeting" sets settings.onboarded, last. A
 * restored backup stays in onboarding (importWithConfirm's continueOnboarding) and goes on at the
 * lock, which no backup holds.
 */
export function Onboarding() {
  const today = useToday()
  const startDay = useAppStore((s) => s.data.settings.monthStartDay)
  // Where the app runs and what this browser supports never change while it is open.
  const [platform] = useState(() => ({ needsInstall: needsInstall(), lockSupported: pinLockSupported() }))
  const ctx: StepContext = {
    ...platform,
    pastFirstDay: (dayIndexInPeriod(today, periodOf(today, startDay), startDay) ?? 1) > 1,
  }

  const [nav, setNav] = useState<{ step: Step; direction: Direction }>(() => ({
    step: initialStep(readStoredStep(), ctx),
    direction: null,
  }))

  // The data a restored backup replaced: "Undo" on "Backup restored" brings exactly this object
  // back, and then onboarding starts again at Welcome.
  const [restoredFrom, setRestoredFrom] = useState<AppData | null>(null)
  const undone = useAppStore((s) => restoredFrom !== null && s.data === restoredFrom)
  if (undone) {
    setRestoredFrom(null)
    setNav({ step: WELCOME, direction: 'back' })
  }

  // A step that stopped applying (a new period began, say) gives way to the next one.
  const step = resolveStep(nav.step, ctx)

  // The last step reached is kept, so a relaunch resumes there.
  useEffect(() => {
    storeStep(step)
  }, [step])

  const go = (to: Step, direction: Direction) => setNav({ step: to, direction })
  const steps = visibleSteps(ctx)
  const stepNav: StepNav = {
    progress: { index: steps.indexOf(step), count: steps.length },
    direction: nav.direction,
    onNext: () => go(nextStep(step, ctx), 'forward'),
    onBack: () => go(previousStep(step, ctx), 'back'),
  }

  return (
    <div className={styles.onboarding} data-testid="onboarding" data-step={step}>
      {step === 0 && <InstallHint variant="gate" onContinue={() => go(WELCOME, 'forward')} />}
      {step === 1 && (
        <Welcome
          onStart={stepNav.onNext}
          onRestored={(before) => {
            setRestoredFrom(before)
            go(resolveStep(LOCK_STEP, ctx), 'forward')
          }}
        />
      )}
      {step === 2 && <AboutYouStep {...stepNav} />}
      {step === 3 && <MoneyInStep {...stepNav} />}
      {step === 4 && <FixedCostsStep {...stepNav} />}
      {step === 5 && <SpentSoFarStep {...stepNav} />}
      {step === 6 && <LockStep {...stepNav} />}
      {step === 7 && (
        <DoneStep progress={stepNav.progress} direction={stepNav.direction} onBack={stepNav.onBack} onFinish={finish} />
      )}
    </div>
  )
}
