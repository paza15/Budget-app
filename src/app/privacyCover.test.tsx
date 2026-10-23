import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPrivacyCover } from '@/app/privacyCover'
import { createDefaultSecurity } from '@/domain/defaults'
import { makeData } from '@/domain/test-helpers/dataFixtures'
import { useAppStore } from '@/store/appStore'
import { useSecurityStore } from '@/store/securityStore'

let uninstall: () => void
const frames: FrameRequestCallback[] = []

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

function runFrame(): void {
  const pending = frames.splice(0)
  for (const callback of pending) callback(performance.now())
}

function cover(): string | undefined {
  return document.documentElement.dataset.cover
}

function withPin(): void {
  useSecurityStore.setState({ config: { ...createDefaultSecurity(), pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==' } })
}

function withHiddenAmounts(): void {
  const data = makeData()
  useAppStore.setState({ data: { ...data, settings: { ...data.settings, hideAmounts: true } }, status: 'ready' })
}

beforeEach(() => {
  frames.length = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.splice(id - 1, 1, () => {})
  })
  useAppStore.setState({ data: makeData(), status: 'ready' })
  uninstall = installPrivacyCover()
})

afterEach(() => {
  uninstall()
  Reflect.deleteProperty(document, 'visibilityState')
  useSecurityStore.setState(useSecurityStore.getInitialState(), true)
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('privacy cover (docs/SPEC.md §3.8)', () => {
  it('covers the app at once when it is hidden with a PIN set', () => {
    withPin()
    setVisibility('hidden')
    expect(cover()).toBe('on')
  })

  it('comes off one animation frame after the app is visible again', () => {
    withPin()
    setVisibility('hidden')
    setVisibility('visible')
    expect(cover()).toBe('on')
    runFrame()
    expect(cover()).toBeUndefined()
  })

  it('covers on pagehide too, and for hidden amounts without a PIN', () => {
    withHiddenAmounts()
    window.dispatchEvent(new Event('pagehide'))
    expect(cover()).toBe('on')
  })

  it('leaves the app uncovered without a PIN or hidden amounts', () => {
    setVisibility('hidden')
    expect(cover()).toBeUndefined()
  })

  it('stays on when the app is hidden again before the frame', () => {
    withPin()
    setVisibility('hidden')
    setVisibility('visible')
    setVisibility('hidden')
    runFrame()
    expect(cover()).toBe('on')
  })

  it('is an opaque layer with the mark, hidden from assistive technology', () => {
    const layer = document.body.querySelector('[aria-hidden="true"] > svg')?.parentElement
    expect(layer).toBeInstanceOf(HTMLElement)
    expect(layer?.querySelector('path')?.getAttribute('d')).toMatch(/^M20 12H44A20 20/)
  })

  it('removes its listeners and layer when uninstalled', () => {
    withPin()
    uninstall()
    setVisibility('hidden')
    expect(cover()).toBeUndefined()
    expect(document.body.querySelector('[aria-hidden="true"] > svg')).toBeNull()
    uninstall = () => {}
  })
})
