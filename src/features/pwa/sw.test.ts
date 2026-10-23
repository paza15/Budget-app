import type { RegisterSWOptions } from 'vite-plugin-pwa/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// docs/SPEC.md §5.7 and §7: prompt-mode registration, update checks at start and on visible (at
// most hourly, online only), and a reload only after pending saves are written.

type UpdateSW = (reloadPage?: boolean) => Promise<void>

const pwa = vi.hoisted(() => ({
  registerSW: vi.fn<(options?: RegisterSWOptions) => UpdateSW>(),
  updateSW: vi.fn<UpdateSW>(),
}))
vi.mock('virtual:pwa-register', () => ({ registerSW: pwa.registerSW }))

const persistence = vi.hoisted(() => ({ flushSaves: vi.fn<() => Promise<void>>() }))
vi.mock('@/store/persistence', () => ({ flushSaves: persistence.flushSaves }))

type SwModule = typeof import('@/features/pwa/sw')

const START = new Date('2026-10-14T10:00:00+02:00').getTime()
const MINUTE = 60_000

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
}

const noop = () => {}

let doc: FakeDocument
let nav: { onLine: boolean; serviceWorker?: object }
let reload: ReturnType<typeof vi.fn<() => void>>
let options: RegisterSWOptions | undefined
let registration: { update: ReturnType<typeof vi.fn<() => Promise<void>>> }

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(START)
  vi.stubEnv('PROD', true)
  doc = new FakeDocument()
  nav = { onLine: true, serviceWorker: {} }
  reload = vi.fn<() => void>()
  vi.stubGlobal('document', doc)
  vi.stubGlobal('navigator', nav)
  vi.stubGlobal('location', { reload })
  vi.spyOn(console, 'warn').mockImplementation(noop)
  options = undefined
  pwa.updateSW.mockReset().mockResolvedValue(undefined)
  pwa.registerSW.mockReset().mockImplementation((o) => {
    options = o
    return pwa.updateSW
  })
  persistence.flushSaves.mockReset().mockResolvedValue(undefined)
  registration = { update: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** Imports a fresh copy of sw.ts and registers, waiting for the on-demand import of the plugin. */
async function start(): Promise<SwModule> {
  const sw = await import('@/features/pwa/sw')
  sw.registerServiceWorker()
  await vi.dynamicImportSettled()
  return sw
}

function callbacks(): RegisterSWOptions {
  if (!options) throw new Error('registerSW was not called')
  return options
}

/** The browser reports the registration, as workbox-window does once register() resolves. */
function registered(): void {
  callbacks().onRegisteredSW?.('/sw.js', registration as unknown as ServiceWorkerRegistration)
}

function setVisibility(state: DocumentVisibilityState): void {
  doc.visibilityState = state
  doc.dispatchEvent(new Event('visibilitychange'))
}

function at(minutes: number): void {
  vi.setSystemTime(START + minutes * MINUTE)
}

/**
 * Lets pending promise callbacks run: one turn of Node's setImmediate, which the fake timers leave
 * alone. (Typed by hand: the app's type program has no Node types.)
 */
function settle(): Promise<void> {
  const { setImmediate } = globalThis as unknown as { setImmediate(callback: () => void): void }
  return new Promise((resolve) => setImmediate(resolve))
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve: () => void = noop
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve: () => resolve() }
}

describe('registerServiceWorker', () => {
  it('does nothing outside production builds', async () => {
    vi.stubEnv('PROD', false)
    await start()
    expect(pwa.registerSW).not.toHaveBeenCalled()
  })

  it('does nothing where service workers are unavailable (no https)', async () => {
    delete nav.serviceWorker
    await start()
    expect(pwa.registerSW).not.toHaveBeenCalled()
  })

  it('registers once, however often it is called', async () => {
    const sw = await start()
    sw.registerServiceWorker()
    await vi.dynamicImportSettled()
    expect(pwa.registerSW).toHaveBeenCalledTimes(1)
  })

  it('marks an update as ready when a new version waits', async () => {
    const sw = await start()
    expect(sw.usePwaStore.getState().updateReady).toBe(false)
    callbacks().onNeedRefresh?.()
    expect(sw.usePwaStore.getState().updateReady).toBe(true)
  })
})

