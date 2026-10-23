import { useState } from 'react'
import { useMonthBounds, useNav, useSelectedMonth, type SheetProps } from '@/app/nav'
import { compareISO, monthName, parseMonthKey, toMonthKey } from '@/domain/dates'
import { formatPeriodName, formatPeriodRange } from '@/domain/period'
import type { MonthKey } from '@/domain/types'
import { useAppStore } from '@/store/appStore'
import { Icon, SheetHeader } from '@/ui'
import styles from './MonthPickerSheet.module.css'

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** "October 2026", and with another start day than the 1st its range: "October 2026, 25 Oct – 24 Nov". */
function periodLabel(month: MonthKey, startDay: number, locale: string): string {
  const name = formatPeriodName(month, startDay, locale, { withYear: true })
  const range = formatPeriodRange(month, startDay, locale)
  return range === null ? name : `${name}, ${range}`
}

/**
 * Picks any period between the first one with data and twelve months ahead (docs/SPEC.md §5.5,
 * DESIGN.md §9.3): a year row and a 4 × 3 grid of months. The current period has a ring, the
 * selected one the accent; months out of range are disabled.
 */
export function MonthPickerSheet({ onClose }: SheetProps<'monthPicker'>) {
  const selected = useSelectedMonth()
  const { first, last, current } = useMonthBounds()
  const startDay = useAppStore((s) => s.data.settings.monthStartDay)
  const locale = useAppStore((s) => s.data.settings.locale)
  const firstYear = parseMonthKey(first).y
  const lastYear = parseMonthKey(last).y
  const [year, setYear] = useState(() => clamp(parseMonthKey(selected).y, firstYear, lastYear))

  const choose = (month: MonthKey): void => {
    useNav.getState().setMonth(month)
    onClose()
  }

  return (
    <>
      <SheetHeader title="Choose a month" onCancel={onClose} />
      <div className={styles.picker}>
        <div className={styles.yearRow}>
          <button
            type="button"
            className={styles.yearStep}
            aria-label={`Previous year, ${year - 1}`}
            disabled={year <= firstYear}
            onClick={() => setYear((y) => Math.max(y - 1, firstYear))}
          >
            <Icon name="chevron-left" weight="bold" size={17} />
          </button>
          <h3 className={styles.year} aria-live="polite">
            {year}
          </h3>
          <button
            type="button"
            className={styles.yearStep}
            aria-label={`Next year, ${year + 1}`}
            disabled={year >= lastYear}
            onClick={() => setYear((y) => Math.min(y + 1, lastYear))}
          >
            <Icon name="chevron-right" weight="bold" size={17} />
          </button>
        </div>
        <div className={styles.months}>
          {MONTHS.map((m) => {
            const key = toMonthKey(year, m)
            const inRange = compareISO(key, first) >= 0 && compareISO(key, last) <= 0
            return (
              <button
                key={key}
                type="button"
                className={styles.month}
                data-current={key === current || undefined}
                aria-current={key === current ? 'date' : undefined}
                aria-pressed={key === selected}
                aria-label={periodLabel(key, startDay, locale)}
                disabled={!inRange}
                onClick={() => choose(key)}
              >
                {monthName(m, 'short')}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
