import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { exportBackupFromShell } from '@/app/backupAction'
import { startOfDayMs } from '@/app/clock'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useNav } from '@/app/nav'
import { LS_KEYS } from '@/domain/constants'
import { needsBackupReminder } from '@/domain/queries'
import { unreviewedClosedMonth } from '@/domain/review'
import type { AppData } from '@/domain/types'
import { InstallHint, installHintPending } from '@/features/pwa/InstallHint'
import { applyUpdate, usePwaStore } from '@/features/pwa/sw'
import { ReviewBanner } from '@/features/review/ReviewBanner'
import { useAppStore } from '@/store/appStore'
import { isBlockingPhase, STORAGE_MESSAGES, useStorageStatus, type StoragePhase } from '@/store/persistence'
import { useSecurityStore } from '@/store/securityStore'
import { useToday } from '@/store/today'
import { Banner } from '@/ui'
import styles from './AppBanners.module.css'

/**
 * App-level banners (docs/SPEC.md §3.10, §3.15; DESIGN.md §9.19; EXTRAS.md §1.6). They sit in the
 * content flow under the header of the screen the user sees: ScreenStack reports that screen's
 * layer (visibleScreenRef), its Screen renders an empty slot marked `data-banner-slot` after the
 * nav and title rows, and AppBanners, mounted outside the gates next to the toasts, renders into
 * it. Without such a slot (onboarding, a screen that has none) they go into the BannerOutlet at the
 * top of #app-root. Either way they are inside #app-root: inert under the lock screen like the rest
 * of the app, and absent while a cold-start lock shows alone.
 *
 * - Storage (banner-storage, critical): a failed write, saving off after "Use without saving", and
 *   the rows a load had to skip. They show on every screen, beside any other banner.
 * - At most one non-critical banner, the first that applies in this order: update ready
 *   (banner-update) on a tab root, then on Home's root the install hint (banner-install, from the
 *   pwa feature), the closed month's review (ReviewBanner, current period only) and the backup
 *   nudge (banner-backup). When one is dismissed, the next that applies takes its place at once.
 */

const DAY_MS = 86_400_000
/** The nudge shows 60 days after the last backup, or 30 days after install without one. */
const NUDGE_AFTER_BACKUP_MS = 60 * DAY_MS
const NUDGE_WITHOUT_BACKUP_MS = 30 * DAY_MS
/** "Not now" hides the nudge for 14 days. */
const NUDGE_SNOOZE_MS = 14 * DAY_MS

/** The attribute Screen puts on its banner slot. */
export const BANNER_SLOT_ATTRIBUTE = 'data-banner-slot'

interface BannerState {
  /** The app-level slot (BannerOutlet). */
  outlet: HTMLElement | null
  /** The banner slot of the screen the user sees, when its Screen renders one. */
  slot: HTMLElement | null
  /**
   * Session state that outlives the banners: they remount whenever the visible screen changes.
   * "Not now" on the damaged-rows banner hides it until the app is opened again.
   */
  droppedDismissed: boolean
  /** "Not now" on the backup nudge, also kept here for when localStorage is unavailable. */
  nudgeSnoozedUntil: number
  /**
   * "Don't show again" on the install hint in this session: the next banner takes the place at
   * once, and the hint stays away even when storage could not keep the dismissal.
   */
  installDismissed: boolean
}

const useBanners = create<BannerState>()(() => ({
  outlet: null,
  slot: null,
  droppedDismissed: false,
  nudgeSnoozedUntil: 0,
  installDismissed: false,
}))

/** For tests: forget this session's dismissals. */
export function __resetBannersForTests(): void {
  useBanners.setState({ droppedDismissed: false, nudgeSnoozedUntil: 0, installDismissed: false })
}

function setOutlet(element: HTMLDivElement | null): void {
  if (useBanners.getState().outlet !== element) useBanners.setState({ outlet: element })
}

/** The fallback place for the banners: App renders it at the top of #app-root. Empty, it takes no space. */
export function BannerOutlet() {
  return <div ref={setOutlet} className={styles.outlet} />
}

