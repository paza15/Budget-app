import type { CSSProperties, ReactNode } from 'react'
import type { BudgetStatus } from '@/domain/summary'
import { Icon } from '@/ui/Icon'
import styles from '@/ui/Meter.module.css'
import { MASKED_LABEL, Money } from '@/ui/Money'
import { useMoneyFormatContext } from '@/ui/MoneyFormatContext'
import { cx, withTrueMinus } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface MeterProps extends TestIdProps {
  /** Amount used, in cents (spent on the category). May exceed `max`. */
  value: number
  /** The limit, in cents. */
  max: number
  /** warning and over also show an icon and words, never colour alone. */
  status: BudgetStatus
  /** Accessible name, e.g. "Groceries limit". */
  label: string
  /**
   * Today's share of the month (0–1) in the current month: a 1 × 12 --ink-2 notch, so a limit that
   * runs ahead of time shows without words. Leave out for other months.
   */
  timeRatio?: number | null
  /** Shows the status line under the bar ("61,40 € left" … "of 180,00 €"). Default true. */
  showStatus?: boolean
  /** Writes the warning out: "Near the limit, 1,50 € left" (category detail). Otherwise the words are for assistive technology only. */
  verbose?: boolean
  /** Replaces "of {max}" at the end of the status line, e.g. "Day 18 of 31". */
  trailing?: ReactNode
  className?: string
}

/**
 * How much of a monthly limit is used (docs/DESIGN.md §9.21): a 4pt bar on --track filled in --ink,
 * --warning-mark near the limit, and --critical with an overflow nub when over; then the status line
 * in Footnote: "61,40 € left", a warning triangle with "1,50 € left", or an octagon with "Over by
 * 6,60 €", and "of 180,00 €" at the end, under the amount.
 */
export function Meter({
  value,
  max,
  status,
  label,
  timeRatio = null,
  showStatus = true,
  verbose = false,
  trailing,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: MeterProps) {
  const money = useMoneyFormatContext()
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : value > 0 ? 1 : 0
  const over = status === 'over'
  const remaining = over ? value - max : Math.max(0, max - value)
  const amount = (cents: number) => (money.masked ? MASKED_LABEL : withTrueMinus(money.format(cents)))
  // "38,50 € of 40,00 €, near the limit, 1,50 € left" (docs/DESIGN.md §9.21).
  const valueText = [
    `${amount(value)} of ${amount(max)}`,
    status === 'warning' ? 'near the limit' : null,
    over ? `over by ${amount(remaining)}` : `${amount(remaining)} left`,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div className={cx(styles.meter, styles[status], className)} data-status={status} data-testid={testId} data-id={dataId}>
      {/* The native meter carries the semantics; the bar below draws it. */}
      <meter
        className="visually-hidden"
        aria-label={label}
        aria-valuetext={valueText}
        min={0}
        max={Math.max(max, 1)}
        value={Math.min(Math.max(value, 0), Math.max(max, 1))}
      />
      <div aria-hidden="true" className={styles.bar} style={{ '--ratio': ratio } as CSSProperties}>
        <span className={styles.fill} />
        {over && <span className={styles.nub} />}
        {timeRatio !== null && (
          <span className={styles.now} style={{ '--at': Math.min(1, Math.max(0, timeRatio)) } as CSSProperties} />
        )}
      </div>
      {showStatus && (
        <div className={styles.status}>
          <span className={styles.lead}>
            {over && <Icon name="critical" size={14} className={styles.icon} />}
            {status === 'warning' && <Icon name="warning" size={14} className={styles.icon} />}
            {over ? (
              <span>
                Over by <Money cents={remaining} />
              </span>
            ) : (
              <span>
                {status === 'warning' && (
                  <span className={verbose ? undefined : 'visually-hidden'}>Near the limit, </span>
                )}
                <Money cents={remaining} /> left
              </span>
            )}
          </span>
          <span className={styles.of}>
            {trailing ?? (
              <>
                of <Money cents={max} />
              </>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
