import { create } from 'zustand'
import { flushSaves } from '@/store/persistence'

export interface PwaState {
  /** A new version is installed and waiting; the update banner offers Reload. */
  updateReady: boolean
}

/** Update checks run at most this often (docs/SPEC.md §7). */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

/** How long applyUpdate waits for the new version to take over before it reloads anyway. */
export const RELOAD_FALLBACK_MS = 3000

export const usePwaStore = create<PwaState>()(() => ({ updateReady: false }))

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>

// Module state: registration happens once per page (main.tsx calls it before the first render).
let started = false
let updateServiceWorker: UpdateServiceWorker | null = null
let registration: ServiceWorkerRegistration | null = null
let lastCheckAt: number | null = null
let reloading = false

/**
 * Registers the service worker (production only) and checks for updates at start and when the app
 * becomes visible, at most hourly and only online (docs/SPEC.md §5.7, §7): a Home Screen app that
 * comes back from the background does not reload, so nothing else would look for a new version.
 */
export function registerServiceWorker(): void {
  if (started || !import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  started = true
  // Loaded on demand: the virtual module exists only in Vite builds, so modules that merely read
  // usePwaStore (and their tests) never need it.
  void import('virtual:pwa-register').then(
    ({ registerSW }) => {
      updateServiceWorker = registerSW({
        onNeedRefresh: () => usePwaStore.setState({ updateReady: true }),
        // The new version controls the page now: save, then load it.
        onNeedReload: () => void reloadWhenSaved(),
        onRegisteredSW: (_scriptUrl, registered) => {
          if (!registered) return
          registration = registered
          checkForUpdate()
          document.addEventListener('visibilitychange', onVisibilityChange)
        },
        onRegisterError: (error: unknown) => console.warn('The service worker could not be registered.', error),
      })
    },
    (error: unknown) => console.warn('The service worker could not be loaded.', error),
  )
}

/**
 * Saves pending changes, then activates the waiting version; the page reloads once it has taken
 * over (onNeedReload). Without a waiting version, or if the hand-over never comes, it reloads anyway.
 */
export async function applyUpdate(): Promise<void> {
  await settleSaves()
  const update = updateServiceWorker
  if (update === null) {
    await reloadWhenSaved()
    return
  }
  await update(true)
  setTimeout(() => void reloadWhenSaved(), RELOAD_FALLBACK_MS)
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'visible') checkForUpdate()
}

function checkForUpdate(): void {
  const current = registration
  if (current === null || !navigator.onLine) return
  const now = Date.now()
  // A clock that went back (now < lastCheckAt) must not block checks for hours.
  if (lastCheckAt !== null && now >= lastCheckAt && now - lastCheckAt < UPDATE_CHECK_INTERVAL_MS) return
  lastCheckAt = now
  current.update().catch(() => {
    // The server could not be reached after all: the next time the app becomes visible may retry.
    if (lastCheckAt === now) lastCheckAt = null
  })
}

async function reloadWhenSaved(): Promise<void> {
  if (reloading) return
  reloading = true
  await settleSaves()
  location.reload()
}

/** Waits for pending saves. A failed save never blocks a reload: persistence keeps a rescue copy (§5.4 rule 4). */
async function settleSaves(): Promise<void> {
  try {
    await flushSaves()
  } catch {
    // Reported by the storage status; nothing to add here.
  }
}
