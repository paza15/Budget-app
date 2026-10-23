import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getToday, useToday } from '@/store/today'

const SECOND = 1000
const HOUR = 3_600_000

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(document, 'visibilityState')
  vi.useRealTimers()
})

describe('useToday', () => {
  it('moves on just after local midnight', () => {
    vi.setSystemTime(new Date(2026, 9, 14, 23, 59, 58))
    const { result } = renderHook(() => useToday())
    expect(result.current).toBe('2026-10-14')

    act(() => vi.advanceTimersByTime(SECOND))
    expect(result.current).toBe('2026-10-14')
    act(() => vi.advanceTimersByTime(2.5 * SECOND))
    expect(result.current).toBe('2026-10-15')
  })

  it('keeps moving every midnight, across the end of summer time', () => {
    // 25 October 2026 has 25 hours in Berlin.
    vi.setSystemTime(new Date(2026, 9, 24, 23, 0))
    const { result } = renderHook(() => useToday())
    act(() => vi.advanceTimersByTime(HOUR + 2 * SECOND))
    expect(result.current).toBe('2026-10-25')
    act(() => vi.advanceTimersByTime(24 * HOUR))
    expect(result.current).toBe('2026-10-25')
    act(() => vi.advanceTimersByTime(HOUR))
    expect(result.current).toBe('2026-10-26')
  })

  it('catches up when the app becomes visible again after its timer slept', () => {
    vi.setSystemTime(new Date(2026, 9, 14, 9))
    const { result } = renderHook(() => useToday())
    // The clock moves on while the app is suspended; no timer fires.
    vi.setSystemTime(new Date(2026, 9, 16, 8))
    expect(result.current).toBe('2026-10-14')
    setVisibility('visible')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe('2026-10-16')
  })

  it('ignores the page being hidden', () => {
    vi.setSystemTime(new Date(2026, 9, 14, 9))
    const { result } = renderHook(() => useToday())
    vi.setSystemTime(new Date(2026, 9, 15, 9))
    setVisibility('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe('2026-10-14')
  })

  it('shares one date between components and stops its timer when none shows it', () => {
    vi.setSystemTime(new Date(2026, 9, 14, 12))
    const first = renderHook(() => useToday())
    const second = renderHook(() => useToday())
    expect(vi.getTimerCount()).toBe(1)
    first.unmount()
    expect(vi.getTimerCount()).toBe(1)
    second.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reads the clock afresh for a component that mounts later', () => {
    vi.setSystemTime(new Date(2026, 9, 14, 12))
    renderHook(() => useToday()).unmount()
    vi.setSystemTime(new Date(2026, 9, 20, 12))
    expect(renderHook(() => useToday()).result.current).toBe('2026-10-20')
  })
})

describe('getToday', () => {
  it('reads the clock', () => {
    vi.setSystemTime(new Date(2026, 1, 28, 23, 59))
    expect(getToday()).toBe('2026-02-28')
    vi.setSystemTime(new Date(2026, 2, 1, 0, 0))
    expect(getToday()).toBe('2026-03-01')
  })

  it('lets components catch up right after an event handler saw a new day', async () => {
    vi.setSystemTime(new Date(2026, 9, 14, 12))
    const { result } = renderHook(() => useToday())
    vi.setSystemTime(new Date(2026, 9, 15, 7))
    expect(getToday()).toBe('2026-10-15')
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current).toBe('2026-10-15')
  })
})
