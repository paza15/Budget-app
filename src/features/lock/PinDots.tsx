import { cx } from '@/features/lock/cx'
import styles from '@/features/lock/PinDots.module.css'

export interface PinDotsProps {
  /** 4 or 6. */
  length: number
  /** Digits entered so far. */
  filled: number
  /**
   * Plays the wrong-PIN shake (a flash of --critical with Reduce Motion) as the dots mount. Give
   * the dots a new `key` for each wrong PIN to play it again.
   */
  shake?: boolean
  className?: string
}

/**
 * The PIN dots (docs/DESIGN.md §9.24): four or six 13px dots, 20 apart; entered digits are --ink
 * dots, the rest 1.5px --ink-3 rings. Test id pin-dots with data-filled (docs/SPEC.md §9).
 * VoiceOver reads "2 of 4 digits entered".
 */
export function PinDots({ length, filled, shake = false, className }: PinDotsProps) {
  return (
    <div className={cx(styles.dots, shake && styles.shake, className)} data-testid="pin-dots" data-filled={filled}>
      {Array.from({ length }, (_, index) => (
        <span key={index} className={cx(styles.dot, index < filled && styles.filled)} aria-hidden="true" />
      ))}
      <span className="visually-hidden">{`${filled} of ${length} digits entered`}</span>
    </div>
  )
}
