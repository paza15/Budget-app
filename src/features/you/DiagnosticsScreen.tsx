import { useState } from 'react'
import { useNav } from '@/app/nav'
import {
  BUILD_ID,
  readPlatformFacts,
  type PlatformFacts,
  usePlatformAuthenticator,
  useViewportFacts,
  useWorkerFacts,
} from '@/features/you/data/diagnostics'
import { useSafeAreaInsets } from '@/features/you/data/SafeAreaProbe'
import { useStorageStatus } from '@/store/persistence'
import { ListRow, Screen, Section } from '@/ui'

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No'
}

/** "Yes", "No", or what a missing answer means. */
function maybe(value: boolean | null | undefined, unknown: string): string {
  if (value === undefined) return 'Checking…'
  return value === null ? unknown : yesNo(value)
}

/** "59 px", "0.5 px". */
function px(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Not reported' : `${value} px`
}

const DISPLAY_MODE_NAMES: Readonly<Record<NonNullable<PlatformFacts['displayMode']>, string>> = {
  fullscreen: 'Full screen',
  standalone: 'Standalone',
  'minimal-ui': 'Minimal UI',
  browser: 'Browser',
}

/** "ok" → "OK"; the other phases read as words ("Write failed"). */
function phaseLabel(phase: string): string {
  if (phase === 'ok') return 'OK'
  const words = phase.replaceAll('-', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * You → About → five taps on the version (docs/SPEC.md §3.7): how the app runs on this device, for
 * finding problems. Platform, safe areas and viewports (live), storage, the service worker, Face ID
 * and the build. It never shows an amount.
 */
export function DiagnosticsScreen() {
  const [platform] = useState(readPlatformFacts)
  const viewport = useViewportFacts()
  const { probe, insets } = useSafeAreaInsets()
  const worker = useWorkerFacts()
  const authenticator = usePlatformAuthenticator()
  const phase = useStorageStatus((s) => s.phase)
  const persisted = useStorageStatus((s) => s.persisted)
  const saving = useStorageStatus((s) => s.saving)
  const storageError = useStorageStatus((s) => s.error)

  return (
    <Screen title="Diagnostics" largeTitle onBack={() => useNav.getState().pop()} backLabel="About">
      {probe}
      <Section variant="form" title="App">
        <ListRow title="Version" detail={__APP_VERSION__} />
        <ListRow title="Build" detail={BUILD_ID} />
        <ListRow title="Secure context" detail={yesNo(platform.secureContext)} />
        <ListRow title="Standalone" detail={maybe(platform.standalone, 'Not reported')} />
        <ListRow
          title="Display mode"
          detail={platform.displayMode === null ? 'Not reported' : DISPLAY_MODE_NAMES[platform.displayMode]}
        />
      </Section>

      <Section variant="form" title="Screen">
        <ListRow title="Safe area top" detail={px(insets?.top)} />
        <ListRow title="Safe area right" detail={px(insets?.right)} />
        <ListRow title="Safe area bottom" detail={px(insets?.bottom)} />
        <ListRow title="Safe area left" detail={px(insets?.left)} />
        <ListRow title="Window" detail={`${viewport.innerWidth} × ${viewport.innerHeight} px`} />
        <ListRow title="Visual viewport height" detail={px(viewport.visualHeight)} />
        <ListRow title="Visual viewport top" detail={px(viewport.visualTop)} />
      </Section>

      <Section variant="form" title="Storage">
        <ListRow title="Phase" detail={phaseLabel(phase)} />
        <ListRow title="Saving now" detail={yesNo(saving)} />
        <ListRow title="Protected from cleanup" detail={maybe(persisted, 'Not reported')} />
        <ListRow title="Last storage error" subtitle={storageError ?? 'None'} />
      </Section>

      <Section variant="form" title="Service worker">
        <ListRow title="Supported" detail={worker === null ? 'Checking…' : yesNo(worker.supported)} />
        <ListRow title="Registered" detail={worker === null ? 'Checking…' : yesNo(worker.registered)} />
        <ListRow title="Controls this page" detail={worker === null ? 'Checking…' : yesNo(worker.controlled)} />
        <ListRow title="New version waiting" detail={worker === null ? 'Checking…' : yesNo(worker.waiting)} />
      </Section>

      <Section
        variant="form"
        title="Device"
        footer="These details help find problems with the app. They never include amounts, and they stay on this iPhone."
      >
        <ListRow title="Face ID or Touch ID" detail={maybe(authenticator, 'Unknown')} />
        <ListRow title="Browser" subtitle={platform.userAgent || 'Not reported'} />
      </Section>
    </Screen>
  )
}
