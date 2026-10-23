import type { ReactNode } from 'react'
import styles from '@/features/you/data/NoteRow.module.css'

/**
 * A row of explanation inside an inset group, in Body --ink-2: what a group shows when it has
 * nothing to list ("No copies yet."). It is a row, so the group's hairlines treat it like one.
 */
export function NoteRow({ children }: { children: ReactNode }) {
  return (
    <p className={styles.row} data-row="">
      {children}
    </p>
  )
}
