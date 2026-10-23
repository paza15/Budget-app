import { useId, type ReactNode } from 'react'
import { cx } from '@/ui/text'
import styles from '@/ui/Toggle.module.css'
import type { TestIdProps } from '@/ui/types'

export interface ToggleProps extends TestIdProps {
  checked: boolean
  onChange(checked: boolean): void
  /** Visible label and accessible name. */
  label: string
  /** A line under the label, e.g. the live "Counts 116,58 € every month instead of …". */
  description?: ReactNode
  disabled?: boolean
  className?: string
}

/**
 * A form row with its label and an iOS switch (docs/DESIGN.md §9.13): 51 × 31, off on
 * --surface-2-strong, on in --accent with an --on-accent knob. The whole row toggles it. A native
 * checkbox with role="switch" carries the state and the keyboard.
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: ToggleProps) {
  const id = useId()
  const labelId = `${id}-label`
  const descriptionId = `${id}-description`
  return (
    <label className={cx(styles.row, disabled && styles.disabled, className)} data-row="">
      <span className={styles.text}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        {description !== undefined && (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        className={styles.input}
        checked={checked}
        aria-checked={checked}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={description !== undefined ? descriptionId : undefined}
        onChange={(event) => onChange(event.currentTarget.checked)}
        data-testid={testId}
        data-id={dataId}
      />
      <span className={styles.track} aria-hidden="true">
        <span className={styles.knob} />
      </span>
    </label>
  )
}
