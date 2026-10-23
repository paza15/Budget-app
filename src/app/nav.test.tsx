import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetNavForTests,
  discardTitleFor,
  installNavigation,
  newExpenseRoute,
  useMonthBounds,
  useNav,
  useSelectedMonth,
  type NavState,
} from '@/app/nav'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import { makeData, NOW } from '@/domain/test-helpers/dataFixtures'
import { useAppStore } from '@/store/appStore'
import { answerDialog, currentDialog, removeDialog } from '@/ui/dialogs'

/** Screens and sheets above the active tab's root: the history depth the app should be at. */
function depthOf(state: NavState = useNav.getState()): number {
  return state.sheets.length + state.stacks[state.tab].length
}

function historyDepth(): number | undefined {
  return (window.history.state as { onabudget?: number } | null)?.onabudget
}

/** Waits until history and the nav state agree at `depth`, with no traversal left to arrive. */
async function settledAt(depth: number): Promise<void> {
  await waitFor(() => {
    expect(depthOf()).toBe(depth)
    expect(historyDepth()).toBe(depth)
  })
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Answers the open confirmDialog and takes it off the queue, as ConfirmHost would. */
function answer(confirmed: boolean): void {
  const dialog = currentDialog()
  if (dialog === null) throw new Error('no dialog')
  answerDialog(dialog.id, confirmed)
  removeDialog(dialog.id)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  useAppStore.setState({ data: makeData(), status: 'ready' })
  __resetNavForTests()
  installNavigation()
})

afterEach(() => {
  // Leave history at the root and no question open, so the next test starts clean.
  __resetNavForTests()
  for (let dialog = currentDialog(); dialog !== null; dialog = currentDialog()) {
    answerDialog(dialog.id, null)
    removeDialog(dialog.id)
  }
  Reflect.deleteProperty(document, 'visibilityState')
  useAppStore.setState(useAppStore.getInitialState(), true)
  vi.useRealTimers()
})

describe('history sync (docs/SPEC.md §5.5)', () => {
  it('starts from the root entry', () => {
    expect(window.history.state).toEqual({ onabudget: 0 })
    expect(useNav.getState().tab).toBe('home')
  })

  it('adds one history entry for each push and each sheet', () => {
    const before = window.history.length
    useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' })
    expect(window.history.state).toEqual({ onabudget: 1 })
    useNav.getState().openSheet({ name: 'transaction' })
    expect(window.history.state).toEqual({ onabudget: 2 })
    expect(window.history.length).toBe(before + 2)
  })

  it('closes a sheet only when popstate arrives', async () => {
    const key = useNav.getState().openSheet({ name: 'monthPicker' })
    useNav.getState().closeSheet(key)
    // History goes back first; popstate is the one place that closes it.
    expect(useNav.getState().sheets).toHaveLength(1)
    await settledAt(0)
    expect(useNav.getState().sheets).toEqual([])
  })

  it('pops the top sheet first on a system back, then the screen, without a slide', async () => {
    useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' })
    useNav.getState().openSheet({ name: 'transaction' })
    useNav.getState().openSheet({ name: 'monthPicker' })

    window.history.back()
    await settledAt(2)
    expect(useNav.getState().sheets.map((s) => s.route.name)).toEqual(['transaction'])
    expect(useNav.getState().stacks.home).toHaveLength(1)

    window.history.back()
    await settledAt(1)
    expect(useNav.getState().sheets).toEqual([])

    window.history.back()
    await settledAt(0)
    expect(useNav.getState().stacks.home).toEqual([])
    // The system gesture animates the pop itself.
    expect(useNav.getState().stackMotion).toBe('instant')
  })

  it('pops a screen with a slide when the app asks', async () => {
    useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' })
    expect(useNav.getState().stackMotion).toBe('slide')
    useNav.getState().pop()
    expect(useNav.getState().stacks.home).toHaveLength(1)
    await settledAt(0)
    expect(useNav.getState().stackMotion).toBe('slide')
  })

  it('pops the active tab to its root, closing sheets, when the tab is tapped again', async () => {
    const { push, openSheet } = useNav.getState()
    push({ name: 'category', categoryId: 'cat-coffee' })
    push({ name: 'category', categoryId: 'cat-eating' })
    openSheet({ name: 'transaction' })
    await settledAt(3)

    useNav.getState().setTab('home')
    await settledAt(0)
    expect(useNav.getState().stacks.home).toEqual([])
    expect(useNav.getState().sheets).toEqual([])
    expect(useNav.getState().tab).toBe('home')
  })

  it('keeps each tab its own stack, and history follows the active one', async () => {
    useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' })
    useNav.getState().setTab('daily')
    await settledAt(0)
    expect(useNav.getState().stacks.home).toHaveLength(1)

    useNav.getState().setTab('home')
    await settledAt(1)
    expect(useNav.getState().stacks.home.map((r) => r.name)).toEqual(['category'])

    useNav.getState().setTab('wallet')
    await settledAt(0)
    expect(useNav.getState().tab).toBe('wallet')
  })

  it('puts settings under You on the Home stack, and navigate closes every sheet', async () => {
    useNav.getState().openSheet({ name: 'transaction' })
    useNav.getState().navigate('home', { name: 'you.quickAdds' })
    expect(useNav.getState().sheets).toEqual([])
    expect(useNav.getState().stacks.home.map((r) => r.name)).toEqual(['you', 'you.quickAdds'])
    await settledAt(2)

    // Back leads to settings, then Home.
    useNav.getState().pop()
    await settledAt(1)
    expect(useNav.getState().stacks.home.map((r) => r.name)).toEqual(['you'])

    useNav.getState().navigate('wallet')
    await settledAt(0)
    expect(useNav.getState().tab).toBe('wallet')
  })

  it('keeps a dirty sheet after a system back until the user discards it', async () => {
    const key = useNav.getState().openSheet({ name: 'transaction' })
    useNav.getState().setSheetDirty(key, true)

    window.history.back()
    await waitFor(() => expect(currentDialog()?.options.title).toBe('Discard this expense?'))
    // Its history entry comes back while the question is open.
    await settledAt(1)
    answer(false)
    await settledAt(1)
    expect(useNav.getState().sheets.map((s) => s.key)).toEqual([key])

    window.history.back()
    await waitFor(() => expect(currentDialog()).not.toBeNull())
    answer(true)
    await settledAt(0)
    expect(useNav.getState().sheets).toEqual([])
    expect(useNav.getState().dirty).toEqual({})
  })
})

