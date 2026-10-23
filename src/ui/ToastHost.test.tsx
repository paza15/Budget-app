import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentToast, dismissToast, toast } from '@/ui/toast'
import { ToastHost } from '@/ui/ToastHost'

/** The leave fade (--dur-fade). */
const LEAVE_MS = 200

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function show(...args: Parameters<typeof toast>): ReturnType<typeof toast> {
  let handle: ReturnType<typeof toast> | undefined
  act(() => {
    handle = toast(...args)
  })
  if (handle === undefined) throw new Error('toast() returned nothing')
  return handle
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  // The toast queue lives in the module: clear it so the next test starts empty.
  act(() => {
    const current = currentToast()
    if (current !== null) dismissToast(current.id)
    vi.advanceTimersByTime(LEAVE_MS + 10)
  })
  vi.useRealTimers()
  cleanup()
})

describe('toast', () => {
  it('shows the message in a status region with the toast test id', () => {
    render(<ToastHost />)
    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()

    show({ message: 'Added 3,50 € to Coffee & snacks' })
    expect(screen.getByTestId('toast')).toHaveTextContent('Added 3,50 € to Coffee & snacks')
    expect(region).toContainElement(screen.getByTestId('toast'))
  })

  it('shows one at a time: a new toast replaces the current one', () => {
    render(<ToastHost />)
    const first = show({ message: 'Added 3,50 € to Coffee & snacks' })
    show({ message: 'Saved' })

    expect(screen.getAllByTestId('toast')).toHaveLength(1)
    expect(screen.getByTestId('toast')).toHaveTextContent('Saved')

    // The replaced toast's handle no longer reaches the one on screen.
    act(() => first.dismiss())
    advance(LEAVE_MS + 10)
    expect(screen.getByTestId('toast')).toHaveTextContent('Saved')
  })

  it('fades out on dismiss() and is gone after the fade', () => {
    render(<ToastHost />)
    const handle = show({ message: 'Backup exported', tone: 'success' })

    act(() => handle.dismiss())
    expect(screen.getByTestId('toast')).toHaveAttribute('data-state', 'leaving')
    advance(LEAVE_MS)
    expect(screen.queryByTestId('toast')).toBeNull()

    // A second dismiss is harmless.
    act(() => handle.dismiss())
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('leaves by itself after 4 seconds, or 6 with an action', () => {
    render(<ToastHost />)
    show({ message: 'Saved' })
    advance(3999)
    expect(screen.getByTestId('toast')).toHaveAttribute('data-state', 'shown')
    advance(1)
    expect(screen.getByTestId('toast')).toHaveAttribute('data-state', 'leaving')
    advance(LEAVE_MS)
    expect(screen.queryByTestId('toast')).toBeNull()

    show({ message: 'Deleted Netflix', action: { label: 'Undo', onClick: () => {} } })
    advance(5999)
    expect(screen.getByTestId('toast')).toHaveAttribute('data-state', 'shown')
    advance(1)
    expect(screen.getByTestId('toast')).toHaveAttribute('data-state', 'leaving')
  })

  it('takes its own duration', () => {
    render(<ToastHost />)
    show({ message: 'Saved', durationMs: 1000 })
    advance(1000)
    expect(screen.getByTestId('toast')).toHaveAttribute('data-state', 'leaving')
  })

  it('runs the action once and goes', () => {
    render(<ToastHost />)
    const onUndo = vi.fn<() => void>()
    show({ message: 'Added 3,50 € to Coffee & snacks', action: { label: 'Undo', onClick: onUndo } })

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('toast')).toHaveAttribute('data-state', 'leaving')
    advance(LEAVE_MS)
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('waits while the pointer rests on it, then stays a moment after it leaves', () => {
    render(<ToastHost />)
    show({ message: 'Saved' })
    advance(3000)
    const pill = screen.getByTestId('toast')
    fireEvent.pointerEnter(pill)
    advance(20_000)
    expect(pill).toHaveAttribute('data-state', 'shown')

    fireEvent.pointerLeave(pill)
    advance(1499)
    expect(pill).toHaveAttribute('data-state', 'shown')
    advance(1)
    expect(pill).toHaveAttribute('data-state', 'leaving')
  })

  it('marks success and critical toasts with an icon, not colour alone', () => {
    render(<ToastHost />)
    show({ message: "Couldn't export the backup. Try again.", tone: 'critical' })
    const pill = screen.getByTestId('toast')
    expect(pill).toHaveAttribute('data-tone', 'critical')
    expect(pill.querySelector('svg')).not.toBeNull()
  })
})
