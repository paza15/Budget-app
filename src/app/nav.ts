import { useMemo } from 'react'
import { create } from 'zustand'
import { addMonths } from '@/domain/dates'
import { periodOf } from '@/domain/period'
import { firstPeriod } from '@/domain/queries'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import type { EveryMonths, MonthKey, TxKind } from '@/domain/types'
import { getData, useAppStore } from '@/store/appStore'
import { memoByData } from '@/store/selectors'
import { getToday, useToday } from '@/store/today'
import { confirmDialog } from '@/ui'

/**
 * Navigation state (docs/SPEC.md §5.5): the active tab, a stack of pushed screens per tab, the
 * open sheets, the month shared by Home, Daily and Fixed, and the Fixed segment. Features navigate
 * only through this module.
 *
 * Browser history mirrors the screens and sheets above the active tab's root, one entry each, so
 * the system back gesture (Android, Safari) pops what the user sees. Opening something changes
 * the state at once and then adds the history entry. Going back (in-app Back, Cancel, close, a
 * tap on the active tab) only asks history to go back: the popstate listener applies the pop, so
 * it is the one place that pops a screen or closes a sheet, whoever started it.
 */

export type TabId = 'home' | 'daily' | 'fixed' | 'wallet'

/** Tabs in tab-bar order. The add button sits between daily and fixed and is not a tab. */
export const TAB_IDS: readonly TabId[] = ['home', 'daily', 'fixed', 'wallet']

/** A screen pushed onto the current tab's stack. */
export type Route =
  | { name: 'category'; categoryId: string }
  /** Settings ("You"), pushed on the Home stack from the monogram (§3). */
  | { name: 'you' }
  /** "Owed to you"; `person` opens it at that person (a person row of Home's card, EXTRAS.md §2.6). */
  | { name: 'owed'; person?: string }
  | { name: 'you.homeLayout' }
  | { name: 'you.currency' }
  | { name: 'you.numberFormat' }
  | { name: 'you.monthStart' }
  | { name: 'you.categories' }
  | { name: 'you.quickAdds' }
  | { name: 'you.backup' }
  | { name: 'you.about' }
  | { name: 'you.diagnostics' }
  | { name: 'you.privacy' }

/** A sheet opened above the tabs. Sheets stack; only the top one is interactive. */
export type SheetRoute =
  | { name: 'transaction'; id?: string; kind?: TxKind; categoryId?: string }
  | {
      name: 'recurring'
      id?: string
      kind?: TxKind
      preset?: { name?: string; categoryId?: string; everyMonths?: EveryMonths }
    }
  | { name: 'categoryEdit'; id?: string }
  | { name: 'quickAdd'; id?: string }
  | { name: 'savingsGoal'; month?: MonthKey }
  | { name: 'monthPicker' }
  | { name: 'pinSetup'; mode: 'enable' | 'change' }
  | { name: 'verifyOwner'; reason: string }
  /** "Erase all data", from About. The lock screen's "Forgot PIN?" erases in a view of its own (§3.7). */
  | { name: 'erase' }
  | { name: 'walletEntry'; id?: string; kind?: 'deposit' | 'withdrawal' }
  | { name: 'walletSettings' }
  | { name: 'goal'; id?: string }
  | { name: 'monthReview'; month: MonthKey }

export type RouteName = Route['name']
export type SheetName = SheetRoute['name']

/** Props of the screen registered for a route: the route without its name. */
export type RouteProps<N extends RouteName> = Omit<Extract<Route, { name: N }>, 'name'>

/** Props of the component registered for a sheet. */
export type SheetProps<N extends SheetName> = {
  route: Extract<SheetRoute, { name: N }>
  /** Closes this sheet (through history, like every in-app close). */
  onClose: () => void
  /** Marks unsaved changes: dismissing the sheet other than with its own buttons then asks first. */
  setDirty: (dirty: boolean) => void
}

/** An open sheet. `key` is unique for the page's lifetime and doubles as the React key. */
export interface SheetEntry {
  key: string
  route: SheetRoute
}

export type FixedSegment = 'costs' | 'income'

/**
 * How ScreenStack shows the latest change to a stack: slide (an in-app push or pop) or instant (a
 * pop from the system back gesture, which brings its own animation, or a cross-tab link).
 */
export type StackMotion = 'slide' | 'instant'

