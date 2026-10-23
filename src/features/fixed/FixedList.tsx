import type { ReactNode } from 'react'
import type { CategoryDisplay } from '@/domain/queries'
import type { Cents, Recurring } from '@/domain/types'
import type { LineSubtitle } from '@/features/fixed/fixedModel'
import styles from '@/features/fixed/FixedList.module.css'
import { Button, CategoryBadge, ListRow, Money, PaidCheck } from '@/ui'

/**
 * The parts of the Fixed lists (docs/DESIGN.md §9.8): inset groups, category headers with their
 * subtotals, rows with the paid check, the "Today" divider, the ledger-style total and the add
 * lines. The views compose them.
 */

/** An inset group of paper: rows inside carry their own hairlines. */
export function RowGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.group, className].filter(Boolean).join(' ')}>{children}</div>
}

export interface GroupHeaderProps {
  title: string
  /** The category's coin (26pt) before the title. */
  coin?: CategoryDisplay
  /** Subtotal at the end, aligned with the row amounts. */
  total?: Cents
}

/** A category header of the "All" list: coin, name and subtotal (§9.8). */
export function GroupHeader({ title, coin, total }: GroupHeaderProps) {
  return (
    <h2 className={styles.header}>
      {coin !== undefined && <CategoryBadge icon={coin.icon} color={coin.color} size="sm" />}
      <span className={styles.headerTitle}>{title}</span>
      {total !== undefined && ' '}
      {total !== undefined && (
        <span className={styles.subtotal}>
          <Money cents={total} />
        </span>
      )}
    </h2>
  )
}

/** The subtitle of a line: its schedule, "Skipped this month" or "Set aside {amount} this month". */
export function SubtitleText({ subtitle }: { subtitle: LineSubtitle }) {
  if (subtitle.kind === 'text') return subtitle.text
  return (
    <>
      Set aside <Money cents={subtitle.amount} /> {subtitle.phrase}
    </>
  )
}

export interface RecurringRowProps {
  item: Recurring
  subtitle: ReactNode
  amount: Cents
  /** muted: paid, or not counted in this period; struck: skipped. */
  tone: 'default' | 'muted' | 'struck'
  /** The paid check of a charge line, or null for rows that cannot be ticked off. */
  check: { paid: boolean; onToggle(): void } | null
  /** The coin, where rows are not grouped under their category. */
  coin?: CategoryDisplay
  onOpen(): void
}

/**
 * A fixed cost or income (§3.5): name, schedule, amount, and on charge lines the paid check in its
 * own trailing column. Rows without a check keep that column empty so amounts stay in one column.
 * Tapping the row opens the recurring sheet.
 */
export function RecurringRow({ item, subtitle, amount, tone, check, coin, onOpen }: RecurringRowProps) {
  return (
    <ListRow
      leading={coin === undefined ? undefined : <CategoryBadge icon={coin.icon} color={coin.color} />}
      title={item.name}
      subtitle={subtitle}
      value={
        <span className={styles.amount}>
          <Money cents={amount} />
        </span>
      }
      valueTone={tone}
      trailing={
        check === null ? (
          <NoCheck />
        ) : (
          <PaidCheck paid={check.paid} name={item.name} kind={item.kind} onToggle={check.onToggle} />
        )
      }
      onClick={onOpen}
      data-testid="recurring-row"
      data-id={item.id}
    />
  )
}

/** The empty check column of a row that cannot be ticked off, so amounts stay in one column. */
export function NoCheck() {
  return <span className={styles.noCheck} />
}

/**
 * The "Today" divider (§9.8, Fixed with a chip selected, current month): what is due before today
 * sits above it, so unpaid items above it are overdue at a glance.
 */
export function TodayDivider() {
  return <div className={styles.divider}>Today</div>
}

/**
 * "Total" under the last group (§9.8): the figure between the sum rule and the brass double rule,
 * both spanning the figure only. It reconciles with "Fixed costs" on Home.
 */
export function TotalRow({ total }: { total: Cents }) {
  return (
    <div className={styles.total} data-testid="fixed-total">
      <span className={styles.totalLabel}>Total</span>{' '}
      <span className={styles.totalFigure}>
        <Money cents={total} />
      </span>
    </div>
  )
}

/** A plain button with a plus-circle at the end of a list ("Add fixed cost"). */
export function AddLine({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <div className={styles.addLine}>
      <Button variant="plain" icon="plus-circle" onClick={onClick}>
        {label}
      </Button>
    </div>
  )
}

/** The sentence under the segmented control, in --ink-2 ("{amount} this month, 4 of 6 paid"). */
export function Lede({ children }: { children: ReactNode }) {
  return <p className={styles.lede}>{children}</p>
}

/** The part of the sentence that carries the figure, in --ink. */
export function LedeStrong({ children }: { children: ReactNode }) {
  return <span className={styles.ledeStrong}>{children}</span>
}
