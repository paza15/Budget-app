import { useId, type CSSProperties } from 'react'
import styles from '@/ui/ColorSwatches.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface ColorSwatchOption<T> {
  value: T
  /** Accessible name, e.g. "Royal blue". */
  name: string
  /** Custom property holding the colour, e.g. '--accent-royal' or '--cat-blue'. */
  cssVar: string
}

export interface ColorSwatchesProps<T> extends TestIdProps {
  /** NoInfer: T comes from `value`, so a union state type is kept (not widened to string). */
  options: ColorSwatchOption<NoInfer<T>>[]
  value: T
  onChange(value: NoInfer<T>): void
  /** Accessible name of the group. */
  label: string
  /**
   * Shows `label` and the chosen colour's name above the swatches, so label and swatches read as
   * one form row (You > Accent: "Accent … Navy"). Otherwise the group title names them.
   */
  showLabel?: boolean
  className?: string
}

/** Up to eight swatches share one row; more wrap into two even rows (the ten category colours). */
const ONE_ROW_MAX = 8

/**
 * A row of colour choices (accent colours, category colours; docs/DESIGN.md §4.3, §6): 30pt
 * circles with 44pt targets, spread edge to edge, the choice ringed in --ink. Built on native
 * radio buttons, so arrow keys move the choice. It is a form row of its group (data-row).
 */
export function ColorSwatches<T>({
  options,
  value,
  onChange,
  label,
  showLabel = false,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: ColorSwatchesProps<T>) {
  const name = useId()
  const labelId = `${name}-label`
  const columns = options.length <= ONE_ROW_MAX ? options.length : Math.ceil(options.length / 2)
  const chosen = options.find((option) => Object.is(option.value, value))
  return (
    <div className={cx(styles.row, className)} data-row="">
      {showLabel && (
        <div className={styles.heading}>
          <span id={labelId} className={styles.label}>
            {label}
          </span>
          {chosen && <span className={styles.chosen}>{chosen.name}</span>}
        </div>
      )}
      <div
        role="radiogroup"
        aria-label={showLabel ? undefined : label}
        aria-labelledby={showLabel ? labelId : undefined}
        className={styles.swatches}
        style={{ '--columns': Math.max(1, columns) } as CSSProperties}
        data-testid={testId}
        data-id={dataId}
      >
        {options.map((option) => {
          const checked = Object.is(option.value, value)
          return (
            <label
              key={option.cssVar}
              className={cx(styles.swatch, checked && styles.selected)}
              style={{ '--swatch': `var(${option.cssVar})` } as CSSProperties}
            >
              <input
                type="radio"
                name={name}
                className={styles.input}
                aria-label={option.name}
                checked={checked}
                onChange={() => onChange(option.value)}
              />
            </label>
          )
        })}
      </div>
    </div>
  )
}