export interface NavState {
  tab: TabId
  /** Pushed screens per tab, root excluded; an empty stack shows the tab's root screen. */
  stacks: Record<TabId, Route[]>
  /** Open sheets, bottom to top. */
  sheets: SheetEntry[]
  /** The selected period, or null for the current one. */
  month: MonthKey | null
  fixedSegment: FixedSegment
  /**
   * The category Daily's chip row has selected (null: all). The tab bar's (+) starts a new expense
   * in it while Daily shows its root (docs/SPEC.md §3.4; see newExpenseRoute).
   */
  dailyCategory: string | null
  /** Keys of open sheets with unsaved changes (see SheetProps.setDirty). */
  dirty: Readonly<Record<string, true>>
  /** How the latest stack change should look. */
  stackMotion: StackMotion
  /** Switches tabs; tapping the active tab pops it to its root. */
  setTab(tab: TabId): void
  /** Switches to `tab` showing `route` (or its root) and closes all sheets. */
  navigate(tab: TabId, route?: Route): void
  push(route: Route): void
  /** Pops the current tab's top screen; no-op at the root. */
  pop(): void
  /** Opens a sheet above the others and returns its entry key. */
  openSheet(route: SheetRoute): string
  /** Closes the sheet with this key, by default the top-most one. An unknown key is a no-op. */
  closeSheet(key?: string): void
  /** Selects a period. Selecting the current period stores null. */
  setMonth(month: MonthKey | null): void
  setFixedSegment(segment: FixedSegment): void
  /** Daily reports its chip here (null for all categories). */
  setDailyCategory(categoryId: string | null): void
  /** Records whether an open sheet has unsaved changes. SheetHost passes it on as setDirty. */
  setSheetDirty(key: string, dirty: boolean): void
  /**
   * Back to the initial state: Home at its root, no sheets, current month, costs, no Daily chip.
   * It also runs by itself when the app leaves the onboarded state (an erase, or a restored backup
   * that was never onboarded), so the old screens and sheets never come back after onboarding.
   */
  reset(): void
}

/** The navigable range of periods: firstPeriod … current + 12. */
export interface MonthBounds {
  first: MonthKey
  last: MonthKey
  current: MonthKey
}

type NavData = Pick<
  NavState,
  'tab' | 'stacks' | 'sheets' | 'month' | 'fixedSegment' | 'dailyCategory' | 'dirty' | 'stackMotion'
>

const NO_DIRTY: Readonly<Record<string, true>> = Object.freeze({})

/** Periods the month switcher reaches after the current one (§5.5). */
const MONTHS_AHEAD = 12

function initialNavData(): NavData {
  return {
    tab: 'home',
    stacks: { home: [], daily: [], fixed: [], wallet: [] },
    sheets: [],
    month: null,
    fixedSegment: 'costs',
    dailyCategory: null,
    dirty: NO_DIRTY,
    stackMotion: 'instant',
  }
}

/** The period containing today under the current start day. */
function currentPeriod(): MonthKey {
  return periodOf(getToday(), getData().settings.monthStartDay)
}

/** Counts opened sheets, so every entry key is new and React never reuses a closed sheet's state. */
let openedSheets = 0

/**
 * A stored copy of a route. Every push gets its own object, so ScreenStack can tell two pushes
 * of the same route apart (it keys screens by object).
 */
function copyRoute(route: Route): Route {
  return { ...route }
}

/**
 * The stack `navigate` builds. Settings pages live under the You screen on the Home stack, so a
 * link straight to one (Daily's "Edit" quick adds, Limits' "Set a limit") keeps Back leading to
 * settings (§5.5).
 */
function stackFor(tab: TabId, route: Route | undefined): Route[] {
  if (route === undefined) return []
  if (tab === 'home' && route.name.startsWith('you.')) return [{ name: 'you' }, copyRoute(route)]
  return [copyRoute(route)]
}

/** `dirty` without the keys of sheets that are no longer open. */
function pruneDirty(dirty: Readonly<Record<string, true>>, sheets: readonly SheetEntry[]): Readonly<Record<string, true>> {
  const keys = Object.keys(dirty)
  const open = keys.filter((key) => sheets.some((entry) => entry.key === key))
  if (open.length === keys.length) return dirty
  if (open.length === 0) return NO_DIRTY
  return Object.fromEntries(open.map((key) => [key, true as const]))
}

