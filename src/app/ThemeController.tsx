import { useLayoutEffect } from 'react'
import type { AccentKey, ThemeMode } from '@/domain/types'
import { getData, useAppStore } from '@/store/appStore'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Applies a theme and accent to the document: data-theme only for an explicit light or dark
 * (System lets the prefers-color-scheme blocks in tokens.css decide), data-accent always, then
 * paints the html background and every theme-color meta with the resulting --bg, which iOS uses
 * for the status bar (docs/SPEC.md §7). public/theme-init.js does the same before the first paint.
 */
export function applyTheme(theme: ThemeMode, accent: AccentKey): void {
  const root = document.documentElement
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme
  else root.removeAttribute('data-theme')
  root.dataset.accent = accent

  const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
  if (bg === '') return
  root.style.backgroundColor = bg
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  if (metas.length === 0) {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = bg
    document.head.append(meta)
    return
  }
  for (const meta of metas) {
    // A media-specific meta would win over the active theme, so every one carries the active --bg.
    meta.removeAttribute('media')
    meta.content = bg
  }
}

/**
 * Keeps the document in step with settings.theme and settings.accent, and follows the system
 * appearance while the theme is System (docs/SPEC.md §5.4, §7). Renders nothing. Persistence
 * mirrors both settings to localStorage for public/theme-init.js (§5.4 rule 9).
 */
export function ThemeController() {
  const theme = useAppStore((s) => s.data.settings.theme)
  const accent = useAppStore((s) => s.data.settings.accent)

  // Before paint, so the new theme and its status-bar colour arrive in the same frame.
  useLayoutEffect(() => {
    applyTheme(theme, accent)
    if (theme !== 'system') return undefined
    const media = window.matchMedia(DARK_QUERY)
    const onChange = (): void => {
      const settings = getData().settings
      applyTheme(settings.theme, settings.accent)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme, accent])

  return null
}