/**
 * Ref callback for the layer of the screen the user sees (ScreenStack). The banners move into the
 * slot that screen renders until the layer is no longer the visible one; a screen without a slot
 * sends them back to the BannerOutlet. A screen may render its Screen (and so its slot) later than
 * the layer, or replace it (a remount under a new key, an error fallback): the layer is watched,
 * and the banners follow the slot that is there now.
 */
export function visibleScreenRef(layer: HTMLElement | null): (() => void) | undefined {
  // React passes null only when it has no cleanup left to call: the cleanup below already ran.
  if (layer === null) return undefined
  const find = (): HTMLElement | null => layer.querySelector<HTMLElement>(`[${BANNER_SLOT_ATTRIBUTE}]`)
  let slot = find()
  useBanners.setState({ slot })
  const follow = (): void => {
    // Most changes in the screen leave the slot where it is: nothing to look up.
    if (slot !== null && layer.contains(slot)) return
    const next = find()
    if (next === slot) return
    const previous = slot
    slot = next
    // Another screen may have become the visible one meanwhile; then it owns the place.
    if (useBanners.getState().slot === previous) useBanners.setState({ slot: next })
  }
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(follow) : null
  observer?.observe(layer, { childList: true, subtree: true })
  return () => {
    observer?.disconnect()
    // The next visible screen may have registered first.
    if (useBanners.getState().slot === slot) useBanners.setState({ slot: null })
  }
}

/** Renders the banners that apply into the visible screen's slot or the outlet; nothing without either. */
export function AppBanners() {
  const slot = useBanners((s) => s.slot)
  const outlet = useBanners((s) => s.outlet)
  const target = slot ?? outlet
  if (target === null) return null
  // A failing banner only takes the banners with it. A new target remounts them.
  return createPortal(
    <ErrorBoundary level="silent">
      <Banners inScreen={target === slot} />
    </ErrorBoundary>,
    target,
  )
}

function Banners({ inScreen }: { inScreen: boolean }) {
  const phase = useStorageStatus((s) => s.phase)
  const onHomeRoot = useNav((s) => s.tab === 'home' && s.stacks.home.length === 0)
  // A blocking phase shows StorageScreen, which says everything itself.
  if (phase === 'loading' || isBlockingPhase(phase)) return null
  const banners = (
    <>
      <StorageBanners phase={phase} />
      {/* Each visit to Home's root starts afresh: see useNotice. */}
      <NoticeBanner key={onHomeRoot ? 'home' : 'elsewhere'} />
    </>
  )
  // A screen's slot places the banners itself (the kit's Screen: under the header, on the gutter,
  // and no space while empty), so they go straight in; the outlet needs a frame of its own.
  return inScreen ? banners : <div className={styles.atTop}>{banners}</div>
}

function reload(): void {
  window.location.reload()
}

function droppedMessage(count: number): string {
  const entries = count === 1 ? '1 damaged entry' : `${count} damaged entries`
  return `Skipped ${entries}. A copy of the original was kept.`
}

function dismissDropped(): void {
  useBanners.setState({ droppedDismissed: true })
}

function StorageBanners({ phase }: { phase: StoragePhase }) {
  const error = useStorageStatus((s) => s.error)
  const dropped = useStorageStatus((s) => s.droppedOnLoad)
  const droppedDismissed = useBanners((s) => s.droppedDismissed)
  const outOfSpace = error === STORAGE_MESSAGES.outOfSpace
  return (
    <>
      {phase === 'write-failed' && (
        <Banner
          tone="critical"
          data-testid="banner-storage"
          action={
            outOfSpace
              ? { label: 'Export backup', onClick: () => void exportBackupFromShell() }
              : { label: 'Reload', onClick: reload }
          }
        >
          {outOfSpace ? STORAGE_MESSAGES.outOfSpace : STORAGE_MESSAGES.writeFailed}
        </Banner>
      )}
      {phase === 'memory-only' && (
        <Banner tone="critical" data-testid="banner-storage">
          The app isn&apos;t saving. Entries made now will be lost when you close it.
        </Banner>
      )}
      {dropped > 0 && !droppedDismissed && (
        <Banner tone="warning" data-testid="banner-storage" onDismiss={dismissDropped}>
          {droppedMessage(dropped)}
        </Banner>
      )}
    </>
  )
}

