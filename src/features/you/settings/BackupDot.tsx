import styles from './BackupDot.module.css'

/**
 * The reminder dot on the Backup row while a backup is due (docs/SPEC.md §3.7): 8px --critical,
 * as on the Home monogram (EXTRAS.md §3.2). Decorative: the row's name says "backup due".
 */
export function BackupDot() {
  return <span className={styles.dot} aria-hidden="true" data-testid="backup-due" />
}
