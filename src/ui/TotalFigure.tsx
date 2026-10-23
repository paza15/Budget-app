import { MASKED } from '@/domain/money'
import type { Cents } from '@/domain/types'
import { MASKED_LABEL } from '@/ui/Money'
import { useMoneyFormatContext } from '@/ui/MoneyFormatContext'
import { cx, withTrueMinus } from '@/ui/text'
import styles from '@/ui/TotalFigure.module.css'
import type { TestIdProps } from '@/ui/types'

export interface TotalFigureProps extends TestIdProps {
  cents: Cents
  /** 'critical': the figure in --critical-ink (over budget). Default 'default'. */
  tone?: 'default' | 'critical'
  /**
   * Default true: a visually hidden copy names the full amount ("38,50 €"), and hidden amounts are
   * an image named "Amount hidden". false leaves both out, for a parent that names the amount
   * itself (the wallet card button's aria-label); the figure's text is then just what is drawn.
   */
  labelled?: boolean
  className?: string
}

/**
 * A total standing alone (category detail, the Owed screen, the Wallet card; docs/DESIGN.md §5.3
 * --text-figure-lg): the serif figure with proportional figures, and its unit at --text-figure-sm
 * in --ink-2, 0.3em away on the locale's side. VoiceOver reads the full amount as one. Hidden
 * amounts show "•••" in --ink-3 without a unit, named "Amount hidden". The drawn parts carry
 * data-part="number" and data-part="unit", so a parent can restyle them (a critical unit, a rule).
 */
export function TotalFigure({
  cents,
  tone = 'default',
  labelled = true,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: TotalFigureProps) {
  const money = useMoneyFormatContext()
  if (money.masked && !labelled) {
    return (
      <span aria-hidden="true" className={cx(styles.figure, styles.masked, className)} data-testid={testId} data-id={dataId}>
        {MASKED}
      </span>
    )
  }
  if (money.masked) {
    return (
      // "•••" must read as words, and an <img> cannot hold text.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      <span role="img" aria-label={MASKED_LABEL} className={cx(styles.figure, styles.masked, className)} data-testid={testId} data-id={dataId}>
        {MASKED}
      </span>
    )
  }
  const { number, symbol, symbolFirst } = money.parts(cents)
  const drawn = (
    <>
      {symbolFirst && (
        <span className={cx(styles.unit, styles.before)} data-part="unit">
          {symbol}
        </span>
      )}
      <span className={styles.number} data-part="number">
        {withTrueMinus(number)}
      </span>
      {!symbolFirst && (
        <span className={cx(styles.unit, styles.after)} data-part="unit">
          {symbol}
        </span>
      )}
    </>
  )
  return (
    <span className={cx(styles.figure, tone === 'critical' && styles.critical, className)} data-testid={testId} data-id={dataId}>
      <span aria-hidden="true">{drawn}</span>
      {labelled && <span className="visually-hidden">{withTrueMinus(money.format(cents))}</span>}
    </span>
  )
}
