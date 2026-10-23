import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

// jsdom lacks several browser APIs the shell and UI kit use. These no-op stubs keep component
// tests from crashing; tests that care about the behaviour replace them with their own mocks.
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  }

  if (!window.visualViewport) {
    const viewport = new EventTarget() as EventTarget & Record<string, number>
    Object.defineProperties(viewport, {
      width: { get: () => window.innerWidth },
      height: { get: () => window.innerHeight },
      offsetTop: { value: 0 },
      offsetLeft: { value: 0 },
      pageTop: { value: 0 },
      pageLeft: { value: 0 },
      scale: { value: 1 },
    })
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
  }

  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  if (!('IntersectionObserver' in window)) {
    Object.defineProperty(window, 'IntersectionObserver', { value: NoopObserver, configurable: true })
  }
  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', { value: NoopObserver, configurable: true })
  }

  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  window.scrollTo = () => {}
}
