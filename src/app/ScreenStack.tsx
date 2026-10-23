import { memo, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import { visibleScreenRef } from '@/app/AppBanners'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { useNav, type Route, type TabId } from '@/app/nav'
import { SCREENS, TAB_ROOTS } from '@/app/registry'
import styles from './ScreenStack.module.css'

export interface ScreenStackProps {
  tab: TabId
}

/** Where a screen sits: on top (visible), under another screen (covered) or leaving after a pop. */
type Position = 'top' | 'covered' | 'exiting'

interface ExitingScreen {
  key: string
  route: Route
}

/** What the next layout effect animates: the entering and covered screens, or the leaving and uncovered ones. */
type Transition = { kind: 'push'; enter: string; cover: string } | { kind: 'pop'; exit: string; uncover: string }

interface StackView {
  /** The stack this view was derived from. */
  stack: Route[]
  /** Popped screens that stay until their slide out has finished. */
  exiting: ExitingScreen[]
  transition: Transition | null
}

/** React keys for routes. nav stores a fresh object per push, so a key never names two screens. */
const routeKeys = new WeakMap<Route, string>()
let routeCount = 0

function routeKey(route: Route): string {
  let key = routeKeys.get(route)
  if (key === undefined) {
    routeCount += 1
    key = `route-${routeCount}`
    routeKeys.set(route, key)
  }
  return key
}

function rootKey(tab: TabId): string {
  return `${tab}-root`
}

function topKey(tab: TabId, stack: readonly Route[]): string {
  const top = stack.at(-1)
  return top === undefined ? rootKey(tab) : routeKey(top)
}

/** What a press records as the control to return to: WebKit does not focus a tapped button. */
const CONTROL = 'button, a[href], input, select, textarea, summary, [role="button"], [role="tab"], [tabindex]'

/** Whether focus may go to `element`: still in the page and not under an inert ancestor. */
function canFocus(element: HTMLElement | undefined, layer: HTMLElement): element is HTMLElement {
  return element !== undefined && element.isConnected && layer.contains(element) && element.closest('[inert]') === null
}

/**
 * Moves focus into the screen now on top, so VoiceOver announces it: to the control the user
 * left it from (back from a pushed screen), else to its heading (Screen gives every h1
 * tabindex -1). preventScroll: the screen keeps its scroll position. A sheet or dialog that holds
 * focus keeps it; its own close puts focus back.
 */
function focusLayer(layer: HTMLElement, remembered: HTMLElement | undefined): void {
  if (document.activeElement?.closest('[role="dialog"], [role="alertdialog"]')) return
  if (canFocus(remembered, layer)) {
    remembered.focus({ preventScroll: true })
    if (document.activeElement === remembered) return
  }
  layer.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
}

/** Browsers without the Web Animations API (and jsdom) switch screens without motion. */
const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'

/**
 * The view after the stack changed. A slide is planned for a single push, or for a pop (of one or
 * more screens: the top one slides out, the rest go at once); anything else changes instantly.
 */
function nextView(tab: TabId, view: StackView, stack: Route[], slide: boolean): StackView {
  const unchanged = { stack, exiting: view.exiting, transition: null }
  if (!slide) return unchanged
  const removed = view.stack.filter((route) => !stack.includes(route))
  const added = stack.filter((route) => !view.stack.includes(route))
  const oldTop = view.stack.at(-1)
  if (added.length === 0 && oldTop !== undefined && removed.includes(oldTop)) {
    const exit = routeKey(oldTop)
    return {
      stack,
      exiting: [...view.exiting, { key: exit, route: oldTop }],
      transition: { kind: 'pop', exit, uncover: topKey(tab, stack) },
    }
  }
  const newTop = added.length === 1 ? added[0] : undefined
  if (removed.length === 0 && newTop !== undefined && stack.at(-1) === newTop) {
    return { stack, exiting: view.exiting, transition: { kind: 'push', enter: routeKey(newTop), cover: topKey(tab, view.stack) } }
  }
  return unchanged
}

function durationOf(value: string): number {
  const text = value.trim()
  const amount = Number.parseFloat(text)
  if (!Number.isFinite(amount)) return 0
  return text.endsWith('ms') ? amount : text.endsWith('s') ? amount * 1000 : amount
}

const SLIDE_IN: Keyframe[] = [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }]
const SLIDE_OUT: Keyframe[] = [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }]
// The covered screen moves a third of the way (30% parallax) and stays visible while it moves;
// CSS hides covered screens once they are still.
const PARALLAX_OUT: Keyframe[] = [
  { transform: 'translateX(0)', visibility: 'visible' },
  { transform: 'translateX(-30%)', visibility: 'visible' },
]
const PARALLAX_IN: Keyframe[] = [{ transform: 'translateX(-30%)' }, { transform: 'translateX(0)' }]
// Reduce Motion: opacity only (DESIGN.md §10).
const FADE_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }]
const FADE_OUT: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }]
const STAY_VISIBLE: Keyframe[] = [{ visibility: 'visible' }, { visibility: 'visible' }]

