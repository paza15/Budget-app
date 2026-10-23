import type { ReactNode } from 'react'
import styles from './SentenceRow.module.css'

/**
 * A sentence as a row of an inset group, read out when it changes (the live line of You › Month
 * starts on, docs/SPEC.md §3.7).
 */
export function SentenceRow({ children }: { children: ReactNode }) {
  return (
    <p className={styles.row} data-row="" aria-live="polite">
      {children}
    </p>
  )
}