export const useNav = create<NavState>()((set, get) => ({
  ...initialNavData(),

  setTab(tab) {
    if (tab === get().tab) {
      popToRoot()
      return
    }
    set({ tab })
    scheduleSync()
  },

  navigate(tab, route) {
    const { stacks, sheets, dirty } = get()
    set({
      tab,
      stacks: { ...stacks, [tab]: stackFor(tab, route) },
      sheets: sheets.length > 0 ? [] : sheets,
      dirty: sheets.length > 0 ? NO_DIRTY : dirty,
      stackMotion: 'instant',
    })
    scheduleSync()
  },

  push(route) {
    const { tab, stacks } = get()
    set({ stacks: { ...stacks, [tab]: [...stacks[tab], copyRoute(route)] }, stackMotion: 'slide' })
    scheduleSync()
  },

  pop() {
    const { tab, stacks } = get()
    if (stacks[tab].length > 0) goBack({ kind: 'screen' })
  },

  openSheet(route) {
    openedSheets += 1
    const key = `sheet-${openedSheets}`
    set({ sheets: [...get().sheets, { key, route }] })
    scheduleSync()
    return key
  },

  closeSheet(key) {
    const { sheets } = get()
    const entry = key === undefined ? sheets.at(-1) : sheets.find((item) => item.key === key)
    if (entry !== undefined) goBack({ kind: 'sheet', key: entry.key })
  },

  setMonth(month) {
    const next = month === null || month === currentPeriod() ? null : month
    if (next !== get().month) set({ month: next })
  },

  setFixedSegment(fixedSegment) {
    set({ fixedSegment })
  },

  setDailyCategory(dailyCategory) {
    if (dailyCategory !== get().dailyCategory) set({ dailyCategory })
  },

  setSheetDirty(key, dirty) {
    const state = get()
    if (dirty === (state.dirty[key] === true)) return
    if (dirty) {
      if (state.sheets.some((entry) => entry.key === key)) set({ dirty: { ...state.dirty, [key]: true } })
    } else {
      set({ dirty: pruneDirty(state.dirty, state.sheets.filter((entry) => entry.key !== key)) })
    }
  },

  reset() {
    set(initialNavData())
    scheduleSync()
  },
}))

useAppStore.subscribe((state, previous) => {
  const settings = state.data.settings
  const before = previous.data.settings
  // Leaving the onboarded state (an erase, or a restored backup that was never onboarded) starts
  // navigation afresh: the stacks and sheets of the old data must not reopen after onboarding.
  if (before.onboarded && !settings.onboarded) {
    useNav.getState().reset()
    return
  }
  // The same month key names a different period once the start day changes (§4.3), so the
  // selection returns to the current period.
  if (settings.monthStartDay !== before.monthStartDay && useNav.getState().month !== null) {
    useNav.setState({ month: null })
  }
})

/** The selected period: `month`, or the current period when it is null. */
export function useSelectedMonth(): MonthKey {
  const month = useNav((s) => s.month)
  const startDay = useAppStore((s) => s.data.settings.monthStartDay)
  const today = useToday()
  return month ?? periodOf(today, startDay)
}

/**
 * The sheet the tab bar's (+) opens: a new expense in "the one passed in" (docs/SPEC.md §3.4). That
 * is the category whose detail is the visible screen (not Uncategorized), else Daily's chip while
 * Daily shows its root, else none. TransactionSheet ignores an id that is not an active category.
 */
export function newExpenseRoute(
  state: Pick<NavState, 'tab' | 'stacks' | 'dailyCategory'> = useNav.getState(),
): Extract<SheetRoute, { name: 'transaction' }> {
  const top = state.stacks[state.tab].at(-1)
  let categoryId: string | null = null
  if (top?.name === 'category') {
    if (top.categoryId !== UNCATEGORIZED_ID) categoryId = top.categoryId
  } else if (top === undefined && state.tab === 'daily') {
    categoryId = state.dailyCategory
  }
  return categoryId === null ? { name: 'transaction' } : { name: 'transaction', categoryId }
}

/** The periods the month switcher can reach: firstPeriod … current + 12. */
export function useMonthBounds(): MonthBounds {
  const data = useAppStore((s) => s.data)
  const today = useToday()
  const first = memoByData(data, `nav.firstPeriod|${today}`, () => firstPeriod(data, today))
  const current = periodOf(today, data.settings.monthStartDay)
  return useMemo(() => ({ first, last: addMonths(current, MONTHS_AHEAD), current }), [first, current])
}

// ---------------------------------------------------------------------------------------------
// History (§5.5)

/** What a back traversal started in the app should do once history has gone back. */
type BackIntent = { kind: 'screen' } | { kind: 'sheet'; key: string } | { kind: 'root' }

