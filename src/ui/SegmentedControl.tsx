import { useId, type CSSProperties } from 'react'
import styles from '@/ui/SegmentedControl.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'
import { useReducedMotion } from '@/ui/useReducedMotion'

export interface SegmentedOption<T> {
  value: T
  label: string
}

export interface SegmentedControlProps<T> extends TestIdProps {
  /** NoInfer: T comes from `value`, so a union state type is kept (not widened to string). */
  options: SegmentedOption<NoInfer<T>>[]
  value: T
  onChange(value: NoInfer<T>): void
  /** Accessible name of the group. */
  label: string
  className?: string
}

/**
 * Two to four mutually exclusive options side by side (docs/DESIGN.md §9.11): a --surface-2 track
 * with a neutral --thumb that slides in --dur-fade (with Reduce Motion it fades in place). Built on
 * native radio buttons, so arrow keys move the choice.
 */
export function SegmentedControl<T>({
  options,
  value,
  onChange,
  label,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: SegmentedControlProps<T>) {
  const name = useId()
  const reduceMotion = useReducedMotion()
  const selected = options.findIndex((option) => Object.is(option.value, value))
  const thumbStyle = { '--count': options.length, '--index': Math.max(0, selected) } as CSSProperties
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(styles.control, className)}
      style={thumbStyle}
      data-testid={testId}
      data-id={dataId}
    >
      {selected >= 0 && (
        // With Reduce Motion the thumb is re-created at its new place and fades in instead of sliding.
        <span key={reduceMotion ? selected : 'thumb'} className={cx(styles.thumb, reduceMotion && styles.fade)} aria-hidden="true" />
      )}
      {options.map((option, index) => (
        <label key={option.label} className={cx(styles.option, index === selected && styles.selected)}>
          <input
            type="radio"
            name={name}
            className={styles.input}
            checked={index === selected}
            onChange={() => onChange(option.value)}
          />
          <span className={styles.text}>{option.label}</span>
        </label>
      ))}
    </div>
  )
}
