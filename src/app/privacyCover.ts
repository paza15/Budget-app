import { MARK_PATH, MARK_VIEWBOX } from '@/app/markPath'
import { getData } from '@/store/appStore'
import { hasPin } from '@/store/securityStore'
import styles from './privacyCover.module.css'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** The opaque layer with the mark, shown by CSS while the root carries data-cover="on". */
function createCover(): HTMLElement {
  const cover = document.createElement('div')
  cover.className = styles.cover ?? ''
  cover.setAttribute('aria-hidden', 'true')
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', MARK_VIEWBOX)
  svg.setAttribute('width', '64')
  svg.setAttribute('height', '64')
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('fill-rule', 'evenodd')
  path.setAttribute('d', MARK_PATH)
  svg.append(path)
  cover.append(svg)
  return cover
}

/**
 * Installs the privacy cover (docs/SPEC.md §3.8): plain DOM listeners, not React state, so the
 * cover is in place synchronously when the page is hidden, before iOS takes the app-switcher
 * snapshot. It covers only when a PIN is set or hideAmounts is on (both read at event time), and
 * comes off after the page is visible again, once the lock state has rendered. Best effort: iOS
 * sends no event when the app switcher opens. Returns a function that removes everything.
 */
export function installPrivacyCover(): () => void {
  const root = document.documentElement
  const cover = createCover()
  document.body.append(cover)
  let frame = 0

  const uncoverLater = (): void => {
    cancelAnimationFrame(frame)
    // The lock feature locks in its own visibilitychange listener, which runs after this one, and
    // React commits that store change in a microtask, so the lock screen is in the DOM before the
    // next frame: the cover comes off in that frame and the app never shows uncovered (§3.8).
    frame = requestAnimationFrame(() => {
      frame = 0
      root.removeAttribute('data-cover')
    })
  }

  const coverNow = (): void => {
    cancelAnimationFrame(frame)
    frame = 0
    if (hasPin() || getData().settings.hideAmounts) root.dataset.cover = 'on'
  }

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') coverNow()
    else if (root.dataset.cover !== undefined) uncoverLater()
  }

  // A page restored from the back-forward cache shows again with pageshow.
  const onPageShow = (): void => {
    if (document.visibilityState === 'visible' && root.dataset.cover !== undefined) uncoverLater()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', coverNow)
  window.addEventListener('pageshow', onPageShow)

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', coverNow)
    window.removeEventListener('pageshow', onPageShow)
    cancelAnimationFrame(frame)
    root.removeAttribute('data-cover')
    cover.remove()
  }
}