interface Traversal {
  /** app: the app asked to go back and applies `intent` on popstate. sync: history catching up. */
  reason: 'app' | 'sync'
  intent: BackIntent | null
  /** The depth history lands on. */
  expected: number
}

/** State of the app's history entries: how many screens and sheets lie above the tab root. */
interface HistoryState {
  onabudget: number
}

/**
 * When popstate has not arrived by then, the traversal counts as done anyway, so the app never
 * stops responding to Back. A late popstate then finds the app already in step and changes nothing.
 */
const TRAVERSAL_TIMEOUT_MS = 800

/** Back to the current period after the app has been hidden this long (§5.5). */
const MONTH_RESET_AFTER_MS = 30 * 60_000

let installed = false
/** Depth of the current history entry (0 is the root entry). */
let depth = 0
let inFlight: Traversal | null = null
let traversalTimer: ReturnType<typeof setTimeout> | undefined
/**
 * Work that touches history waits here while a traversal is in flight: a pushState racing a
 * history.go() can cancel the traversal, and the next step depends on where history lands.
 */
let queue: (() => void)[] = []
let syncQueued = false
/** A discard question for a sheet left by the system back gesture is open. */
let confirming = false
let hiddenAt: number | null = null

/** Screens and sheets above the active tab's root: the history depth the app needs. */
function appDepth(state: NavData = useNav.getState()): number {
  return state.sheets.length + state.stacks[state.tab].length
}

