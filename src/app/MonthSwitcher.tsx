import { useRef, type MouseEvent, type RefObject } from 'react'
import { useMonthBounds, useNav, useSelectedMonth } from '@/app/nav'
import { addMonths, compareISO } from '@/domain/dates'
import { formatPeriodRange, formatPeriodTitle, periodOf } from '@/domain/period'
import type { MonthKey } from '@/domain/types'
import { useAppStore } from '@/store/appStore'
import { useToday } from '@/store/today'
import { GlassGroup, Icon, IconButton } from '@/ui'
import styles from './MonthSwitcher.module.css'

/**
 * The shared month of Home, Daily and Fixed (docs/SPEC.md §5.5, DESIGN.md §9.3): MonthStepper in
 * the nav row, MonthTitle as the large title, and MonthSwitcher for places without a nav row.
 */

export interface MonthSwitcherProps {
  /** title: the large title of Home, Daily and Fixed. compact: category detail. Default 'title'. */
  variant?: 'title' | 'compact'
}

export interface MonthTitleProps {
  /** title: the serif large title. compact: the "‹ October ›" capsule of category detail. */
  variant?: 'title' | 'compact'
  className?: string
}

export interface MonthStepperProps {
  className?: string
}

function cx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

function usePeriodSettings(): { startDay: number; locale: string; current: MonthKey } {
  const startDay = useAppStore((s) => s.data.settings.monthStartDay)
  const locale = useAppStore((s) => s.data.settings.locale)
  const today = useToday()
  return { startDay, locale, current: periodOf(today, startDay) }
}

function selectMonth(month: MonthKey): void {
  useNav.getState().setMonth(month)
}

function openMonthPicker(): void {
  useNav.getState().openSheet({ name: 'monthPicker' })
}

/** Previous and next buttons, disabled at the first period with data and twelve months ahead. */
function useSteps(): { prev: MonthKey; next: MonthKey; canPrev: boolean; canNext: boolean; prevName: string; nextName: string } {
  const month = useSelectedMonth()
  const { first, last } = useMonthBounds()
  const { startDay, locale, current } = usePeriodSettings()
  const prev = addMonths(month, -1)
  const next = addMonths(month, 1)
  return {
    prev,
    next,
    canPrev: compareISO(prev, first) >= 0,
    canNext: compareISO(next, last) <= 0,
    prevName: formatPeriodTitle(prev, current, startDay, locale),
    nextName: formatPeriodTitle(next, current, startDay, locale),
  }
}

interface StepButtonProps {
  direction: 'prev' | 'next'
}

/** "Previous month" or "Next month": a 44 × 44 cell with a bold 17px chevron, disabled at the bounds. */
function StepButton({ direction }: StepButtonProps) {
  const { prev, next, canPrev, canNext, prevName, nextName } = useSteps()
  const back = direction === 'prev'
  return (
    <IconButton
      icon={back ? 'chevron-left' : 'chevron-right'}
      weight="bold"
      iconSize={17}
      label={back ? `Previous month, ${prevName}` : `Next month, ${nextName}`}
      data-testid={back ? 'month-prev' : 'month-next'}
      disabled={back ? !canPrev : !canNext}
      onClick={() => selectMonth(back ? prev : next)}
    />
  )
}

/** The trailing glass capsule of the nav row: "Previous month" and "Next month" (88 × 44). */
export function MonthStepper({ className }: MonthStepperProps) {
  return (
    <GlassGroup label="Month" className={className}>
      <StepButton direction="prev" />
      <StepButton direction="next" />
    </GlassGroup>
  )
}

/** "Back to this month", shown while another period is selected. */
function BackToThisMonth({ onBack }: { onBack(event: MouseEvent<HTMLButtonElement>): void }) {
  return (
    <button type="button" className={styles.backPill} onClick={onBack}>
      Back to this month
    </button>
  )
}

/**
 * The month as the large title: a button with the serif month name and a caret that opens the
 * month picker (test id month-label), the range under it when the month starts on another day
 * than the 1st, and "Back to this month" at the trailing end away from the current period. The
 * compact variant is the "‹ October ›" capsule of category detail, with the same test ids.
 */
export function MonthTitle({ variant = 'title', className }: MonthTitleProps) {
  const month = useSelectedMonth()
  const { startDay, locale, current } = usePeriodSettings()
  const labelRef = useRef<HTMLButtonElement>(null)
  const name = formatPeriodTitle(month, current, startDay, locale)
  const range = formatPeriodRange(month, startDay, locale)
  const label = `${name}${range === null ? '' : `, ${range}`}, choose month`

  const back = (event: MouseEvent<HTMLButtonElement>): void => {
    // The pill disappears with the change, so keyboard focus moves on to the month itself.
    const hadFocus = document.activeElement === event.currentTarget
    useNav.getState().setMonth(null)
    if (hadFocus) labelRef.current?.focus()
  }

  if (variant === 'compact') {
    return (
      <div className={cx(styles.compactRow, className)}>
        <CompactCapsule labelRef={labelRef} name={name} label={label} />
        {/* A period that starts on another day than the 1st always shows its range (§3). */}
        {range !== null && (
          <span className={styles.range} aria-hidden="true">
            {range}
          </span>
        )}
        {month !== current && <BackToThisMonth onBack={back} />}
      </div>
    )
  }

  return (
    <div className={cx(styles.title, className)}>
      <div className={styles.titleText}>
        <button
          ref={labelRef}
          type="button"
          className={styles.monthButton}
          data-testid="month-label"
          aria-label={label}
          aria-haspopup="dialog"
          onClick={openMonthPicker}
        >
          <span className={styles.monthName}>{name}</span>
          <Icon name="chevron-down" weight="bold" size={16} className={styles.caret} />
        </button>
        {range !== null && (
          <span className={styles.range} aria-hidden="true">
            {range}
          </span>
        )}
      </div>
      {month !== current && <BackToThisMonth onBack={back} />}
    </div>
  )
}

interface CompactCapsuleProps {
  labelRef: RefObject<HTMLButtonElement | null>
  name: string
  label: string
}

/** "‹ October ›": previous, the month (opens the picker) and next in one glass capsule. */
function CompactCapsule({ labelRef, name, label }: CompactCapsuleProps) {
  return (
    <GlassGroup label="Month">
      <StepButton direction="prev" />
      <button
        ref={labelRef}
        type="button"
        className={styles.compactLabel}
        data-testid="month-label"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={openMonthPicker}
      >
        {name}
      </button>
      <StepButton direction="next" />
    </GlassGroup>
  )
}

/**
 * The title and the stepper in one row, for places without a nav row. The compact variant is the
 * capsule alone, which already holds both buttons.
 */
export function MonthSwitcher({ variant = 'title' }: MonthSwitcherProps) {
  if (variant === 'compact') return <MonthTitle variant="compact" />
  return (
    <div className={styles.switcher}>
      <MonthTitle className={styles.switcherTitle} />
      <MonthStepper />
    </div>
  )
}