/** The non-critical banners. They share one place, taken by the first that applies, in this order. */
type Notice = 'update' | 'install' | 'review' | 'backup'

function readSnoozedUntil(): number {
  try {
    const value = Number(localStorage.getItem(LS_KEYS.backupNudgeUntil))
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

/** The reminder applies and enough time has passed since the last backup (or the install). */
function nudgeDue(data: AppData, now: number): boolean {
  if (!needsBackupReminder(data, now)) return false
  const { lastBackupAt, createdAt } = data.settings
  return lastBackupAt === null ? now - createdAt > NUDGE_WITHOUT_BACKUP_MS : now - lastBackupAt > NUDGE_AFTER_BACKUP_MS
}

/** Which non-critical banner has the place now, if any (EXTRAS.md §1.6). */
function useNotice(): Notice | null {
  const data = useAppStore((s) => s.data)
  const today = useToday()
  const updateReady = usePwaStore((s) => s.updateReady)
  const onTabRoot = useNav((s) => s.stacks[s.tab].length === 0)
  const onHomeRoot = useNav((s) => s.tab === 'home' && s.stacks.home.length === 0)
  const currentPeriod = useNav((s) => s.month === null)
  // localStorage is read once per visit to Home's root (NoticeBanner remounts for each); what the
  // banners' own buttons change in this session comes from the store, so the next banner that
  // applies takes the place at once.
  const [installPending] = useState(installHintPending)
  const installDismissed = useBanners((s) => s.installDismissed)
  const [storedSnooze] = useState(readSnoozedUntil)
  const sessionSnooze = useBanners((s) => s.nudgeSnoozedUntil)
  const now = startOfDayMs(today)
  const reviewPending = useMemo(() => unreviewedClosedMonth(data, today) !== null, [data, today])
  const backupDue = useMemo(() => nudgeDue(data, now), [data, now])

  if (!data.settings.onboarded) return null
  if (updateReady && onTabRoot) return 'update'
  if (!onHomeRoot) return null
  if (installPending && !installDismissed) return 'install'
  if (reviewPending && currentPeriod) return 'review'
  if (backupDue && now >= Math.max(storedSnooze, sessionSnooze)) return 'backup'
  return null
}

function NoticeBanner() {
  const notice = useNotice()
  const sheetOpen = useNav((s) => s.sheets.length > 0)
  const locked = useSecurityStore((s) => s.locked)
  switch (notice) {
    case 'update':
      // Shown only with no sheet open and never under the lock, but it keeps the place meanwhile,
      // so another banner does not take it for the length of a sheet.
      return sheetOpen || locked ? null : <UpdateBanner />
    case 'install':
      return <InstallHint variant="banner" onDismiss={dismissInstallHint} />
    case 'review':
      return <ReviewBanner />
    case 'backup':
      return <BackupNudge />
    default:
      return null
  }
}

function dismissInstallHint(): void {
  useBanners.setState({ installDismissed: true })
}

function reloadForUpdate(): void {
  // applyUpdate saves what is pending, activates the waiting version and reloads.
  applyUpdate().catch(reload)
}

function UpdateBanner() {
  return (
    <Banner tone="info" data-testid="banner-update" action={{ label: 'Reload', onClick: reloadForUpdate }}>
      A new version of On a Budget is ready.
    </Banner>
  )
}

function snoozeNudge(): void {
  const until = Date.now() + NUDGE_SNOOZE_MS
  try {
    localStorage.setItem(LS_KEYS.backupNudgeUntil, String(until))
  } catch {
    // Storage unavailable: the session state keeps the nudge away until the app is opened again.
  }
  useBanners.setState({ nudgeSnoozedUntil: until })
}

function BackupNudge() {
  return (
    <Banner
      tone="warning"
      icon="backup"
      data-testid="banner-backup"
      action={{ label: 'Export backup', onClick: () => void exportBackupFromShell() }}
      onDismiss={snoozeNudge}
    >
      Your entries are only on this iPhone. Export a backup to keep them safe.
    </Banner>
  )
}
