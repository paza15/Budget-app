import type { ReactNode } from 'react'
import styles from '@/features/you/data/StatusRow.module.css'
import { Icon, type UiIconName } from '@/ui'

export interface StatusRowProps {
  /**
   * good: a check-circle in --good ("Protected from automatic cleanup" is --good-ink, DESIGN.md
   * §4.4). warning: the warning triangle in --warning. critical: the octagon in --critical.
   */
  tone: 'good' | 'warning' | 'critical'
  /**
   * The status words in the tone's ink ("Not protected:"); the explanation after them stays --ink,
   * so a long sentence does not shout. Without a lead the whole text takes the tone's ink.
   */
  lead?: string
  children: ReactNode
}

const ICONS: Readonly<Record<StatusRowProps['tone'], UiIconName>> = {
  good: 'on-track',
  warning: 'warning',
  critical: 'critical',
}

/**
 * A status line in an inset group: the tone's icon and words, never colour alone (DESIGN.md §4.4).
 * It is a row of the group, so the group's hairlines separate it from the rows around it.
 */
export function StatusRow({ tone, lead, children }: StatusRowProps) {
  return (
    <div className={styles.row} data-row="" data-tone={tone}>
      <Icon name={ICONS[tone]} size={20} className={styles.icon} />
      {lead === undefined ? (
        <p className={styles.toned}>{children}</p>
      ) : (
        <p className={styles.text}>
          <span className={styles.lead}>{lead}</span> {children}
        </p>
      )}
    </div>
  )
}
