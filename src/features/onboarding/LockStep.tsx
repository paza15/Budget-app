import { useEffect, useRef, useState } from 'react'
import { registerBiometric } from '@/features/lock/biometric'
import { lockSupport } from '@/features/lock/pin'
import { PinSetupFlow } from '@/features/lock/PinSetupFlow'
import { StepFrame } from '@/features/onboarding/StepFrame'
import styles from '@/features/onboarding/Steps.module.css'
import type { StepNav } from '@/features/onboarding/types'
import { updateSecurity, useSecurityStore } from '@/store/securityStore'
import { Coin, Icon } from '@/ui'

/** pin: choose a PIN. faceId: the Face ID offer after it. on: a PIN was set before this step. */
type Phase = 'pin' | 'faceId' | 'on'

/** The nearest ancestor that scrolls vertically: the step's Screen. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

/** Whether a platform authenticator (Face ID) can unlock the app; false when the check fails. */
async function faceIdAvailable(): Promise<boolean> {
  try {
    return await lockSupport().biometric()
  } catch {
    return false
  }
}

/**
 * Step 6, the lock (docs/SPEC.md §3.9, §3.8), offered where a PIN can be hashed: "Lock the app
 * with a PIN" with the lock feature's PinSetupFlow, then the Face ID offer when a platform
 * authenticator is there. "Not now" goes on without. Coming back with a PIN set (Back from Done,
 * a relaunch) says that the lock is on.
 */
export function LockStep({ progress, direction, onNext, onBack }: StepNav) {
  const pinSet = useSecurityStore((s) => s.config.pinHash !== null)
  // Decided when the step opens: setting the PIN here leads on to the Face ID offer instead.
  const [phase, setPhase] = useState<Phase>(() => (pinSet ? 'on' : 'pin'))
  const [busy, setBusy] = useState(false)
  const [faceIdFailed, setFaceIdFailed] = useState(false)

  const onPinSet = async () => {
    if (await faceIdAvailable()) setPhase('faceId')
    else onNext()
  }

  const turnOnFaceId = async () => {
    setBusy(true)
    setFaceIdFailed(false)
    try {
      // Called before anything else is awaited: creating the passkey needs the tap's activation.
      const credentialId = await registerBiometric()
      if (credentialId === null) {
        setFaceIdFailed(true)
        return
      }
      await updateSecurity({ biometricCredentialId: credentialId })
      onNext()
    } catch {
      setFaceIdFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'faceId') {
    return (
      // A screen of its own (the key remounts the frame): it slides in and its title takes focus.
      <StepFrame
        key="faceId"
        title="Unlock with Face ID"
        compactTitle="Face ID"
        lead="Open the app with a glance instead of typing your PIN."
        progress={progress}
        direction="forward"
        onBack={onBack}
        primary={{ label: 'Use Face ID', onClick: () => void turnOnFaceId(), disabled: busy }}
        secondary={{ label: 'Not now', onClick: onNext, disabled: busy }}
      >
        <div className={styles.faceId}>
          <Coin size="lg">
            <Icon name="face-id" size={28} />
          </Coin>
        </div>
        {faceIdFailed && (
          <p className={styles.error} role="alert">
            Face ID wasn&apos;t turned on. Try again, or choose Not now and turn it on later under App lock in
            Settings.
          </p>
        )}
        <p className={styles.note}>
          Face ID unlock uses a passkey saved in your Passwords app. If Face ID fails, iOS lets you use your iPhone
          passcode instead, so anyone who knows your passcode can open the app.
        </p>
      </StepFrame>
    )
  }

  if (phase === 'on') {
    return (
      <StepFrame
        title="Lock the app with a PIN"
        compactTitle="App lock"
        lead="App lock is on: the app asks for your PIN when you open it. You can change it in Settings under App lock."
        progress={progress}
        direction={direction}
        onBack={onBack}
        primary={{ label: 'Continue', onClick: onNext }}
      />
    )
  }

  return (
    <StepFrame
      title="Lock the app with a PIN"
      compactTitle="App lock"
      lead="The lock keeps people who pick up your unlocked iPhone out of the app."
      progress={progress}
      direction={direction}
      onBack={onBack}
      secondary={{ label: 'Not now', onClick: onNext }}
    >
      <PinSetupArea onDone={() => void onPinSet()} onCancel={onNext} />
    </StepFrame>
  )
}

/**
 * The lock feature's PIN setup. On a short screen (an iPhone SE, Safari with its toolbars) the
 * keypad would run below the fold, so the step opens scrolled to where the setup starts: the title
 * and the lead move under the nav row, whose compact header then names the step.
 */
function PinSetupArea({ onDone, onCancel }: { onDone(): void; onCancel(): void }) {
  const area = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = area.current
    const scroller = element === null ? null : scrollParent(element)
    if (element === null || scroller === null) return
    if (element.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom) return
    // Only the step's own scroller moves (scrollIntoView could move other boxes too). The text
    // above the setup ends right under the nav row; the browser stops at the end of the content.
    const nav = scroller.querySelector('header')
    const top = nav === null ? scroller.getBoundingClientRect().top : nav.getBoundingClientRect().bottom
    const above = element.previousElementSibling
    const edge = above === null ? element.getBoundingClientRect().top : above.getBoundingClientRect().bottom
    scroller.scrollTop += edge - top
  }, [])
  return (
    <div ref={area} className={styles.pinFlow}>
      <PinSetupFlow mode="enable" onDone={onDone} onCancel={onCancel} />
    </div>
  )
}
