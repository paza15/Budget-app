import { useEffect, useRef, useState } from 'react'
import type { KeypadKey } from '@/domain/money'
import { cx } from '@/features/lock/cx'
import { lockSupport, setPin } from '@/features/lock/pin'
import { PinDots } from '@/features/lock/PinDots'
import styles from '@/features/lock/PinSetupFlow.module.css'
import { useSecurityStore } from '@/store/securityStore'
import { Button, Keypad, SegmentedControl, type SegmentedOption } from '@/ui'

export interface PinSetupFlowProps {
  /** 'enable' sets the first PIN; 'change' replaces it (the old PIN was verified before). */
  mode: 'enable' | 'change'
  /** The new PIN is saved. */
  onDone(): void
  /** The user left without a new PIN (through the flow's own cancel button, see cancelLabel). */
  onCancel(): void
  /**
   * Shows a plain button under the keypad that calls onCancel, with this label ("Not now",
   * "Cancel"). Leave it out where the container has its own way out, such as a sheet's Cancel.
   */
  cancelLabel?: string
  /**
   * 'compact' (default) stacks the parts with fixed gaps, for a sheet; 'fill' takes the
   * container's height and keeps the keypad at the bottom, for a full screen.
   */
  layout?: 'compact' | 'fill'
}

type Length = 4 | 6
/** choose: the first entry; hold: its full dots show a moment; confirm: the second entry. */
type Phase = 'choose' | 'hold' | 'confirm' | 'saving'
type Problem = 'mismatch' | 'failed' | 'unsupported'

const LENGTHS: SegmentedOption<Length>[] = [
  { value: 4, label: '4 digits' },
  { value: 6, label: '6 digits' },
]

/** How long the first entry's full dots stay before the confirmation starts empty. */
const HOLD_MS = 250

const PROBLEMS: Readonly<Record<Problem, string>> = {
  mismatch: "The PINs didn't match. Try again.",
  failed: "Couldn't save the PIN. Try again.",
  unsupported: "App lock needs the app's https:// address.",
}

/**
 * Choose 4 or 6 digits, enter the PIN, confirm it (docs/SPEC.md §3.8). Used by the PIN setup
 * sheet, onboarding and the lock screen's Forgot PIN. The confirmation starts with empty dots; a
 * mismatch shakes them and starts over. The digits stay in refs, never in React state, and are
 * emptied as soon as they have been compared or saved.
 */
export function PinSetupFlow({ mode, onDone, onCancel, cancelLabel, layout = 'compact' }: PinSetupFlowProps) {
  const storedLength = useSecurityStore((s) => s.config.pinLength)
  const [length, setLength] = useState<Length>(storedLength)
  const [phase, setPhase] = useState<Phase>('choose')
  const [filled, setFilled] = useState(0)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [mismatches, setMismatches] = useState(0)
  /** The entry being typed. */
  const typed = useRef<string[]>([])
  /** The first entry, kept for the confirmation. */
  const chosen = useRef<string[]>([])
  /** Keys wait while the dots hold or the PIN saves. Set at once, before any re-render. */
  const busy = useRef(false)

  // Nothing typed outlives the flow.
  useEffect(() => {
    const entry = typed.current
    const first = chosen.current
    return () => {
      entry.length = 0
      first.length = 0
    }
  }, [])

  // After the first entry the full dots stay a moment, then the confirmation starts empty.
  useEffect(() => {
    if (phase !== 'hold') return undefined
    const timer = window.setTimeout(() => {
      busy.current = false
      setFilled(0)
      setPhase('confirm')
    }, HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  const startOver = (reason: Problem): void => {
    typed.current.length = 0
    chosen.current.length = 0
    busy.current = false
    setFilled(0)
    setPhase('choose')
    setProblem(reason)
  }

  const save = async (pin: string): Promise<void> => {
    try {
      await setPin(pin, length)
    } catch {
      startOver(lockSupport().pin ? 'failed' : 'unsupported')
      return
    }
    onDone()
  }

  const onKey = (key: KeypadKey): void => {
    if (busy.current || key === '.') return
    const entry = typed.current
    if (key === 'back') {
      entry.pop()
      setFilled(entry.length)
      return
    }
    if (entry.length >= length) return
    entry.push(key)
    setFilled(entry.length)
    setProblem(null)
    if (entry.length < length) return

    busy.current = true
    if (phase === 'choose') {
      chosen.current.splice(0, chosen.current.length, ...entry)
      entry.length = 0
      setPhase('hold')
      return
    }
    const first = chosen.current.join('')
    const second = entry.join('')
    entry.length = 0
    chosen.current.length = 0
    if (first !== second) {
      startOver('mismatch')
      setMismatches((n) => n + 1)
      return
    }
    setPhase('saving')
    void save(first)
  }

  const changeLength = (next: Length): void => {
    if (busy.current) return
    typed.current.length = 0
    setLength(next)
    setFilled(0)
    setProblem(null)
  }

  const choosing = phase === 'choose' || phase === 'hold'
  const prompt = choosing ? (mode === 'enable' ? 'Choose a PIN' : 'Choose a new PIN') : 'Enter it again'

  return (
    <div className={cx(styles.flow, layout === 'fill' && styles.fill)}>
      {/* Kept in place while confirming, so the parts below never jump. */}
      <div className={cx(styles.length, !choosing && styles.hidden)} inert={!choosing}>
        <SegmentedControl label="PIN length" options={LENGTHS} value={length} onChange={changeLength} />
      </div>
      <p className={styles.prompt} aria-live="polite">
        {prompt}
      </p>
      <PinDots key={mismatches} length={length} filled={filled} shake={mismatches > 0} className={styles.dots} />
      <output className={styles.problem}>{problem === null ? null : PROBLEMS[problem]}</output>
      <Keypad variant="pin" decimalSeparator={null} label="PIN" onKey={onKey} className={styles.keypad} />
      {cancelLabel !== undefined && (
        <Button variant="plain" className={styles.cancel} onClick={onCancel}>
          {cancelLabel}
        </Button>
      )}
    </div>
  )
}
