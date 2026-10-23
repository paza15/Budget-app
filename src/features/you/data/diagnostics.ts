import { useEffect, useState, useSyncExternalStore } from 'react'
import { lockSupport } from '@/features/lock/pin'

/**
 * The facts Diagnostics shows (docs/SPEC.md §3.7): where and how the app runs, the screen's safe
 * areas and viewports, the service worker and Face ID. Never amounts. Each reader tolerates a
 * missing API, so the page also works in a plain browser tab.
 */

/** iOS sets navigator.standalone inside a Home Screen web app; other browsers lack it. */
interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean
}

const DISPLAY_MODES = ['fullscreen', 'standalone', 'minimal-ui', 'browser'] as const

export interface PlatformFacts {
  secureContext: boolean
  /** navigator.standalone, or null where the browser does not report it. */
  standalone: boolean | null
  /** The matching display-mode media feature, or null when none matches. */
  displayMode: (typeof DISPLAY_MODES)[number] | null
  userAgent: string
}

/** Facts that cannot change while the page is open. */
export function readPlatformFacts(): PlatformFacts {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as NavigatorWithStandalone)
  const media = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia : null
  return {
    secureContext: typeof window !== 'undefined' && window.isSecureContext,
    standalone: typeof nav?.standalone === 'boolean' ? nav.standalone : null,
    displayMode: media === null ? null : (DISPLAY_MODES.find((mode) => media(`(display-mode: ${mode})`).matches) ?? null),
    userAgent: nav?.userAgent ?? '',
  }
}

// ---------------------------------------------------------------------------------------------
// Viewport: a small external store, read again on every resize of the window or visual viewport

export interface ViewportFacts {
  innerWidth: number
  innerHeight: number
  /** visualViewport.height and offsetTop (the iOS keyboard changes them); null without the API. */
  visualHeight: number | null
  visualTop: number | null
}

/** One decimal: the visual viewport reports fractions of a pixel. */
function round(value: number): number {
  return Math.round(value * 10) / 10
}

let viewport: ViewportFacts | null = null

/** The same object until a value changes, as useSyncExternalStore needs. */
function readViewport(): ViewportFacts {
  const vv = window.visualViewport
  const next: ViewportFacts = {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visualHeight: vv ? round(vv.height) : null,
    visualTop: vv ? round(vv.offsetTop) : null,
  }
  const same =
    viewport !== null &&
    viewport.innerWidth === next.innerWidth &&
    viewport.innerHeight === next.innerHeight &&
    viewport.visualHeight === next.visualHeight &&
    viewport.visualTop === next.visualTop
  if (!same) viewport = next
  return viewport ?? next
}

function subscribeViewport(listener: () => void): () => void {
  const vv = window.visualViewport
  window.addEventListener('resize', listener)
  vv?.addEventListener('resize', listener)
  vv?.addEventListener('scroll', listener)
  return () => {
    window.removeEventListener('resize', listener)
    vv?.removeEventListener('resize', listener)
    vv?.removeEventListener('scroll', listener)
  }
}

/** innerWidth, innerHeight and the visual viewport, live (rotation, the keyboard). */
export function useViewportFacts(): ViewportFacts {
  return useSyncExternalStore(subscribeViewport, readViewport, readViewport)
}

// ---------------------------------------------------------------------------------------------
// Service worker

export interface WorkerFacts {
  /** The browser has service workers (they need a secure context). */
  supported: boolean
  /** A worker is registered for this page's scope. */
  registered: boolean
  /** A worker controls this page, so it opens offline. */
  controlled: boolean
  /** A new version is installed and waits for "Reload". */
  waiting: boolean
}

const NO_WORKER: WorkerFacts = Object.freeze({ supported: false, registered: false, controlled: false, waiting: false })

function workerContainer(): ServiceWorkerContainer | null {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null
}

/** The registration, read when the page mounts and again when another worker takes control; null while reading. */
export function useWorkerFacts(): WorkerFacts | null {
  const [facts, setFacts] = useState<WorkerFacts | null>(() => (workerContainer() === null ? NO_WORKER : null))
  useEffect(() => {
    const container = workerContainer()
    if (container === null) return undefined
    let current = true
    const read = (): void => {
      container.getRegistration().then(
        (registration) => {
          if (!current) return
          setFacts({
            supported: true,
            registered: registration !== undefined,
            controlled: container.controller !== null,
            waiting: registration?.waiting != null,
          })
        },
        () => {
          if (current) setFacts({ supported: true, registered: false, controlled: container.controller !== null, waiting: false })
        },
      )
    }
    read()
    container.addEventListener('controllerchange', read)
    return () => {
      current = false
      container.removeEventListener('controllerchange', read)
    }
  }, [])
  return facts
}

// ---------------------------------------------------------------------------------------------
// Face ID

/** A platform authenticator (Face ID, Touch ID) is available; null when that can't be told, undefined while asking. */
export function usePlatformAuthenticator(): boolean | null | undefined {
  const [available, setAvailable] = useState<boolean | null | undefined>(undefined)
  useEffect(() => {
    let current = true
    // Wrapped, so a synchronous throw inside lockSupport() lands in the rejection handler too.
    Promise.resolve()
      .then(() => lockSupport().biometric())
      .then(
        (result) => {
          if (current) setAvailable(result)
        },
        () => {
          if (current) setAvailable(null)
        },
      )
    return () => {
      current = false
    }
  }, [])
  return available
}

// ---------------------------------------------------------------------------------------------
// Build

/**
 * Which build runs: in production the id vite.config.ts stamps into the bundle (the short commit
 * hash, "3f9c2ab", or the build time without git), so a device can be matched to a deploy;
 * "Development server" otherwise.
 */
export function buildLabel(production: boolean, buildId: string): string {
  return production ? buildId : 'Development server'
}

export const BUILD_ID: string = buildLabel(import.meta.env.PROD, __BUILD_ID__)
