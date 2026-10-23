import { afterEach, describe, expect, it, vi } from 'vitest'
import { isIOS, isStandalone, needsInstall } from '@/features/pwa/platform'

// docs/SPEC.md §5.7: isIOS() is /iPhone|iPad|iPod/ or a Mac user agent with touch; isStandalone()
// is navigator.standalone or the standalone / fullscreen display mode.

const UA = {
  iPhoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iPhoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1',
  iPad: 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iPod: 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  // iPadOS asks for desktop sites by default and then sends a Mac user agent.
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
}

function device(o: { userAgent: string; maxTouchPoints?: number; standalone?: boolean }): void {
  vi.stubGlobal('navigator', { maxTouchPoints: 0, ...o })
}

/** The display mode window.matchMedia reports; null removes matchMedia. */
function displayMode(mode: 'browser' | 'standalone' | 'fullscreen' | 'minimal-ui' | null): void {
  const matchMedia = (query: string) => ({
    media: query,
    matches: query.split(',').some((part) => part.trim() === `(display-mode: ${mode})`),
  })
  vi.stubGlobal('window', mode === null ? {} : { matchMedia })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isIOS', () => {
  it.each([
    ['Safari on iPhone', UA.iPhoneSafari, 5],
    ['Chrome on iPhone', UA.iPhoneChrome, 5],
    ['an iPad with a mobile user agent', UA.iPad, 5],
    ['an iPod touch', UA.iPod, 5],
    ['an iPad that reports a Mac', UA.mac, 5],
  ])('is true for %s', (_name, userAgent, maxTouchPoints) => {
    device({ userAgent, maxTouchPoints })
    expect(isIOS()).toBe(true)
  })

  it.each([
    ['a Mac without touch', UA.mac, 0],
    ['Android', UA.android, 5],
    ['Windows with a touch screen', UA.windows, 10],
  ])('is false for %s', (_name, userAgent, maxTouchPoints) => {
    device({ userAgent, maxTouchPoints })
    expect(isIOS()).toBe(false)
  })

  it('is false outside a browser', () => {
    vi.stubGlobal('navigator', undefined)
    expect(isIOS()).toBe(false)
  })
})

describe('isStandalone', () => {
  it('is true in an iOS Home Screen app (navigator.standalone)', () => {
    device({ userAgent: UA.iPhoneSafari, standalone: true })
    displayMode('browser')
    expect(isStandalone()).toBe(true)
  })

  it.each(['standalone', 'fullscreen'] as const)('is true in display-mode %s', (mode) => {
    device({ userAgent: UA.android })
    displayMode(mode)
    expect(isStandalone()).toBe(true)
  })

  it.each(['browser', 'minimal-ui'] as const)('is false in display-mode %s', (mode) => {
    device({ userAgent: UA.iPhoneSafari, standalone: false })
    displayMode(mode)
    expect(isStandalone()).toBe(false)
  })

  it('is false without matchMedia or outside a browser', () => {
    device({ userAgent: UA.iPhoneSafari })
    displayMode(null)
    expect(isStandalone()).toBe(false)
    vi.stubGlobal('navigator', undefined)
    vi.stubGlobal('window', undefined)
    expect(isStandalone()).toBe(false)
  })
})

describe('needsInstall', () => {
  it('is true in iOS Safari outside the installed app', () => {
    device({ userAgent: UA.iPhoneSafari, maxTouchPoints: 5 })
    displayMode('browser')
    expect(needsInstall()).toBe(true)
  })

  it('is false in the installed app', () => {
    device({ userAgent: UA.iPhoneSafari, maxTouchPoints: 5, standalone: true })
    displayMode('standalone')
    expect(needsInstall()).toBe(false)
  })

  it('is false on other platforms', () => {
    device({ userAgent: UA.android, maxTouchPoints: 5 })
    displayMode('browser')
    expect(needsInstall()).toBe(false)
  })
})
