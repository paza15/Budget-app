import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetBannersForTests, AppBanners, BannerOutlet, visibleScreenRef } from '@/app/AppBanners'
import { __resetNavForTests, installNavigation, useNav } from '@/app/nav'
import { Shell } from '@/app/Shell'
import { LS_KEYS } from '@/domain/constants'
import { makeData, makeTransaction, NOW } from '@/domain/test-helpers/dataFixtures'
import type { AppData } from '@/domain/types'
import { needsInstall } from '@/features/pwa/platform'
import { usePwaStore } from '@/features/pwa/sw'
import { useAppStore } from '@/store/appStore'
import { __resetPersistenceForTests, STORAGE_MESSAGES, useStorageStatus } from '@/store/persistence'
import { useSecurityStore } from '@/store/securityStore'

// Safari outside the installed app is switched on per test.
vi.mock('@/features/pwa/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/pwa/platform')>()),
  needsInstall: vi.fn<() => boolean>(() => false),
}))

// The review feature decides what its banner says; here it only has to be there when the shell
// gives it the place.
vi.mock('@/features/review/ReviewBanner', async () => {
  const { createElement } = await import('react')
  return { ReviewBanner: () => createElement('div', { 'data-testid': 'banner-review' }, 'September is closed.') }
})

// Screens shaped like the UI kit's Screen: a header, then the banner slot, then the content. 'owed'
// has no slot, and 'you' renders its Screen only after "Load" and a new one on each "Remount". No
// feature screen is loaded: these tests are about the shell.
vi.mock('@/app/registry', async () => {
  const { createElement: h, useState } = await import('react')
  const fakeScreen = (title: string) =>
    function FakeScreen() {
      return h(
        'section',
        { 'aria-label': title },
        h('header', null, h('h1', null, title)),
        h('div', { 'data-banner-slot': '' }),
        h('p', null, `${title} content`),
      )
    }
  function SlotlessScreen() {
    return h('section', { 'aria-label': 'Owed to you' }, h('p', null, 'Owed content'))
  }
  function LateScreen() {
    const [version, setVersion] = useState(0)
    if (version === 0) return h('button', { type: 'button', onClick: () => setVersion(1) }, 'Load')
    return h(
      'section',
      { key: version, 'aria-label': 'Settings' },
      h('header', null, h('h1', null, 'Settings')),
      h('div', { 'data-banner-slot': '' }),
      h('button', { type: 'button', onClick: () => setVersion((v: number) => v + 1) }, 'Remount'),
    )
  }
  return {
    TAB_ROOTS: { home: fakeScreen('Home'), daily: fakeScreen('Daily'), fixed: fakeScreen('Fixed'), wallet: fakeScreen('Wallet') },
    SCREENS: { category: fakeScreen('Coffee & snacks'), owed: SlotlessScreen, you: LateScreen },
    SHEETS: {},
    sheetLabel: () => 'Sheet',
  }
})

const DAY = 86_400_000
const NON_CRITICAL = ['banner-update', 'banner-install', 'banner-review', 'banner-backup']

/**
 * Onboarded data. September is already reviewed unless the patch says otherwise: the fixture was
 * installed in August, so its September statement would otherwise take the place.
 */
function onboarded(patch: Partial<AppData['settings']> = {}, transactions = 0): AppData {
  const data = makeData()
  return {
    ...data,
    settings: { ...data.settings, onboarded: true, lastReviewedMonth: '2026-09', ...patch },
    transactions: Array.from({ length: transactions }, (_, i) => makeTransaction({ id: `tx-${i}` })),
  }
}

/** Ten entries and no backup 31 days after the install. */
function due(patch: Partial<AppData['settings']> = {}): AppData {
  return onboarded({ createdAt: NOW - 31 * DAY, lastBackupAt: null, ...patch }, 10)
}

/** The non-critical banners on screen. */
function notices(): string[] {
  return NON_CRITICAL.filter((id) => screen.queryByTestId(id) !== null)
}

/** Banners render into the outlet at the top of #app-root when no screen offers a slot. */
function renderBanners() {
  return render(
    <>
      <div id="app-root">
        <BannerOutlet />
      </div>
      <AppBanners />
    </>,
  )
}

