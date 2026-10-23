import type { ReactNode } from 'react'
import styles from '@/ui/ConsequenceLine.module.css'
import { Icon } from '@/ui/Icon'
import type { UiIconName } from '@/ui/icons/manifest'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface ConsequenceLineProps extends TestIdProps {
  /** 'default' --ink-2 with <strong> figures in --ink; 'warning' --warning-ink; 'critical' --critical-ink. */
  tone?: 'default' | 'warning' | 'critical'
  /** A 16px status glyph inline, 6 before the words (in --warning or --critical for those tones). */
  icon?: UiIconName
  /** Announces changes politely, e.g. while the amount is typed. */
  live?: boolean
  className?: string
  /** Phrasing content; wrap the figure in <strong> ("Leaves <strong>4,84 €</strong> for today"). */
  children?: ReactNode
}

/**
 * The line under the amount in the transaction and wallet entry sheets (docs/DESIGN.md §9.16,
 * §9.26): one centred Subhead line, 20 tall, that ends in an ellipsis rather than wrap. It keeps
 * its 20 when empty, so the sheet never changes height while typing.
 */
export function ConsequenceLine({
  tone = 'default',
  icon,
  live = false,
  className,
  children,
  'data-testid': testId,
  'data-id': dataId,
}: ConsequenceLineProps) {
  return (
    <p
      className={cx(styles.line, styles[tone], className)}
      aria-live={live ? 'polite' : undefined}
      data-testid={testId}
      data-id={dataId}
    >
      {icon !== undefined && <Icon name={icon} size={16} className={styles.icon} />}
      {children}
    </p>
  )
}
