import { useId } from 'react'
import { MAX_MONTH_START_DAY } from '@/domain/constants'
import { ordinalDay } from '@/domain/dates'
import styles from './DayGrid.module.css'

/** 1 … 28: every month has these days (docs/SPEC.md §4.3). */
const DAYS: readonly number[] = Array.from({ length: MAX_MONTH_START_DAY }, (_, i) => i + 1)

export interface DayGridProps {
  /** The day picked here. */
  value: number
  /** The day months start on now: ringed, like the month picker's current month. */
  current: number
  onChange(day: number): void
}

/**
 * The start-day picker of You › Month starts on (docs/SPEC.md §3.7): days 1 to 28 as four weeks
 * of round 44pt choices, drawn like the month picker's grid (DESIGN.md §9.3): the pick in
 * --accent with --on-accent, the day in use ringed in --ink. Native radios named "1st" … "28th".
 */
export function DayGrid({ value, current, onChange }: DayGridProps) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label="Day each month starts on" className={styles.grid} data-row="">
      {DAYS.map((day) => (
        <label
          key={day}
          className={styles.day}
          data-selected={day === value || undefined}
          data-current={day === current || undefined}
        >
          <input
            type="radio"
            name={name}
            className={styles.input}
            checked={day === value}
            aria-label={ordinalDay(day)}
            onChange={() => onChange(day)}
          />
          <span className={styles.number} aria-hidden="true">
            {day}
          </span>
        </label>
      ))}
    </div>
  )
}
