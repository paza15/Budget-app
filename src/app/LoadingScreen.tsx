import { Mark } from '@/app/Mark'
import styles from './LoadingScreen.module.css'

/**
 * The background with the app mark, shown until the data and the lock state have loaded
 * (docs/SPEC.md §3.10, DESIGN.md §9.24). Nothing that reads the data renders before it goes away.
 * It has no rosette, so it paints in the first frame, like the privacy cover it matches.
 */
export function LoadingScreen() {
  return (
    <output className={styles.loading} aria-busy="true">
      <Mark size={64} />
      <span className={styles.label}>Loading</span>
    </output>
  )
}