describe('update checks', () => {
  it('check at start, then at most hourly when the app becomes visible', async () => {
    await start()
    registered()
    expect(registration.update).toHaveBeenCalledTimes(1)

    at(59)
    setVisibility('visible')
    expect(registration.update).toHaveBeenCalledTimes(1)

    at(61)
    setVisibility('hidden')
    expect(registration.update).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    expect(registration.update).toHaveBeenCalledTimes(2)

    at(90)
    setVisibility('visible')
    expect(registration.update).toHaveBeenCalledTimes(2)
    at(121)
    setVisibility('visible')
    expect(registration.update).toHaveBeenCalledTimes(3)
  })

  it('wait while offline and check as soon as the app is visible online', async () => {
    nav.onLine = false
    await start()
    registered()
    at(5)
    setVisibility('visible')
    expect(registration.update).not.toHaveBeenCalled()

    nav.onLine = true
    at(6)
    setVisibility('visible')
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('may retry on the next visible after a check failed', async () => {
    registration.update.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await start()
    registered()
    await settle()

    at(2)
    setVisibility('visible')
    expect(registration.update).toHaveBeenCalledTimes(2)
    await settle()
    at(3)
    setVisibility('visible')
    expect(registration.update).toHaveBeenCalledTimes(2)
  })

  it('are not blocked by a clock that went back', async () => {
    await start()
    registered()
    at(-120)
    setVisibility('visible')
    expect(registration.update).toHaveBeenCalledTimes(2)
  })

  it('need a registration', async () => {
    await start()
    callbacks().onRegisteredSW?.('/sw.js', undefined)
    setVisibility('visible')
    expect(registration.update).not.toHaveBeenCalled()
  })
})

describe('reloading into a new version', () => {
  it('writes pending saves before the reload, and reloads once', async () => {
    const saving = deferred()
    persistence.flushSaves.mockReturnValueOnce(saving.promise)
    await start()

    callbacks().onNeedReload?.()
    callbacks().onNeedReload?.()
    await settle()
    expect(persistence.flushSaves).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()

    saving.resolve()
    await settle()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('still reloads when saving fails (persistence keeps a rescue copy)', async () => {
    persistence.flushSaves.mockRejectedValueOnce(new Error('QuotaExceededError'))
    await start()
    callbacks().onNeedReload?.()
    await settle()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('applyUpdate', () => {
  it('saves first, then lets the waiting version take over, which reloads the page', async () => {
    const saving = deferred()
    const sw = await start()
    registered()
    persistence.flushSaves.mockReturnValueOnce(saving.promise)

    const applying = sw.applyUpdate()
    await settle()
    expect(pwa.updateSW).not.toHaveBeenCalled()

    saving.resolve()
    await applying
    expect(pwa.updateSW).toHaveBeenCalledWith(true)
    expect(reload).not.toHaveBeenCalled()

    // workbox-window reports that the new version controls the page.
    callbacks().onNeedReload?.()
    await settle()
    expect(reload).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(sw.RELOAD_FALLBACK_MS)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads anyway when the new version never takes over', async () => {
    const sw = await start()
    registered()
    await sw.applyUpdate()
    await vi.advanceTimersByTimeAsync(sw.RELOAD_FALLBACK_MS - 1)
    expect(reload).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads after saving when no service worker was registered', async () => {
    vi.stubEnv('PROD', false)
    const sw = await start()
    await sw.applyUpdate()
    expect(persistence.flushSaves).toHaveBeenCalled()
    expect(pwa.updateSW).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
