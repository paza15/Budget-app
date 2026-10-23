import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, installNavigation, useNav } from '@/app/nav'
import { Shell } from '@/app/Shell'
import { makeData, NOW } from '@/domain/test-helpers/dataFixtures'
import { useAppStore } from '@/store/appStore'

/**
 * jsdom has no Web Animations API, so ScreenStack would switch screens without motion. This stub
 * records each animation (target, keyframes) and finishes it when the test says so. It must exist
 * before ScreenStack loads, which checks for it once.
 */
const animations = vi.hoisted(() => {
  interface Recorded {
    target: Element
    keyframes: Keyframe[]
    finish(): void
  }
  const recorded: Recorded[] = []
  Element.prototype.animate = function animate(this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null) {
    let resolve: (() => void) | undefined
    const finished = new Promise<void>((done) => {
      resolve = done
    })
    const finish = (): void => resolve?.()
    recorded.push({ target: this, keyframes: keyframes as Keyframe[], finish })
    return { finished, finish, cancel: finish } as unknown as Animation
  }
  return recorded
})

// Plain screens: only the shell's own motion is recorded, never what a feature screen animates.
vi.mock('@/app/registry', async () => {
  const { createElement: h } = await import('react')
  const { useNav: nav } = await import('@/app/nav')
  // Like Screen: the heading takes focus from script. Home has the monogram button that pushes You.
  const fakeScreen = (title: string) =>
    function FakeScreen() {
      const settings =
        title === 'Home'
          ? h('button', { type: 'button', onClick: () => nav.getState().push({ name: 'you' }) }, 'Settings')
          : null
      return h('section', { 'aria-label': title }, h('h1', { tabIndex: -1 }, title), settings)
    }
  return {
    TAB_ROOTS: { home: fakeScreen('Home'), daily: fakeScreen('Daily'), fixed: fakeScreen('Fixed'), wallet: fakeScreen('Wallet') },
    SCREENS: { category: fakeScreen('Coffee & snacks'), you: fakeScreen('You') },
    SHEETS: {},
    sheetLabel: () => 'Sheet',
  }
})

/** "screen-home: translateX(0) → translateX(-30%)" for each recorded animation. */
function played(): string[] {
  return animations.map(({ target, keyframes }) => {
    const steps = keyframes.map((frame) => String(frame.transform ?? `opacity ${String(frame.opacity)}`)).join(' → ')
    return `${(target as HTMLElement).dataset.testid}: ${steps}`
  })
}

function prefersReducedMotion(reduce: boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('reduce'),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  animations.length = 0
  prefersReducedMotion(false)
  __resetNavForTests()
  installNavigation()
  const data = makeData()
  useAppStore.setState({ data: { ...data, settings: { ...data.settings, onboarded: true } }, status: 'ready' })
})

afterEach(() => {
  cleanup()
  __resetNavForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('ScreenStack motion (docs/SPEC.md §5.5, DESIGN.md §10)', () => {
  it('slides a pushed screen in over the root, which moves a third of the way', () => {
    render(<Shell />)
    act(() => useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' }))
    expect(played()).toEqual([
      'screen-category: translateX(100%) → translateX(0)',
      'screen-home: translateX(0) → translateX(-30%)',
    ])
  })

  it('slides a popped screen out and removes it when the slide ends', async () => {
    render(<Shell />)
    act(() => useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' }))
    animations.length = 0
    act(() => useNav.getState().pop())
    await waitFor(() => expect(played()).toHaveLength(2))
    expect(played()).toEqual([
      'screen-home: translateX(-30%) → translateX(0)',
      'screen-category: translateX(0) → translateX(100%)',
    ])
    // Still there while it slides out, inert.
    expect(screen.getByTestId('screen-category')).toHaveAttribute('data-position', 'exiting')
    expect(screen.getByTestId('screen-category')).toHaveAttribute('inert')
    await act(async () => animations.at(-1)?.finish())
    expect(screen.queryByTestId('screen-category')).toBeNull()
  })

  it('pops without a slide after the system back gesture', async () => {
    render(<Shell />)
    act(() => useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' }))
    animations.length = 0
    act(() => window.history.back())
    await waitFor(() => expect(screen.queryByTestId('screen-category')).toBeNull())
    expect(played()).toEqual([])
  })

  it('does not replay a slide when the user comes back to the tab', () => {
    render(<Shell />)
    act(() => useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' }))
    animations.length = 0
    act(() => useNav.getState().setTab('daily'))
    act(() => useNav.getState().setTab('home'))
    expect(played()).toEqual([])
    expect(screen.getByTestId('screen-category')).toHaveAttribute('data-active', 'true')
  })

  it('fades instead of sliding with Reduce Motion', () => {
    prefersReducedMotion(true)
    render(<Shell />)
    act(() => useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' }))
    expect(played()[0]).toBe('screen-category: opacity 0 → opacity 1')
    expect(played().join(' ')).not.toMatch(/translate/)
  })
})

describe('ScreenStack focus (VoiceOver follows the screen on top)', () => {
  it('moves focus to the pushed screen title, and back to the button that pushed it after a pop', async () => {
    const user = userEvent.setup()
    render(<Shell />)
    const settings = screen.getByRole('button', { name: 'Settings' })
    await user.click(settings)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'You' }))
    act(() => useNav.getState().pop())
    await waitFor(() => expect(document.activeElement).toBe(settings))
  })

  it('falls back to the uncovered screen title when nothing there had focus', async () => {
    render(<Shell />)
    act(() => useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Coffee & snacks' }))
    act(() => useNav.getState().pop())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Home' })))
  })

  it('leaves focus where it is on a tab switch', () => {
    render(<Shell />)
    const daily = screen.getByTestId('tab-daily')
    daily.focus()
    act(() => useNav.getState().setTab('daily'))
    expect(document.activeElement).toBe(daily)
  })
})
