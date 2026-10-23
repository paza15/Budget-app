import type { ReactNode } from 'react'
import { Coin } from '@/ui/Coin'
import styles from '@/ui/EmptyState.module.css'
import { Icon } from '@/ui/Icon'
import type { UiIconName } from '@/ui/icons/manifest'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface EmptyStateProps extends TestIdProps {
  title: string
  message?: string
  /** Usually a secondary md Button that adds the first item. */
  action?: ReactNode
  /** The glyph in the coin, drawn light where generated. Default 'daily' (a receipt). */
  icon?: UiIconName
  className?: string
}

/**
 * What a screen or card shows before it has content (docs/DESIGN.md §9.20): centred, a 56px coin
 * with a light 28 glyph in --ink-2, the title in Headline, the message in Subhead --ink-2 (max 280
 * wide), then the action. The copy invites the next step.
 */
export function EmptyState({
  title,
  message,
  action,
  icon = 'daily',
  className,
  'data-testid': testId,
  'data-id': dataId,
}: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, className)} data-testid={testId} data-id={dataId}>
      <Coin size="md" tone="muted" className={styles.coin}>
        <Icon name={icon} weight="light" size={28} />
      </Coin>
      <h2 className={styles.title}>{title}</h2>
      {message && <p className={styles.message}>{message}</p>}
      {action !== undefined && <div className={styles.action}>{action}</div>}
    </div>
  )
}
