import { useMemo } from 'react'
import { useNav } from '@/app/nav'
import { needsBackupReminder } from '@/domain/queries'
import { startOfDayMs } from '@/features/home/homeData'
import { useData, useSettings } from '@/store/hooks'
import { useToday } from '@/store/today'
import { Monogram } from '@/ui'
import styles from './SettingsButton.module.css'

function openSettings(): void {
  useNav.getState().push({ name: 'you' })
}

/**
 * The settings entry at the leading end of Home's nav row (docs/design/EXTRAS.md §3, SPEC §3): the
 * monogram medallion and "Hi, {name}" ("Hi there" without a name) as one button that pushes
 * settings on the Home stack, like the account button in Apple's apps. Its name is "Settings", or
 * "Settings, backup due" with the critical dot on the medallion; the medallion and greeting are
 * decoration. In the compact header the greeting leaves and the medallion stays the button.
 */
export function SettingsButton() {
  const { name, avatar } = useSettings()
  const data = useData((d) => d)
  const today = useToday()
  // Day-based like the rest of the reminder: it may light up at most a day late.
  const backupDue = useMemo(() => needsBackupReminder(data, startOfDayMs(today)), [data, today])
  const trimmed = name.trim()

  return (
    <button
      type="button"
      className={styles.button}
      data-testid="open-settings"
      aria-label={backupDue ? 'Settings, backup due' : 'Settings'}
      onClick={openSettings}
    >
      <span className={styles.medal}>
        {/* Without a name or an emoji the medallion holds a person (EXTRAS.md §3.1). */}
        <Monogram name={trimmed} avatar={avatar} />
        {backupDue && <span className={styles.dot} aria-hidden="true" data-part="backup-dot" />}
      </span>
      <span className={styles.greeting} aria-hidden="true">
        {trimmed === '' ? 'Hi there' : `Hi, ${trimmed}`}
      </span>
    </button>
  )
}