/**
 * One tab's root screen and the screens pushed above it (docs/SPEC.md §5.5). Roots carry
 * data-testid "screen-<tab>", pushed screens "screen-<route name>", and the screen on top of the
 * active tab data-active="true". Screens under the top one stay mounted, inert and hidden, so
 * going back finds them as they were. An in-app push or pop slides (--dur-push, --ease-push, the
 * covered screen with a 30% parallax); a pop from the system back gesture does not, because the
 * browser animates it already. With Reduce Motion the screens fade.
 *
 * Focus follows the screen on top: a pushed screen's heading takes it, and a pop returns it to
 * the control the uncovered screen last had focused (or pressed), else to its heading. A tab
 * switch leaves focus on the tab button.
 */
export function ScreenStack({ tab }: ScreenStackProps) {
  const stack = useNav((s) => s.stacks[tab])
  const activeTab = useNav((s) => s.tab === tab)
  const stackMotion = useNav((s) => s.stackMotion)
  const containerRef = useRef<HTMLDivElement>(null)
  /**
   * The transition already animated. <Activity> destroys a hidden tab's effects and re-creates
   * them when the tab shows again, which must not replay its last slide.
   */
  const played = useRef<Transition | null>(null)
  const [view, setView] = useState<StackView>(() => ({ stack, exiting: [], transition: null }))
  /** The control each layer last had focused or pressed, by layer key. */
  const [lastFocus] = useState(() => new Map<string, HTMLElement>())
  /** The top layer focus was last moved for; null before the first commit. */
  const focusedTop = useRef<string | null>(null)

  // Derived during render (not in an effect), so a popped screen never disappears for a frame
  // before its exit starts.
  if (view.stack !== stack) {
    setView(nextView(tab, view, stack, canAnimate && activeTab && stackMotion === 'slide'))
  }

  const { transition } = view
  useLayoutEffect(() => {
    const container = containerRef.current
    if (transition === null || container === null || played.current === transition) return undefined
    played.current = transition
    const layer = (key: string): HTMLElement | null => container.querySelector(`[data-layer="${key}"]`)
    const finishExit = (): void => {
      if (transition.kind === 'pop') setView((v) => ({ ...v, exiting: v.exiting.filter((x) => x.key !== transition.exit) }))
    }

    const style = getComputedStyle(container)
    const timing: KeyframeAnimationOptions = {
      duration: durationOf(style.getPropertyValue('--dur-push')),
      easing: style.getPropertyValue('--ease-push').trim() || 'ease-out',
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animations: Animation[] = []
    const run = (element: HTMLElement | null, keyframes: Keyframe[], fill: FillMode = 'none'): Animation | null => {
      if (element === null) return null
      try {
        const animation = element.animate(keyframes, { ...timing, fill })
        animations.push(animation)
        return animation
      } catch {
        // An easing the engine cannot parse: no motion, just the result.
        return null
      }
    }

    if (transition.kind === 'push') {
      run(layer(transition.enter), reduced ? FADE_IN : SLIDE_IN)
      run(layer(transition.cover), reduced ? STAY_VISIBLE : PARALLAX_OUT)
    } else {
      run(layer(transition.uncover), reduced ? FADE_IN : PARALLAX_IN)
      // fill forwards keeps the screen off screen until React removes it.
      const exit = run(layer(transition.exit), reduced ? FADE_OUT : SLIDE_OUT, 'forwards')
      if (exit === null) void Promise.resolve().then(finishExit)
      else exit.finished.then(finishExit, finishExit)
    }
    // A newer change cuts this one short: jump to the end state, which also removes the exit.
    return () => {
      for (const animation of animations) animation.finish()
    }
  }, [transition])

  // Record, per layer, where the user was: focus, and presses (WebKit does not focus a tapped button).
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return undefined
    const record = (event: Event): void => {
      if (!(event.target instanceof Element)) return
      const control = event.type === 'focusin' ? event.target : event.target.closest(CONTROL)
      if (!(control instanceof HTMLElement)) return
      const layer = control.closest<HTMLElement>('[data-layer]')?.dataset.layer
      if (layer !== undefined) lastFocus.set(layer, control)
    }
    container.addEventListener('focusin', record, true)
    container.addEventListener('click', record, true)
    return () => {
      container.removeEventListener('focusin', record, true)
      container.removeEventListener('click', record, true)
    }
  }, [lastFocus])

  const top = topKey(tab, stack)
  const root = rootKey(tab)

  // Focus follows a push or pop on the tab the user sees (not a tab switch: the top is unchanged).
  useLayoutEffect(() => {
    const before = focusedTop.current
    focusedTop.current = top
    if (before === null || before === top || !activeTab) return
    const layer = containerRef.current?.querySelector<HTMLElement>(`[data-layer="${top}"]`)
    if (layer !== null && layer !== undefined) focusLayer(layer, lastFocus.get(top))
    // Layers that are gone keep no record.
    const live = new Set([root, ...stack.map(routeKey)])
    for (const key of lastFocus.keys()) if (!live.has(key)) lastFocus.delete(key)
  }, [top, activeTab, root, stack, lastFocus])

  return (
    <div ref={containerRef} className={styles.stack}>
      <ScreenLayer
        layerKey={root}
        tab={tab}
        route={null}
        position={top === root ? 'top' : 'covered'}
        visible={activeTab && top === root}
      />
      {stack.map((route) => {
        const key = routeKey(route)
        return (
          <ScreenLayer
            key={key}
            layerKey={key}
            tab={tab}
            route={route}
            position={key === top ? 'top' : 'covered'}
            visible={activeTab && key === top}
          />
        )
      })}
      {view.exiting.map((screen) => (
        <ScreenLayer key={screen.key} layerKey={screen.key} tab={tab} route={screen.route} position="exiting" visible={false} />
      ))}
    </div>
  )
}

