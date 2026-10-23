import { useId } from 'react'
import type { IconRef } from '@/domain/types'
import { CategoryIcon } from '@/ui/CategoryIcon'
import { Icon } from '@/ui/Icon'
import styles from '@/ui/SelectField.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface SelectOption<T> {
  value: T
  label: string
  /** A category glyph or emoji shown with the chosen value (the Category picker). */
  icon?: IconRef
  disabled?: boolean
}

export interface SelectFieldProps<T> extends TestIdProps {
  label: string
  value: T
  /** NoInfer: T comes from `value`, so a union state type is kept (not widened to string). */
  options: SelectOption<NoInfer<T>>[]
  onChange(value: NoInfer<T>): void
  disabled?: boolean
  className?: string
}

/**
 * A picker row (docs/DESIGN.md §9.8): the label in Body --ink, the chosen value in --ink-2 and a
 * 14px caret-up-down. A native <select> covers the row, so a tap opens the iOS picker anywhere on
 * it. Options are matched by position, so values need not be strings.
 */
export function SelectField<T>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: SelectFieldProps<T>) {
  const id = useId()
  const labelId = `${id}-label`
  const selectedIndex = options.findIndex((option) => Object.is(option.value, value))
  const selected = options[selectedIndex]
  return (
    <div className={cx(styles.field, disabled && styles.disabled, className)} data-row="">
      <label id={labelId} htmlFor={id} className={styles.label}>
        {label}
      </label>
      <span className={styles.value} aria-hidden="true">
        {selected?.icon !== undefined && <CategoryIcon icon={selected.icon} size={17} />}
        <span className={styles.valueText}>{selected?.label ?? ''}</span>
        <Icon name="chevron-updown" size={14} className={styles.caret} />
      </span>
      <select
        id={id}
        aria-labelledby={labelId}
        className={styles.select}
        value={String(selectedIndex)}
        disabled={disabled}
        onChange={(event) => {
          const option = options[Number(event.currentTarget.value)]
          if (option) onChange(option.value)
        }}
        data-testid={testId}
        data-id={dataId}
      >
        {selectedIndex < 0 && (
          <option value="-1" disabled hidden>
            Not chosen
          </option>
        )}
        {options.map((option, index) => (
          <option key={`${index}-${option.label}`} value={String(index)} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