function depthOf(state: unknown): number {
  if (typeof state !== 'object' || state === null || !Object.hasOwn(state, 'onabudget')) return 0
  const value = (state as HistoryState).onabudget
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

function whenIdle(op: () => void): void {
  if (inFlight === null) op()
  else queue.push(op)
}

function drainQueue(): void {
  while (queue.length > 0) {
    // An op that starts a traversal leaves the rest for its popstate.
    if (inFlight !== null) return
    queue.shift()?.()
  }
}

function startTraversal(delta: number, traversal: Traversal): void {
  inFlight = traversal
  clearTimeout(traversalTimer)
  traversalTimer = setTimeout(onTraversalTimeout, TRAVERSAL_TIMEOUT_MS)
  window.history.go(delta)
}

/** Brings history in line with the app: adds missing entries, or goes back over extra ones. */
function scheduleSync(): void {
  if (!installed || syncQueued) return
  syncQueued = true
  whenIdle(() => {
    syncQueued = false
    const wanted = appDepth()
    while (depth < wanted) {
      depth += 1
      window.history.pushState({ onabudget: depth } satisfies HistoryState, '')
    }
    if (depth > wanted) startTraversal(wanted - depth, { reason: 'sync', intent: null, expected: wanted })
  })
}

/** Closes sheets and pops the active stack in one update. */
function commitBack(state: NavState, sheets: SheetEntry[], stack: Route[], animate: boolean): void {
  const patch: Partial<NavData> = {}
  if (sheets !== state.sheets) {
    patch.sheets = sheets
    patch.dirty = pruneDirty(state.dirty, sheets)
  }
  if (stack !== state.stacks[state.tab]) {
    patch.stacks = { ...state.stacks, [state.tab]: stack }
    patch.stackMotion = animate ? 'slide' : 'instant'
  }
  if (Object.keys(patch).length > 0) useNav.setState(patch)
}

/** Whether `intent` still has something to pop. */
function applies(intent: BackIntent, state: NavState = useNav.getState()): boolean {
  if (intent.kind === 'sheet') return state.sheets.some((entry) => entry.key === intent.key)
  if (intent.kind === 'screen') return state.stacks[state.tab].length > 0
  return appDepth(state) > 0
}

function applyIntent(intent: BackIntent, animate: boolean): void {
  const state = useNav.getState()
  if (!applies(intent, state)) return
  const stack = state.stacks[state.tab]
  if (intent.kind === 'sheet') {
    commitBack(state, state.sheets.filter((entry) => entry.key !== intent.key), stack, animate)
  } else if (intent.kind === 'screen') {
    commitBack(state, state.sheets, stack.slice(0, -1), animate)
  } else {
    commitBack(state, state.sheets.length > 0 ? [] : state.sheets, stack.length > 0 ? [] : stack, animate)
  }
}

/** Pops `levels` from the top: sheets first, then the active tab's screens. */
function popLevels(levels: number, animate: boolean): void {
  const state = useNav.getState()
  let sheets = state.sheets
  let stack = state.stacks[state.tab]
  for (let i = 0; i < levels; i += 1) {
    if (sheets.length > 0) sheets = sheets.slice(0, -1)
    else if (stack.length > 0) stack = stack.slice(0, -1)
    else break
  }
  commitBack(state, sheets, stack, animate)
}

/** In-app back: history goes back one entry and popstate applies `intent` with a slide. */
function goBack(intent: BackIntent): void {
  whenIdle(() => {
    if (!applies(intent)) return
    if (!installed || depth === 0) {
      // No entry of ours to go back over (history not installed, as in component tests).
      applyIntent(intent, true)
      scheduleSync()
      return
    }
    startTraversal(-1, { reason: 'app', intent, expected: depth - 1 })
  })
}

/** A tap on the active tab: back to its root, closing any sheet (history.go(−depth)). */
function popToRoot(): void {
  whenIdle(() => {
    const levels = appDepth()
    if (levels === 0) return
    if (!installed || depth < levels) {
      applyIntent({ kind: 'root' }, true)
      scheduleSync()
      return
    }
    startTraversal(-levels, { reason: 'app', intent: { kind: 'root' }, expected: depth - levels })
  })
}

/**
 * What a sheet with unsaved changes asks before it is dismissed other than with its own buttons
 * (§5.10 rule 5): a new expense is discarded as a whole, anything else loses its changes.
 */
export function discardTitleFor(route: SheetRoute): string {
  const newExpense = route.name === 'transaction' && route.id === undefined && route.kind !== 'income'
  return newExpense ? 'Discard this expense?' : 'Discard changes?'
}

async function askBeforeDiscarding(entry: SheetEntry): Promise<void> {
  if (confirming) return
  confirming = true
  try {
    const discard = await confirmDialog({
      title: discardTitleFor(entry.route),
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      destructive: true,
    })
    if (discard) useNav.getState().closeSheet(entry.key)
  } finally {
    confirming = false
  }
}

/** The system back gesture (or the browser's buttons) moved history without the app asking. */
function onSystemTraversal(target: number): void {
  const state = useNav.getState()
  const excess = appDepth(state) - target
  // Forward, or already in step: scheduleSync settles history.
  if (excess <= 0) return
  const top = state.sheets.at(-1)
  if (top !== undefined && state.dirty[top.key] === true) {
    // Unsaved changes: keep the sheet (scheduleSync puts its entry back) and ask.
    void askBeforeDiscarding(top)
    return
  }
  popLevels(excess, false)
}

function onPopState(event: PopStateEvent): void {
  const traversal = inFlight
  inFlight = null
  clearTimeout(traversalTimer)
  depth = depthOf(event.state)
  if (traversal === null) onSystemTraversal(depth)
  else if (traversal.intent !== null) applyIntent(traversal.intent, true)
  drainQueue()
  scheduleSync()
}

function onTraversalTimeout(): void {
  const traversal = inFlight
  if (traversal === null) return
  inFlight = null
  depth = traversal.expected
  if (traversal.intent !== null) applyIntent(traversal.intent, true)
  drainQueue()
  scheduleSync()
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    hiddenAt ??= Date.now()
    return
  }
  if (hiddenAt !== null && Date.now() - hiddenAt >= MONTH_RESET_AFTER_MS) useNav.getState().setMonth(null)
  hiddenAt = null
}

function uninstallNavigation(): void {
  if (!installed) return
  installed = false
  window.removeEventListener('popstate', onPopState)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  clearTimeout(traversalTimer)
  inFlight = null
  queue = []
  syncQueued = false
  hiddenAt = null
}

/**
 * Connects navigation to browser history (main.tsx calls it once, before the first render):
 * replaces the current entry with the root entry, listens for popstate, and resets the selected
 * month when the app comes back after 30 minutes or more. Returns a function that disconnects it.
 */
export function installNavigation(): () => void {
  if (!installed) {
    installed = true
    depth = 0
    inFlight = null
    queue = []
    window.history.replaceState({ onabudget: 0 } satisfies HistoryState, '')
    window.addEventListener('popstate', onPopState)
    document.addEventListener('visibilitychange', onVisibilityChange)
    scheduleSync()
  }
  return uninstallNavigation
}

/** Disconnects history and resets the store and module state between tests. */
export function __resetNavForTests(): void {
  uninstallNavigation()
  depth = 0
  confirming = false
  useNav.setState(initialNavData())
}
