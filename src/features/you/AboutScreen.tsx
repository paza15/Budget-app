import { useRef } from 'react'
import { useNav } from '@/app/nav'
import { InstallHint } from '@/features/pwa/InstallHint'
import { AppIdentity } from '@/features/you/data/AppIdentity'
import { Notices } from '@/features/you/data/Notices'
import { formatBytes, useStorageUsage } from '@/features/you/data/storageUsage'
import { StorageProtection } from '@/features/you/data/StorageProtection'
import { useData } from '@/store/hooks'
import { ListRow, Screen, Section } from '@/ui'

/** Taps on the version that open Diagnostics, each within this long of the one before (§3.7). */
const DIAGNOSTICS_TAPS = 5
const TAP_WINDOW_MS = 1500

const DATA_FOOTER =
  "Your entries are kept only in this Home Screen app, on this iPhone. The app never sends them anywhere: there's no account, no server and no analytics. It goes online only to fetch new versions of itself, and anyone else who opens its address gets their own empty app."

/**
 * You → About (docs/SPEC.md §3.7): the version (five taps open Diagnostics), where the data lives
 * and whether iOS may clear it, how to install the app, the open-source notices and "Erase all
 * data".
 */
export function AboutScreen() {
  const locale = useData((d) => d.settings.locale)
  const usage = useStorageUsage()
  // Read and written only in the tap handler.
  const taps = useRef({ count: 0, at: 0 })

  const countTap = (): void => {
    const now = performance.now()
    const t = taps.current
    t.count = now - t.at <= TAP_WINDOW_MS ? t.count + 1 : 1
    t.at = now
    if (t.count < DIAGNOSTICS_TAPS) return
    t.count = 0
    useNav.getState().push({ name: 'you.diagnostics' })
  }

  return (
    <Screen title="About" largeTitle onBack={() => useNav.getState().pop()} backLabel="You">
      <AppIdentity version={__APP_VERSION__} onTap={countTap} />

      <Section variant="form" title="Where your data lives" footer={DATA_FOOTER}>
        {typeof usage === 'number' && <ListRow title="Space used" detail={formatBytes(usage, locale)} />}
        <StorageProtection />
      </Section>

      <InstallHint variant="inline" />

      <Notices />

      <Section footer="Deletes everything on this iPhone, including the app lock. Export a backup first to keep your entries.">
        <ListRow
          title="Erase all data"
          destructive
          onClick={() => useNav.getState().openSheet({ name: 'erase' })}
        />
      </Section>
    </Screen>
  )
}