describe('sheets', () => {
  it('returns a new key for every sheet and closes the top one by default', async () => {
    const first = useNav.getState().openSheet({ name: 'transaction' })
    const second = useNav.getState().openSheet({ name: 'monthPicker' })
    expect(first).not.toBe(second)
    useNav.getState().closeSheet()
    await settledAt(1)
    expect(useNav.getState().sheets.map((s) => s.key)).toEqual([first])
  })

  it('ignores an unknown key', () => {
    useNav.getState().openSheet({ name: 'transaction' })
    useNav.getState().closeSheet('sheet-unknown')
    expect(useNav.getState().sheets).toHaveLength(1)
    expect(historyDepth()).toBe(1)
  })

  it('forgets dirty marks of sheets that closed', async () => {
    const key = useNav.getState().openSheet({ name: 'recurring' })
    useNav.getState().setSheetDirty(key, true)
    expect(useNav.getState().dirty).toEqual({ [key]: true })
    useNav.getState().setSheetDirty(key, false)
    expect(useNav.getState().dirty).toEqual({})
    useNav.getState().setSheetDirty('sheet-closed', true)
    expect(useNav.getState().dirty).toEqual({})
  })

  it('asks to discard a new expense, and changes to anything else', () => {
    expect(discardTitleFor({ name: 'transaction' })).toBe('Discard this expense?')
    expect(discardTitleFor({ name: 'transaction', id: 'tx-1' })).toBe('Discard changes?')
    expect(discardTitleFor({ name: 'transaction', kind: 'income' })).toBe('Discard changes?')
    expect(discardTitleFor({ name: 'recurring' })).toBe('Discard changes?')
  })
})