/** The real shell with the screens above, laid out as App does. */
function renderShell() {
  return render(
    <>
      <div id="app-root">
        <BannerOutlet />
        <Shell />
      </div>
      <AppBanners />
    </>,
  )
}

/** The banner slot of a screen layer. */
function slotOf(testId: string): HTMLElement {
  const slot = screen.getByTestId(testId).querySelector<HTMLElement>('[data-banner-slot]')
  if (slot === null) throw new Error(`${testId} has no banner slot`)
  return slot
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  __resetPersistenceForTests()
  __resetNavForTests()
  __resetBannersForTests()
  useStorageStatus.setState({ phase: 'ok' })
  useAppStore.setState({ data: onboarded(), status: 'ready' })
  useSecurityStore.setState({ status: 'ready', locked: false, unlockedOnce: true })
})

afterEach(() => {
  cleanup()
  __resetPersistenceForTests()
  __resetNavForTests()
  __resetBannersForTests()
  vi.mocked(needsInstall).mockReturnValue(false)
  usePwaStore.setState({ updateReady: false })
  useSecurityStore.setState(useSecurityStore.getInitialState(), true)
  localStorage.clear()
  vi.useRealTimers()
})

describe('storage banners (docs/SPEC.md §3.10)', () => {
  it('says a failed write needs a reload, inside #app-root', () => {
    useStorageStatus.setState({ phase: 'write-failed', error: STORAGE_MESSAGES.writeFailed })
    renderBanners()
    const banner = screen.getByTestId('banner-storage')
    expect(banner).toHaveTextContent("Couldn't save your last changes. Reload to reconnect storage.")
    expect(within(banner).getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(document.getElementById('app-root')).toContainElement(banner)
  })

  it('offers a backup when the iPhone is out of storage', () => {
    useStorageStatus.setState({ phase: 'write-failed', error: STORAGE_MESSAGES.outOfSpace })
    renderBanners()
    const banner = screen.getByTestId('banner-storage')
    expect(banner).toHaveTextContent('Your iPhone is out of storage')
    expect(within(banner).getByRole('button', { name: 'Export backup' })).toBeInTheDocument()
  })

  it('warns while the app is not saving', () => {
    useStorageStatus.setState({ phase: 'memory-only' })
    renderBanners()
    expect(screen.getByTestId('banner-storage')).toHaveTextContent(
      "The app isn't saving. Entries made now will be lost when you close it.",
    )
  })

  it('reports rows a load had to skip until dismissed, for the rest of the session', async () => {
    const user = userEvent.setup()
    useStorageStatus.setState({ droppedOnLoad: 3 })
    renderBanners()
    const banner = screen.getByTestId('banner-storage')
    expect(banner).toHaveTextContent('Skipped 3 damaged entries. A copy of the original was kept.')
    await user.click(within(banner).getByRole('button', { name: 'Not now' }))
    expect(screen.queryByTestId('banner-storage')).toBeNull()

    // The banners remount on every screen change; the dismissal stays.
    cleanup()
    renderBanners()
    expect(screen.queryByTestId('banner-storage')).toBeNull()
  })

  it('leaves blocking phases to the storage screen', () => {
    useStorageStatus.setState({ phase: 'conflict', error: STORAGE_MESSAGES.conflict })
    renderBanners()
    expect(screen.queryByTestId('banner-storage')).toBeNull()
  })

  it('shows nothing while there is no outlet (a cold-start lock)', () => {
    useStorageStatus.setState({ phase: 'memory-only' })
    render(<AppBanners />)
    expect(screen.queryByTestId('banner-storage')).toBeNull()
  })
})

describe('update banner', () => {
  it('shows on a tab root with no sheet open', () => {
    usePwaStore.setState({ updateReady: true })
    renderBanners()
    const banner = screen.getByTestId('banner-update')
    expect(banner).toHaveTextContent('A new version of On a Budget is ready.')
    expect(within(banner).getByRole('button', { name: 'Reload' })).toBeInTheDocument()

    act(() => {
      useNav.getState().openSheet({ name: 'transaction' })
    })
    expect(screen.queryByTestId('banner-update')).toBeNull()
  })

  it('waits while a screen is pushed, during onboarding and under the lock', () => {
    usePwaStore.setState({ updateReady: true })
    useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' })
    const { unmount } = renderBanners()
    expect(screen.queryByTestId('banner-update')).toBeNull()
    unmount()

    __resetNavForTests()
    useAppStore.setState({ data: makeData() })
    renderBanners()
    expect(screen.queryByTestId('banner-update')).toBeNull()

    act(() => {
      useAppStore.setState({ data: onboarded() })
      useSecurityStore.setState({ locked: true })
    })
    expect(screen.queryByTestId('banner-update')).toBeNull()
  })
})

describe('backup nudge', () => {
  it('shows on Home after 30 days without a backup', () => {
    useAppStore.setState({ data: due() })
    renderBanners()
    const banner = screen.getByTestId('banner-backup')
    expect(banner).toHaveTextContent('Your entries are only on this iPhone. Export a backup to keep them safe.')
    expect(within(banner).getByRole('button', { name: 'Export backup' })).toBeInTheDocument()

    act(() => useNav.getState().setTab('daily'))
    expect(screen.queryByTestId('banner-backup')).toBeNull()
  })

  it('waits 60 days after the last backup', () => {
    useAppStore.setState({ data: onboarded({ createdAt: NOW - 200 * DAY, lastBackupAt: NOW - 45 * DAY }, 10) })
    renderBanners()
    expect(screen.queryByTestId('banner-backup')).toBeNull()
    cleanup()

    useAppStore.setState({ data: onboarded({ createdAt: NOW - 200 * DAY, lastBackupAt: NOW - 61 * DAY }, 10) })
    renderBanners()
    expect(screen.getByTestId('banner-backup')).toBeInTheDocument()
  })

  it('snoozes for 14 days with Not now', async () => {
    const user = userEvent.setup()
    useAppStore.setState({ data: due() })
    renderBanners()
    await user.click(within(screen.getByTestId('banner-backup')).getByRole('button', { name: 'Not now' }))
    expect(screen.queryByTestId('banner-backup')).toBeNull()
    expect(Number(localStorage.getItem(LS_KEYS.backupNudgeUntil))).toBe(NOW + 14 * DAY)
    cleanup()

    // Still snoozed after a relaunch.
    __resetBannersForTests()
    renderBanners()
    expect(screen.queryByTestId('banner-backup')).toBeNull()
  })

  it('stays snoozed for the session when localStorage refuses the write', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError')
    })
    useAppStore.setState({ data: due() })
    renderBanners()
    await user.click(within(screen.getByTestId('banner-backup')).getByRole('button', { name: 'Not now' }))
    cleanup()
    renderBanners()
    expect(screen.queryByTestId('banner-backup')).toBeNull()
    setItem.mockRestore()
  })

  it('needs enough entries to be worth a backup', () => {
    useAppStore.setState({ data: onboarded({ createdAt: NOW - 31 * DAY, lastBackupAt: null }, 3) })
    renderBanners()
    expect(screen.queryByTestId('banner-backup')).toBeNull()
  })
})

