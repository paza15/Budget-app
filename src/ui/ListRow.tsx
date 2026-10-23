import type { ReactNode } from 'react'
import { Icon } from '@/ui/Icon'
import type { UiIconName } from '@/ui/icons/manifest'
import styles from '@/ui/ListRow.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface ListRowProps extends TestIdProps {
  /** Badge or icon at the start, usually a 34px CategoryBadge. */
  leading?: ReactNode
  /** Body --ink; wraps to two lines at most. */
  title: ReactNode
  /** Subhead --ink-2, the full width under the title and the value. */
  subtitle?: ReactNode
  /** The amount: serif --text-figure, tabular, never wraps; it shares the title's first baseline. */
  value?: ReactNode
  /** 'muted': --ink-2 (paid fixed costs). 'struck': --ink-2 and struck through (skipped). 'critical': over budget. */
  valueTone?: 'default' | 'muted' | 'struck' | 'critical'
  /** A short note right-aligned under the value ("Today", "Yesterday"). */
  note?: ReactNode
  /** A setting's value in Body --ink-2 before the chevron ("System", "Euro", "1st"). */
  detail?: ReactNode
  /** A control at the end (a paid check, a toggle). It stays outside the row's button, in a 28px column. */
  trailing?: ReactNode
  /**
   * Shows a disclosure glyph in --ink-3: true or 'right' (navigation), 'updown' (a picker), 'down'
   * (expands more rows).
   */
  chevron?: boolean | 'right' | 'updown' | 'down'
  /** Makes the row (except `trailing`) one button. */
  onClick?(): void
  /** A destructive action row: the title in --critical-ink ("Delete"). */
  destructive?: boolean
  /** An action row: the title in --accent-ink ("More options", "Stop after October"). */
  tinted?: boolean
  disabled?: boolean
  /** Accessible name of the row button when its text is not enough. */
  label?: string
  /**
   * Makes a row with `onClick` a disclosure ("More options", "Settled"): aria-expanded on its
   * button, and with chevron 'down' the chevron turns over while expanded.
   */
  expanded?: boolean
  /** The id of the rows the disclosure shows (aria-controls). */
  controls?: string
  className?: string
}

const CHEVRONS: Readonly<Record<'right' | 'updown' | 'down', UiIconName>> = {
  right: 'chevron-right',
  updown: 'chevron-updown',
  down: 'chevron-down',
}

/**
 * One row of an inset group (docs/DESIGN.md §9.8): an optional coin, the title and the amount on
 * one baseline, the subtitle under both, a chevron, and a trailing control. Rows of a group are
 * separated by hairlines (the data-row convention in global.css). Each row is a size container: at
 * accessibility text sizes (below 14.4em of width) the amount moves under the title.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  value,
  valueTone = 'default',
  note,
  detail,
  trailing,
  chevron = false,
  onClick,
  destructive = false,
  tinted = false,
  disabled = false,
  label,
  expanded,
  controls,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: ListRowProps) {
  const twoLines = subtitle !== undefined || note !== undefined
  const chevronIcon = chevron === false ? null : CHEVRONS[chevron === true ? 'right' : chevron]
  const content = (
    <>
      {leading !== undefined && <span className={styles.leading}>{leading}</span>}
      <span className={styles.main}>
        <span className={styles.line1}>
          <span className={styles.title}>{title}</span>
          {detail !== undefined && <span className={styles.detail}>{detail}</span>}
          {value !== undefined && <span className={cx(styles.value, styles[valueTone])}>{value}</span>}
        </span>
        {twoLines && (
          <span className={styles.line2}>
            {subtitle !== undefined && <span className={styles.subtitle}>{subtitle}</span>}
            {note !== undefined && <span className={styles.note}>{note}</span>}
          </span>
        )}
      </span>
      {chevronIcon && (
        <Icon
          name={chevronIcon}
          size={14}
          className={cx(styles.chevron, chevron === 'down' && expanded === true && styles.turned)}
        />
      )}
    </>
  )
  return (
    <div
      className={cx(
        styles.row,
        twoLines ? styles.two : styles.one,
        leading !== undefined && styles.withLeading,
        trailing !== undefined && styles.withTrailing,
        destructive && styles.destructive,
        tinted && styles.tinted,
        disabled && styles.disabled,
        className,
      )}
      data-row={leading !== undefined ? 'coin' : ''}
      data-testid={testId}
      data-id={dataId}
    >
      {onClick ? (
        <button
          type="button"
          className={cx(styles.body, styles.button)}
          disabled={disabled}
          aria-label={label}
          aria-expanded={expanded}
          aria-controls={controls}
          onClick={onClick}
        >
          {content}
        </button>
      ) : (
        <div className={styles.body}>{content}</div>
      )}
      {trailing !== undefined && <div className={styles.trailing}>{trailing}</div>}
    </div>
  )
}
