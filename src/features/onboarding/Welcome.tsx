import { useRef, useState } from 'react'
import type { AppData } from '@/domain/types'
import styles from '@/features/onboarding/Welcome.module.css'
import { BackupFileInput, importWithConfirm } from '@/features/you/backupIO'
import { getData } from '@/store/appStore'
import { Button, Engraving, Icon, type UiIconName } from '@/ui'

export interface WelcomeProps {
  onStart(): void
  /** A backup replaced the data; `before` is the data it replaced (Undo brings that back). */
  onRestored(before: AppData): void
}

const FEATURES: readonly { icon: UiIconName; text: string }[] = [
  { icon: 'fixed', text: 'Fixed costs are counted for you every month.' },
  { icon: 'tap', text: 'Daily spending takes two taps.' },
  { icon: 'lock', text: 'Nothing leaves your phone unless you export it.' },
]

/** The app icon from public/ (the one on the Home Screen), so a new icon shows here as well. */
const ICON_BASE = import.meta.env.BASE_URL

/**
 * Step 1 (docs/SPEC.md §3.9, DESIGN.md §9.25): the certificate moment. The app icon sits in the
 * engraved rosette; the rosette gives way on short screens before anything has to scroll. "Restore
 * from a backup" runs the import of §3.7 with the restored data kept in onboarding, which then goes
 * on at the lock step: the lock is never part of a backup.
 */
export function Welcome({ onStart, onRestored }: WelcomeProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [restoring, setRestoring] = useState(false)

  const onFile = async (file: File) => {
    const before = getData()
    setRestoring(true)
    try {
      // Never rejects: it asks before replacing anything and explains failures in a toast.
      if (await importWithConfirm(file, { continueOnboarding: true })) onRestored(before)
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className={styles.welcome}>
      <div className={styles.body}>
        <div className={styles.rosette}>
          <Engraving kind="rosette" className={styles.engraving} />
          <img
            className={styles.icon}
            src={`${ICON_BASE}pwa-192.png`}
            srcSet={`${ICON_BASE}pwa-192.png 192w, ${ICON_BASE}pwa-512.png 512w`}
            sizes="92px"
            width={92}
            height={92}
            alt=""
            draggable={false}
          />
        </div>
        <h1 className={styles.title}>On a Budget</h1>
        <p className={styles.lead}>Your monthly budget, kept on this iPhone.</p>
        <ul className={styles.features}>
          {FEATURES.map((feature) => (
            <li key={feature.icon} className={styles.feature}>
              <Icon name={feature.icon} weight="light" size={28} />
              <span>{feature.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.actions}>
        <Button variant="primary" size="lg" block onClick={onStart} disabled={restoring}>
          Get started
        </Button>
        <Button
          variant="plain"
          size="lg"
          block
          onClick={() => fileInput.current?.click()}
          disabled={restoring}
          aria-busy={restoring || undefined}
        >
          Restore from a backup
        </Button>
        <BackupFileInput ref={fileInput} onFile={(file) => void onFile(file)} />
      </div>
    </div>
  )
}