/** Every non-critical banner applies at once: an update, Safari, an unreviewed September and a due backup. */
function everythingApplies(): void {
  usePwaStore.setState({ updateReady: true })
  vi.mocked(needsInstall).mockReturnValue(true)
  useAppStore.setState({ data: due({ lastReviewedMonth: null }) })
}

describe('one non-critical banner at a time (docs/SPEC.md §3.15, EXTRAS.md §1.6)', () => {
  it('shows only the first that applies: update, install hint, review, then the backup nudge', async () => {
    const user = userEvent.setup()
    everythingApplies()
    renderBanners()
    expect(notices()).toEqual(['banner-update'])

    act(() => usePwaStore.setState({ updateReady: false }))
    expect(notices()).toEqual(['banner-install'])

    // Dismissed for good: the next banner takes the place at once, and the hint stays away.
    await user.click(screen.getByRole('button', { name: "Don't show again" }))
    expect(notices()).toEqual(['banner-review'])
    act(() => useNav.getState().setTab('daily'))
    act(() => useNav.getState().setTab('home'))
    expect(notices()).toEqual(['banner-review'])

    act(() => useAppStore.setState({ data: due({ lastReviewedMonth: '2026-09' }) }))
    expect(notices()).toEqual(['banner-backup'])
  })

  it('shows the review banner only on the current period, so a past period gets the nudge', () => {
    useAppStore.setState({ data: due({ lastReviewedMonth: null }) })
    renderBanners()
    expect(notices()).toEqual(['banner-review'])

    act(() => useNav.getState().setMonth('2026-08'))
    expect(notices()).toEqual(['banner-backup'])
  })

  it('keeps the place for the update while a sheet is open', () => {
    usePwaStore.setState({ updateReady: true })
    useAppStore.setState({ data: due() })
    renderBanners()
    expect(notices()).toEqual(['banner-update'])

    act(() => useNav.getState().openSheet({ name: 'transaction' }))
    expect(notices()).toEqual([])

    act(() => useNav.getState().closeSheet())
    expect(notices()).toEqual(['banner-update'])
  })

  it('shows storage problems beside it', () => {
    everythingApplies()
    useStorageStatus.setState({ phase: 'memory-only' })
    renderBanners()
    expect(screen.getByTestId('banner-storage')).toBeInTheDocument()
    expect(notices()).toEqual(['banner-update'])
  })

  it('leaves other tabs to the update banner alone', () => {
    everythingApplies()
    useNav.getState().setTab('daily')
    renderBanners()
    expect(notices()).toEqual(['banner-update'])

    act(() => usePwaStore.setState({ updateReady: false }))
    expect(notices()).toEqual([])
  })
})

