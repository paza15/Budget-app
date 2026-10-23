import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, ThemeController } from '@/app/ThemeController'
import { makeData } from '@/domain/test-helpers/dataFixtures'
import type { Settings } from '@/domain/types'
import { useAppStore } from '@/store/appStore'

const LIGHT_BG = '#EDEEEA'
const DARK_BG = '#0B1222'

const root = document.documentElement
let style: HTMLStyleElement
/** The colour scheme the stubbed matchMedia reports, and its change listeners. */
let systemDark = false
const schemeListeners = new Set<() => void>()

function setSettings(patch: Partial<Settings>): void {
  const data = useAppStore.getState().data
  useAppStore.setState({ data: { ...data, settings: { ...data.settings, ...patch } } })
}

function themeColor(): string | null {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null
}

function setSystemDark(dark: boolean): void {
  systemDark = dark
  root.classList.toggle('system-dark', dark)
  for (const listener of schemeListeners) listener()
}

beforeEach(() => {
  // --bg as tokens.css resolves it; a class stands in for prefers-color-scheme, which jsdom lacks.
  style = document.createElement('style')
  style.textContent = `
    :root { --bg: ${LIGHT_BG}; }
    :root.system-dark:not([data-theme="light"]) { --bg: ${DARK_BG}; }
    :root[data-theme="dark"] { --bg: ${DARK_BG}; }`
  document.head.append(style)
  document.head.insertAdjacentHTML('beforeend', `<meta name="theme-color" content="${LIGHT_BG}" media="(prefers-color-scheme: light)">`)
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        get matches() {
          return query.includes('dark') && systemDark
        },
        media: query,
        addEventListener: (_type: string, listener: () => void) => schemeListeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => schemeListeners.delete(listener),
      }) as unknown as MediaQueryList,
  )
  useAppStore.setState({ data: makeData(), status: 'ready' })
})

afterEach(() => {
  cleanup()
  style.remove()
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove()
  setSystemDark(false)
  schemeListeners.clear()
  root.removeAttribute('data-theme')
  root.removeAttribute('data-accent')
  root.style.removeProperty('background-color')
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('ThemeController (docs/SPEC.md §7)', () => {
  it('sets data-theme only for an explicit theme, and data-accent always', () => {
    setSettings({ theme: 'system', accent: 'navy' })
    render(<ThemeController />)
    expect(root).not.toHaveAttribute('data-theme')
    expect(root).toHaveAttribute('data-accent', 'navy')

    act(() => setSettings({ theme: 'dark', accent: 'burgundy' }))
    expect(root).toHaveAttribute('data-theme', 'dark')
    expect(root).toHaveAttribute('data-accent', 'burgundy')

    act(() => setSettings({ theme: 'light' }))
    expect(root).toHaveAttribute('data-theme', 'light')
  })

  it('paints the html background and theme-color with the active --bg', () => {
    setSettings({ theme: 'dark' })
    render(<ThemeController />)
    expect(root.style.backgroundColor).not.toBe('')
    expect(themeColor()).toBe(DARK_BG)
    // A media-specific meta would override the app's choice.
    expect(document.querySelector('meta[name="theme-color"]')).not.toHaveAttribute('media')

    act(() => setSettings({ theme: 'light' }))
    expect(themeColor()).toBe(LIGHT_BG)
  })

  it('follows the system appearance while the theme is System', () => {
    setSettings({ theme: 'system' })
    render(<ThemeController />)
    expect(themeColor()).toBe(LIGHT_BG)
    act(() => setSystemDark(true))
    expect(themeColor()).toBe(DARK_BG)

    // An explicit theme stops following it.
    act(() => setSettings({ theme: 'light' }))
    act(() => setSystemDark(true))
    expect(themeColor()).toBe(LIGHT_BG)
    expect(schemeListeners.size).toBe(0)
  })

  it('adds the theme-color meta when the page has none', () => {
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove()
    applyTheme('dark', 'royal')
    expect(themeColor()).toBe(DARK_BG)
  })
})
