import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withUndo } from '@/app/undo'
import { DEFAULT_CATEGORY_IDS } from '@/domain/defaults'
import { makeData, NOW, TODAY } from '@/domain/test-helpers/dataFixtures'
import { actions } from '@/store/actions'
import { getData, useAppStore } from '@/store/appStore'
import { currentToast, dismissToast } from '@/ui/toast'

function addCoffee(): void {
  actions.addTransaction({ kind: 'expense', amount: 350, categoryId: DEFAULT_CATEGORY_IDS.coffee, date: TODAY })
}

/** Actions throw a RangeError for invalid input (docs/SPEC.md §5.4). */
function addNothingValid(): void {
  actions.addTransaction({ kind: 'expense', amount: 0, categoryId: DEFAULT_CATEGORY_IDS.coffee, date: TODAY })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  useAppStore.setState({ data: makeData(), status: 'ready' })
})

afterEach(() => {
  const toast = currentToast()
  if (toast !== null) dismissToast(toast.id)
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('withUndo (docs/SPEC.md §5.5)', () => {
  it('shows the message with Undo for 6 seconds', async () => {
    await withUndo('Added 3,50 € to Coffee & snacks', addCoffee)
    expect(getData().transactions).toHaveLength(1)
    expect(currentToast()).toMatchObject({ message: 'Added 3,50 € to Coffee & snacks', leaving: false })
    expect(currentToast()?.action?.label).toBe('Undo')

    vi.advanceTimersByTime(5999)
    expect(currentToast()?.leaving).toBe(false)
    vi.advanceTimersByTime(1)
    expect(currentToast()?.leaving).toBe(true)
  })

  it('restores the data from before the change', async () => {
    const before = getData()
    await withUndo('Deleted', addCoffee)
    expect(getData()).not.toBe(before)
    currentToast()?.action?.onClick()
    expect(getData()).toBe(before)
  })

  it('dismisses itself as soon as the data changes again', async () => {
    await withUndo('Added', addCoffee)
    const toast = currentToast()
    actions.updateSettings({ name: 'Ana' })
    expect(currentToast()?.leaving).toBe(true)

    // Undo from a toast that has gone would throw the later change away too: it does nothing.
    const afterLater = getData()
    toast?.action?.onClick()
    expect(getData()).toBe(afterLater)
  })

  it('awaits an async change and takes its own duration', async () => {
    await withUndo(
      'Backup restored',
      async () => {
        await Promise.resolve()
        addCoffee()
      },
      { durationMs: 10_000 },
    )
    expect(getData().transactions).toHaveLength(1)
    vi.advanceTimersByTime(9999)
    expect(currentToast()?.leaving).toBe(false)
    vi.advanceTimersByTime(1)
    expect(currentToast()?.leaving).toBe(true)
  })

  it('shows nothing when the change throws', async () => {
    await expect(withUndo('Added', addNothingValid)).rejects.toThrow(RangeError)
    expect(currentToast()).toBeNull()
  })

  it('stops watching the data once the toast has gone', async () => {
    const unsubscribe = vi.fn<() => void>()
    const subscribe = vi.spyOn(useAppStore, 'subscribe').mockImplementation(() => unsubscribe)
    await withUndo('Added', addCoffee)
    expect(subscribe).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(7000)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
