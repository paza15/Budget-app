import { useId, type ReactNode } from 'react'
import { Icon } from '@/ui'
import styles from './ChoiceList.module.css'

export interface ChoiceOption<T> {
  value: T
  /** Body --ink. */
  title: ReactNode
  /** A value in Body --ink-2 before the check ("1.234,56 €"). */
  detail?: ReactNode
  /** A coin at the start (the move-to list of the category sheet). */
  leading?: ReactNode
  /** Accessible name when the visible text is not enough. */
  label?: string
}

export interface ChoiceListProps<T> {
  /** Accessible name of the radio group. */
  label: string
  options: readonly ChoiceOption<T>[]
  /** null: nothing chosen yet. */
  value: T | null
  onChange(value: T): void
  'data-testid'?: string
}

/**
 * One choice from a list of rows (Currency, Number format, the category to move entries to;
 * docs/SPEC.md §3.7): form rows of an inset group with an --accent-ink check at the trailing end
 * of the chosen one, as iOS lists mark a selection (DESIGN.md §4.3). Native radios cover the rows,
 * so a tap anywhere picks and arrow keys move the choice. The kit has no such list yet.
 */
export function ChoiceList<T>({ label, options, value, onChange, 'data-testid': testId }: ChoiceListProps<T>) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((option, index) => {
        const checked = value !== null && Object.is(option.value, value)
        const coin = option.leading !== undefined
        return (
          <label
            key={index}
            className={coin ? `${styles.row} ${styles.withLeading}` : styles.row}
            data-row={coin ? 'coin' : ''}
            data-checked={checked || undefined}
          >
            <input
              type="radio"
              name={name}
              className={styles.input}
              checked={checked}
              aria-label={option.label}
              onChange={() => onChange(option.value)}
            />
            {coin && <span className={styles.leading}>{option.leading}</span>}
            <span className={styles.main}>
              <span className={styles.title}>{option.title}</span>
              {option.detail !== undefined && <span className={styles.detail}>{option.detail}</span>}
            </span>
            <span className={styles.check} aria-hidden="true">
              {checked && <Icon name="check" size={17} />}
            </span>
          </label>
        )
      })}
    </div>
  )
}
