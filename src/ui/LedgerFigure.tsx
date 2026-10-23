import type { Ref } from 'react'
import { MASKED } from '@/domain/money'
import type { Cents } from '@/domain/types'
import styles from '@/ui/LedgerFigure.module.css'
import { MASKED_LABEL } from '@/ui/Money'
import { useMoneyFormatContext } from '@/ui/MoneyFormatContext'
import { cx, withTrueMinus } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface LedgerFigureProps extends TestIdProps {
  cents: Cents
  /**
   * The bottom line ("= Left 234,72 €", the Fixed "Total"): 600 weight, and the currency unit hung
   * outside the figure's box, in the 20px margin column after it (before it for prefix locales).
   */
  result?: boolean
  /** 'critical' turns the figure and its unit --critical-ink (over budget). Default 'default'. */
  tone?: 'default' | 'critical'
  /**
   * The figure's box, without the hanging unit. To span the sum rule and the double rule over the
   * widest figure (docs/DESIGN.md §9.6), use useLedgerColumn on the ledger instead of measuring
   * these boxes once: it measures again when the font loads or a figure changes.
   */
  ref?: Ref<HTMLSpanElement>
  className?: string
}

/**
 * A figure of the ledger (docs/DESIGN.md §2, §9.6): a bare serif number, tabular and right-aligned,
 * so figures stacked in a column line up on the decimal separator. Addends carry no unit; the result
 * adds the hanging unit from MoneyFormat.parts. Negative amounts use a true minus. Masked amounts
 * show "•••" in --ink-3 without a unit. useLedgerColumn spans the ledger's rules over the widest
 * figure.
 */
export function LedgerFigure({
  cents,
  result = false,
  tone = 'default',
  ref,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: LedgerFigureProps) {
  const money = useMoneyFormatContext()
  const classes = cx(styles.figure, result && styles.result, tone === 'critical' && styles.critical, className)
  if (money.masked) {
    return (
      <span ref={ref} className={cx(classes, styles.masked)} data-testid={testId} data-id={dataId}>
        {/* "•••" must read as words, and an <img> cannot hold text. */}
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
        <span role="img" aria-label={MASKED_LABEL}>
          {MASKED}
        </span>
      </span>
    )
  }
  const parts = money.parts(cents)
  const number = withTrueMinus(parts.number)
  return (
    <span ref={ref} className={classes} data-testid={testId} data-id={dataId}>
      {result && parts.symbolFirst && <span className={cx(styles.unit, styles.before)}>{parts.symbol}</span>}
      {number}
      {result && !parts.symbolFirst && <span className={cx(styles.unit, styles.after)}>{parts.symbol}</span>}
    </span>
  )
}
