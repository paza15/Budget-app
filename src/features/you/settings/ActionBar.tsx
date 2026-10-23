import type { ReactNode } from 'react'
import styles from './ActionBar.module.css'

/** A full-width action under a settings page's groups, 26 below the last footer, at the gutter. */
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className={styles.bar}>{children}</div>
}
