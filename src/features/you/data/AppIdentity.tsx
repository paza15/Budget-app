import styles from '@/features/you/data/AppIdentity.module.css'
import { Icon } from '@/ui'

export interface AppIdentityProps {
  version: string
  /** A tap on the card; About counts five of them to open Diagnostics. */
  onTap(): void
}

/**
 * The top of About (docs/SPEC.md §3.7): the app's mark, "On a Budget" and its version, as one
 * inset group laid out like the profile card on You (DESIGN.md §9.9). It is a button without a
 * chevron: tapping the version five times opens Diagnostics, a page for finding problems.
 */
export function AppIdentity({ version, onTap }: AppIdentityProps) {
  return (
    <div className={styles.group}>
      <button type="button" className={styles.card} onClick={onTap}>
        <span className={styles.mark} aria-hidden="true">
          <Icon name="logo" size={44} />
        </span>
        {/* The space keeps the two lines apart in the button's name; flex layout ignores it. */}
        <span className={styles.text}>
          <span className={styles.name}>On a Budget</span>{' '}
          <span className={styles.version}>Version {version}</span>
        </span>
      </button>
    </div>
  )
}
