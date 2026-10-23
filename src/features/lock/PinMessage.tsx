import { cx } from '@/features/lock/cx'
import styles from '@/features/lock/PinMessage.module.css'
import { formatCountdown, type PinFeedback } from '@/features/lock/usePinCheck'
import { Icon } from '@/ui'

/** Said once when a lockout starts; the countdown itself is a timer, read on request. */
const LOCKOUT_SPOKEN = 'Too many tries. PIN entry is paused for now.'

const FEEDBACK: Readonly<Record<Exclude<PinFeedback, null>, string>> = {
  wrong: 'Wrong PIN',
  error: "Couldn't check your PIN. Reopen the app.",
}

export interface PinMessageProps {
  feedback: PinFeedback
  /** Lockout seconds left; above 0 the countdown replaces the feedback. */
  lockoutSeconds: number
  className?: string
}

/**
 * The line under the PIN dots (docs/DESIGN.md §9.24): "Wrong PIN" in Footnote --critical-ink, or
 * during a lockout "Try again in 0:30" in --ink-2. The status is a live region that is always
 * there, so VoiceOver hears each change once; the ticking countdown is a timer, which is not.
 */
export function PinMessage({ feedback, lockoutSeconds, className }: PinMessageProps) {
  const lockedOut = lockoutSeconds > 0
  return (
    <div className={cx(styles.message, className)}>
      <output className={cx(styles.line, styles.critical)}>
        {lockedOut ? <span className="visually-hidden">{LOCKOUT_SPOKEN}</span> : feedback && FEEDBACK[feedback]}
      </output>
      {lockedOut && (
        <p role="timer" className={styles.line}>
          Try again in {formatCountdown(lockoutSeconds)}
        </p>
      )}
    </div>
  )
}

export interface FaceIdKeyProps {
  onPress(): void
  /** Default "Unlock with Face ID". */
  label?: string
}

/** The PIN keypad's bottom-left key (docs/DESIGN.md §9.15): scan-smiley light 30, bare. */
export function FaceIdKey({ onPress, label = 'Unlock with Face ID' }: FaceIdKeyProps) {
  return (
    <button type="button" aria-label={label} onClick={onPress}>
      <Icon name="face-id" weight="light" size={30} />
    </button>
  )
}
