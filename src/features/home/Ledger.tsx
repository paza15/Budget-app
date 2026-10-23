/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The ledger's rows are CSS grids (operator, label,
   figure, unit margin), and WebKit drops the table semantics of <table>, <tr> and <td> laid out as
   grids; explicit roles on the grid elements keep VoiceOver's table with row headers. */
import type { ReactNode } from 'react'
import type { MonthSummary } from '@/domain/summary'
import type { Cents } from '@/domain/types'
import { Icon, LedgerFigure, Money, Section, useLedgerColumn } from '@/ui'
import styles from './Ledger.module.css'

/** The sum rows and where each one leads (SPEC §3.1). */
export type LedgerTarget = 'income' | 'fixed' | 'savings' | 'daily'

/** A closed statement's last line: where the month's result went (DESIGN.md §9.6). */
export interface StatementLine {
  /** "Moved to your wallet:" or "Taken from your wallet:". */
  text: string
  /** The result's size, unsigned. */
  amount: Cents
}

export interface LedgerProps {
  summary: MonthSummary
  /** The section title: "This month", "Statement for September" or the period's name. */
  title: string
  /** A past period's range under its title when months start on another day ("25 Aug – 24 Sep"). */
  range?: string | null
  statement?: StatementLine | null
  onOpen(target: LedgerTarget): void
  onStatement?(): void
}

interface Addend {
  key: LedgerTarget
  operator: string
  label: string
  cents: Cents
}

/** The true minus of the operator column (U+2212). */
const MINUS = '−'

/**
 * "This month" written as a sum (DESIGN.md §2, §9.6): + Income − Fixed costs − Savings − Daily
 * spending = Left. Operators in their own column, bare figures aligned on the decimal separator, a
 * sum rule over the result and the brass double rule under it, both spanning the widest figure
 * (useLedgerColumn). Over budget the result and its double rule turn critical. Each addend opens
 * where its money is. A table with row headers for VoiceOver; a closed statement adds the line
 * saying where the month's result went.
 */
export function Ledger({ summary, title, range = null, statement = null, onOpen, onStatement }: LedgerProps) {
  const ledgerRef = useLedgerColumn<HTMLDivElement>()
  const over = summary.left < 0
  const addends: Addend[] = [
    { key: 'income', operator: '+', label: 'Income', cents: summary.income },
    { key: 'fixed', operator: MINUS, label: 'Fixed costs', cents: summary.fixed },
    // Savings is left out when it is 0.
    ...(summary.savings === 0
      ? []
      : [{ key: 'savings' as const, operator: MINUS, label: 'Savings', cents: summary.savings }]),
    { key: 'daily', operator: MINUS, label: 'Daily spending', cents: summary.daily },
  ]

  const heading: ReactNode =
    range === null ? (
      title
    ) : (
      <>
        {title}
        <span className={styles.range}>
          <span className="visually-hidden">, </span>
          {range}
        </span>
      </>
    )

  return (
    <Section title={heading}>
      <div
        ref={ledgerRef}
        className={statement === null ? styles.ledger : styles.ledgerWithStatement}
        role="table"
        aria-label={range === null ? title : `${title}, ${range}`}
      >
        {addends.map((row) => (
          <div key={row.key} className={styles.row} role="row" data-testid={`equation-${row.key}`}>
            <span className={styles.operator} aria-hidden="true">
              {row.operator}
            </span>
            <span className={styles.label} role="rowheader">
              <button type="button" className={styles.open} onClick={() => onOpen(row.key)}>
                {row.label}
              </button>
            </span>
            <span className={styles.cell} role="cell">
              <LedgerFigure cents={row.cents} />
            </span>
            <span aria-hidden="true" />
          </div>
        ))}
        <div className={styles.result} role="row" data-testid="equation-left" data-over={over || undefined}>
          <span className={styles.sumRule} aria-hidden="true" />
          <span className={styles.equals} aria-hidden="true">
            =
          </span>
          <span className={styles.resultLabel} role="rowheader">
            Left
          </span>
          <span className={styles.cell} role="cell">
            <span className={styles.doubleRule}>
              <LedgerFigure cents={summary.left} result tone={over ? 'critical' : 'default'} />
            </span>
          </span>
          <span aria-hidden="true" />
        </div>
      </div>
      {statement !== null && (
        <button type="button" className={styles.statement} onClick={onStatement} data-testid="statement-wallet">
          <span className={styles.statementText}>
            {statement.text}{' '}
            <span className={styles.statementAmount}>
              <Money cents={statement.amount} />
            </span>
          </span>
          <Icon name="chevron-right" size={14} className={styles.chevron} />
        </button>
      )}
    </Section>
  )
}