describe('placement (DESIGN.md §9.19)', () => {
  beforeEach(() => {
    installNavigation()
  })

  it('puts the banners under the header of the screen the user sees', () => {
    usePwaStore.setState({ updateReady: true })
    renderShell()
    const banner = screen.getByTestId('banner-update')
    const slot = slotOf('screen-home')
    expect(slot).toContainElement(banner)
    const header = within(screen.getByTestId('screen-home')).getByRole('banner')
    expect(header.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('moves them with the visible screen, one copy only', async () => {
    usePwaStore.setState({ updateReady: true })
    useStorageStatus.setState({ phase: 'memory-only' })
    renderShell()

    act(() => useNav.getState().setTab('daily'))
    expect(screen.getAllByTestId('banner-update')).toHaveLength(1)
    expect(slotOf('screen-daily')).toContainElement(screen.getByTestId('banner-update'))
    expect(slotOf('screen-home')).toBeEmptyDOMElement()

    // A pushed screen gets the storage banner; the update waits for the tab root.
    act(() => useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' }))
    expect(slotOf('screen-category')).toContainElement(screen.getByTestId('banner-storage'))
    expect(screen.queryByTestId('banner-update')).toBeNull()

    // Back goes through history; popstate applies it.
    act(() => useNav.getState().pop())
    await waitFor(() => expect(useNav.getState().stacks.daily).toEqual([]))
    expect(slotOf('screen-daily')).toContainElement(screen.getByTestId('banner-update'))
    expect(screen.getAllByTestId('banner-storage')).toHaveLength(1)
  })

  it('falls back to the top of the app on a screen without a slot', () => {
    useStorageStatus.setState({ phase: 'memory-only' })
    renderShell()
    act(() => useNav.getState().push({ name: 'owed' }))
    const banner = screen.getByTestId('banner-storage')
    expect(screen.getByTestId('screen-owed')).not.toContainElement(banner)
    expect(document.getElementById('app-root')?.firstElementChild).toContainElement(banner)
  })

  it('follows a slot that a screen renders late or replaces', async () => {
    const user = userEvent.setup()
    useStorageStatus.setState({ phase: 'memory-only' })
    renderShell()
    act(() => useNav.getState().push({ name: 'you' }))
    const outlet = document.getElementById('app-root')?.firstElementChild
    expect(outlet).toContainElement(screen.getByTestId('banner-storage'))

    await user.click(screen.getByRole('button', { name: 'Load' }))
    await waitFor(() => expect(slotOf('screen-you')).toContainElement(screen.getByTestId('banner-storage')))
    expect(outlet).toBeEmptyDOMElement()

    const first = slotOf('screen-you')
    await user.click(screen.getByRole('button', { name: 'Remount' }))
    await waitFor(() => expect(slotOf('screen-you')).not.toBe(first))
    await waitFor(() => expect(slotOf('screen-you')).toContainElement(screen.getByTestId('banner-storage')))
    expect(screen.getAllByTestId('banner-storage')).toHaveLength(1)
  })

  it('ignores a layer that is already gone', () => {
    expect(visibleScreenRef(null)).toBeUndefined()
  })
})
