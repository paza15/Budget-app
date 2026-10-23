import { MASKED, type MoneySign } from '@/domain/money'
import type { Cents } from '@/domain/types'
import styles from '@/ui/Money.module.css'
import { useMoneyFormatContext } from '@/ui/MoneyFormatContext'
import { cx, withTrueMinus } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

/** Accessible name of a masked amount (docs/SPEC.md §4.1). */
export const MASKED_LABEL = 'Amount hidden'

export interface MoneyProps extends TestIdProps {
  cents: Cents
  /** Default 'auto', or 'always' for the income tone. */
  sign?: MoneySign
  /** Default true: lists always show cents. */
  showCents?: boolean
  /**
   * Default 'default' (inherits the text colour). 'income' adds a plus sign unless `sign` says
   * otherwise, in ink: money never takes the accent or a status colour except over budget.
   * 'muted' is --ink-2 (paid fixed costs, secondary figures). 'critical' is --critical-ink.
   */
  tone?: 'default' | 'income' | 'muted' | 'critical'
  className?: string
}

/**
 * An amount in the user's money format with a true minus. It takes the font of its context: serif
 * in list cells, SF Pro inside sentences (docs/DESIGN.md §5.2). Never wraps. While amounts are
 * hidden it shows "•••", named "Amount hidden".
 */
export function Money({
  cents,
  sign,
  showCents,
  tone = 'default',
  className,
  'data-testid': testId,
  'data-id': dataId,
}: MoneyProps) {
  const money = useMoneyFormatContext()
  const classes = cx(styles.money, styles[tone], className)
  if (money.masked) {
    // "•••" must read as words ("Amount hidden"), and an <img> cannot hold text.
    return (
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      <span role="img" aria-label={MASKED_LABEL} className={cx(classes, styles.masked)} data-testid={testId} data-id={dataId}>
        {MASKED}
      </span>
    )
  }
  const text = money.format(cents, { sign: sign ?? (tone === 'income' ? 'always' : 'auto'), showCents })
  return (
    <span className={classes} data-tone={tone} data-testid={testId} data-id={dataId}>
      {withTrueMinus(text)}
    </span>
  )
}
