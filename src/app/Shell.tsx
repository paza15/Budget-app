import { Activity, useEffect } from 'react'
import { reopenDraftOnce } from '@/app/drafts'
import { TAB_IDS, useNav } from '@/app/nav'
import { ScreenStack } from '@/app/ScreenStack'
import { SheetHost } from '@/app/SheetHost'
import { TabBar } from '@/app/TabBar'
import styles from './Shell.module.css'

/**
 * The onboarded app (docs/SPEC.md §5.5): the four tab stacks, the tab bar and open sheets. Every
 * tab stays mounted inside <Activity>, hidden while another tab shows, so filters, search text,
 * scroll positions and pushed screens survive switching tabs.
 */
export function Shell() {
  const tab = useNav((s) => s.tab)

  // At start, a recent draft of a new expense or fixed cost reopens its sheet (§5.10 rule 4).
  useEffect(() => {
    reopenDraftOnce()
  }, [])

  return (
    <div className={styles.shell}>
      {TAB_IDS.map((t) => (
        <Activity key={t} mode={t === tab ? 'visible' : 'hidden'}>
          <ScreenStack tab={t} />
        </Activity>
      ))}
      <TabBar />
      <SheetHost />
    </div>
  )
}