interface ScreenLayerProps {
  layerKey: string
  tab: TabId
  /** null for the tab root. */
  route: Route | null
  position: Position
  /** The screen the user sees: on top of the active tab. */
  visible: boolean
}

function popScreen(): void {
  useNav.getState().pop()
}

function ScreenLayer({ layerKey, tab, route, position, visible }: ScreenLayerProps) {
  const hidden = position !== 'top'
  return (
    <div
      // The app banners go into the slot of the screen the user sees (AppBanners).
      ref={visible ? visibleScreenRef : undefined}
      className={styles.layer}
      data-layer={layerKey}
      data-position={position}
      data-testid={route === null ? `screen-${tab}` : `screen-${route.name}`}
      data-active={visible ? 'true' : undefined}
      inert={hidden}
      aria-hidden={hidden || undefined}
    >
      <ScreenContent tab={tab} route={route} />
    </div>
  )
}

/** Memoised: a screen does not re-render when it is merely covered or uncovered. */
const ScreenContent = memo(function ScreenContent({ tab, route }: { tab: TabId; route: Route | null }) {
  return (
    <ErrorBoundary level="screen" onDismiss={route === null ? undefined : popScreen}>
      {route === null ? <TabRoot tab={tab} /> : <RouteScreen route={route} />}
    </ErrorBoundary>
  )
})

function TabRoot({ tab }: { tab: TabId }) {
  const Root = TAB_ROOTS[tab]
  return <Root />
}

function RouteScreen({ route }: { route: Route }) {
  const { name, ...props } = route
  // SCREENS maps each name to the component for that route's props, which TypeScript cannot
  // correlate through a union.
  const Screen = SCREENS[name] as ComponentType<Record<string, unknown>>
  return <Screen {...props} />
}