describe('the selected month', () => {
  it('stores null for the current period', () => {
    useNav.getState().setMonth('2026-09')
    expect(useNav.getState().month).toBe('2026-09')
    useNav.getState().setMonth('2026-10')
    expect(useNav.getState().month).toBeNull()
  })

  it('reads the current period while nothing is selected', () => {
    const { result } = renderHook(() => useSelectedMonth())
    expect(result.current).toBe('2026-10')
  })

  it('reaches from the first period with data to twelve months ahead', () => {
    const { result } = renderHook(() => useMonthBounds())
    expect(result.current).toEqual({ first: '2026-08', last: '2027-10', current: '2026-10' })
  })

  it('returns to the current period after 30 minutes in the background', () => {
    useNav.getState().setMonth('2026-08')
    setVisibility('hidden')
    vi.setSystemTime(NOW + 29 * 60_000)
    setVisibility('visible')
    expect(useNav.getState().month).toBe('2026-08')

    setVisibility('hidden')
    vi.setSystemTime(NOW + 60 * 60_000)
    setVisibility('visible')
    expect(useNav.getState().month).toBeNull()
  })

  it('returns to the current period when the month start day changes', () => {
    useNav.getState().setMonth('2026-08')
    const data = useAppStore.getState().data
    useAppStore.setState({ data: { ...data, settings: { ...data.settings, monthStartDay: 25 } } })
    expect(useNav.getState().month).toBeNull()
  })
})

describe('route parameters', () => {
  it('keeps the person the owed screen opens at (EXTRAS.md §2.6)', async () => {
    useNav.getState().push({ name: 'owed', person: 'Max' })
    expect(useNav.getState().stacks.home).toEqual([{ name: 'owed', person: 'Max' }])
    useNav.getState().push({ name: 'owed' })
    await settledAt(2)
    expect(useNav.getState().stacks.home).toEqual([{ name: 'owed', person: 'Max' }, { name: 'owed' }])
  })
})

describe("the tab bar's new expense (docs/SPEC.md §3.4)", () => {
  it('starts in the category whose detail is on screen', () => {
    useNav.getState().push({ name: 'category', categoryId: 'cat-coffee' })
    expect(newExpenseRoute()).toEqual({ name: 'transaction', categoryId: 'cat-coffee' })
  })

  it("starts without a category on Uncategorized's detail", () => {
    useNav.getState().push({ name: 'category', categoryId: UNCATEGORIZED_ID })
    expect(newExpenseRoute()).toEqual({ name: 'transaction' })
  })

  it("starts in Daily's chip while Daily shows its root, and only there", async () => {
    useNav.getState().setDailyCategory('cat-groceries')
    expect(newExpenseRoute()).toEqual({ name: 'transaction' })

    useNav.getState().setTab('daily')
    expect(newExpenseRoute()).toEqual({ name: 'transaction', categoryId: 'cat-groceries' })

    useNav.getState().push({ name: 'you.quickAdds' })
    expect(newExpenseRoute()).toEqual({ name: 'transaction' })
    useNav.getState().pop()
    await settledAt(0)

    useNav.getState().setDailyCategory(null)
    expect(newExpenseRoute()).toEqual({ name: 'transaction' })
  })

  it('forgets the chip on reset', () => {
    useNav.getState().setDailyCategory('cat-groceries')
    useNav.getState().reset()
    expect(useNav.getState().dailyCategory).toBeNull()
  })
})

/** Commits data with settings.onboarded set, as an erase or a restore does. */
function setOnboarded(onboarded: boolean): void {
  const data = useAppStore.getState().data
  useAppStore.setState({ data: { ...data, settings: { ...data.settings, onboarded } } })
}

describe('leaving the onboarded state', () => {
  it('starts navigation afresh after an erase or a restore that is not onboarded', async () => {
    setOnboarded(true)
    const { push, openSheet, setMonth, setFixedSegment, setDailyCategory } = useNav.getState()
    setMonth('2026-09')
    setFixedSegment('income')
    setDailyCategory('cat-coffee')
    push({ name: 'you' })
    push({ name: 'you.about' })
    openSheet({ name: 'erase' })
    await settledAt(3)

    setOnboarded(false)
    const state = useNav.getState()
    expect(state.tab).toBe('home')
    expect(state.stacks).toEqual({ home: [], daily: [], fixed: [], wallet: [] })
    expect(state.sheets).toEqual([])
    expect(state).toMatchObject({ month: null, fixedSegment: 'costs', dailyCategory: null, dirty: {} })
    // History goes back to the root entry with it.
    await settledAt(0)
  })

  it('leaves navigation alone while the app stays onboarded, or becomes onboarded', () => {
    useNav.getState().push({ name: 'you' })
    setOnboarded(true)
    expect(useNav.getState().stacks.home).toEqual([{ name: 'you' }])
    setOnboarded(true)
    expect(useNav.getState().stacks.home).toEqual([{ name: 'you' }])
  })
})
