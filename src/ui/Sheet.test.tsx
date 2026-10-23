import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmHost } from '@/ui/ConfirmHost'
import { Sheet } from '@/ui/Sheet'

function noop(): void {}

interface HarnessProps {
  open: boolean
  onClose?(): void
  onExited?(): void
  dirty?: boolean
  discardTitle?: string
}

/** A sheet as SheetHost renders it, beside #app-root as App renders it (the sheet portals out). */
function Harness({ open, onClose = noop, onExited, dirty, discardTitle }: HarnessProps) {
  return (
    <>
      <div id="app-root" data-testid="app-root">
        <button type="button">Open</button>
      </div>
      <Sheet
        open={open}
        onClose={onClose}
        onExited={onExited}
        label="New expense"
        dirty={dirty}
        discardTitle={discardTitle}
        data-sheet="transaction"
      >
        <button type="button">Cancel</button>
        <button type="button">Save</button>
      </Sheet>
      <ConfirmHost />
    </>
  )
}

/** Two sheets that open one over the other. */
function Two({ first, second }: { first: boolean; second: boolean }) {
  return (
    <>
      <div id="app-root" data-testid="app-root" />
      <Sheet open={first} onClose={noop} label="First">
        <button type="button">One</button>
      </Sheet>
      <Sheet open={second} onClose={noop} label="Second">
        <button type="button">Two</button>
      </Sheet>
    </>
  )
}

/** App with the lock screen up: React made #app-root inert itself. */
function Locked({ open }: { open: boolean }) {
  return (
    <>
      <div id="app-root" data-testid="app-root" inert />
      <Sheet open={open} onClose={noop} label="First" />
    </>
  )
}

/** App as it renders around the lock screen: React sets inert and aria-hidden on #app-root. */
function LockableApp({ locked, open }: { locked: boolean; open: boolean }) {
  return (
    <>
      <div id="app-root" data-testid="app-root" inert={locked} aria-hidden={locked || undefined}>
        <button type="button">Open</button>
      </div>
      <Sheet open={open} onClose={noop} label="New expense">
        <button type="button">Save</button>
      </Sheet>
    </>
  )
}

function layerOf(name: string): HTMLElement {
  const layer = screen.getByRole('dialog', { name }).parentElement
  if (layer === null) throw new Error(`no layer for ${name}`)
  return layer
}

function scrimOf(name: string): HTMLElement {
  const scrim = layerOf(name).querySelector<HTMLElement>('[data-sheet-scrim]')
  if (scrim === null) throw new Error(`no scrim for ${name}`)
  return scrim
}

/** A mouse event at `y` px and `t` ms (the sheet reads the release speed from timeStamp). */
function pointer(type: string, target: EventTarget, y: number, t: number): void {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerType: 'mouse',
    pointerId: 1,
    button: 0,
    clientX: 100,
    clientY: y,
  })
  Object.defineProperty(event, 'timeStamp', { value: t })
  act(() => {
    target.dispatchEvent(event)
  })
}

/** Drags `from` y 100 to y `to` in `ms`, moving in 10 steps. */
function drag(from: EventTarget, to: number, ms: number, start: number): void {
  pointer('pointerdown', from, 100, start)
  for (let i = 1; i <= 10; i++) pointer('pointermove', window, 100 + ((to - 100) * i) / 10, start + (ms * i) / 10)
  pointer('pointerup', window, to, start + ms)
}

/** jsdom has no layout: give the sheet a height for the 30% rule. */
function panelOf(name: string, height = 600): HTMLElement {
  const panel = screen.getByRole('dialog', { name })
  Object.defineProperty(panel, 'offsetHeight', { configurable: true, value: height })
  return panel
}

/** Answered dialogs leave after their exit. */
async function dialogsGone(): Promise<void> {
  await waitFor(() => {
    if (document.querySelector('[data-dialog-scrim]') !== null) throw new Error('a dialog is still on screen')
  })
}

afterEach(async () => {
  // Wait so the next test starts with an empty dialog queue.
  await dialogsGone()
  cleanup()
})

describe('Sheet', () => {
  it('is a modal dialog with its label, test id and sheet name', () => {
    render(<Harness open />)
    const dialog = screen.getByRole('dialog', { name: 'New expense' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('data-testid', 'sheet')
    expect(dialog).toHaveAttribute('data-sheet', 'transaction')
    // It renders outside #app-root, which turns inert under it.
    expect(screen.getByTestId('app-root')).not.toContainElement(dialog)
    expect(screen.getByTestId('app-root')).toHaveAttribute('inert')
  })

  it('takes focus, keeps Tab inside and gives focus back when it closes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness open={false} />)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()

    rerender(<Harness open />)
    const dialog = screen.getByRole('dialog', { name: 'New expense' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(dialog).toHaveFocus()

    await user.tab()
    expect(cancel).toHaveFocus()
    await user.tab()
    expect(save).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.tab({ shift: true })
    expect(save).toHaveFocus()

    // The sheet stays mounted for its exit, but focus goes back to where it came from.
    await act(async () => {
      rerender(<Harness open={false} />)
    })
    expect(opener).toHaveFocus()
  })

  it('closes on Escape and on a tap on the scrim', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn<() => void>()
    render(<Harness open onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(scrimOf('New expense'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('asks before Escape closes it with unsaved changes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn<() => void>()
    render(<Harness open dirty onClose={onClose} />)

    await user.keyboard('{Escape}')
    const ask = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
    const keep = within(ask).getByRole('button', { name: 'Keep editing' })
    // Destructive: focus starts on the way back.
    expect(keep).toHaveFocus()
    expect(layerOf('New expense')).toHaveAttribute('inert')
    await user.click(keep)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
    expect(layerOf('New expense')).not.toHaveAttribute('inert')

    await user.keyboard('{Escape}')
    const again = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
    await user.click(within(again).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('asks with the title the sheet gives, also before the scrim closes it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn<() => void>()
    render(<Harness open dirty discardTitle="Discard this expense?" onClose={onClose} />)

    await user.click(scrimOf('New expense'))
    const ask = await screen.findByRole('alertdialog', { name: 'Discard this expense?' })
    await user.click(within(ask).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('plays its exit after open turns false, then calls onExited and goes', async () => {
    const onExited = vi.fn<() => void>()
    const { rerender } = render(<Harness open onExited={onExited} />)
    rerender(<Harness open={false} onExited={onExited} />)

    // Still there, leaving and taking no input.
    const sheet = screen.getByTestId('sheet')
    expect(sheet.parentElement).toHaveAttribute('data-state', 'closing')
    expect(sheet.parentElement).toHaveAttribute('inert')
    expect(onExited).not.toHaveBeenCalled()

    await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('sheet')).toBeNull()
  })

  it('is printed on --surface-sheet, or on statement paper when asked', () => {
    const { rerender } = render(<Sheet open onClose={noop} label="New expense" />)
    expect(screen.getByRole('dialog', { name: 'New expense' })).toHaveAttribute('data-material', 'sheet')

    rerender(<Sheet open onClose={noop} label="October statement" size="large" material="paper" />)
    const review = screen.getByRole('dialog', { name: 'October statement' })
    expect(review).toHaveAttribute('data-material', 'paper')
    expect(review).toHaveAttribute('data-size', 'large')
  })

  it('marks its content as scrolled for the scroll-edge fade under the header', () => {
    render(<Harness open />)
    const content = within(screen.getByRole('dialog', { name: 'New expense' })).getByRole('button', { name: 'Save' }).parentElement
    if (content === null) throw new Error('no content')
    expect(content).not.toHaveAttribute('data-sheet-scrolled')

    // jsdom does not scroll: stand in for the content's scroll position.
    let scrollTop = 40
    Object.defineProperty(content, 'scrollTop', { configurable: true, get: () => scrollTop })
    fireEvent.scroll(content)
    expect(content).toHaveAttribute('data-sheet-scrolled')

    scrollTop = 0
    fireEvent.scroll(content)
    expect(content).not.toHaveAttribute('data-sheet-scrolled')
  })

  it('calls onExited at once when it mounts closed', async () => {
    const onExited = vi.fn<() => void>()
    render(<Harness open={false} onExited={onExited} />)
    await act(async () => {})
    expect(onExited).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('makes #app-root and the sheets below the top one inert, and restores them', () => {
    const { rerender } = render(<Two first={false} second={false} />)
    const root = screen.getByTestId('app-root')
    expect(root).not.toHaveAttribute('inert')

    rerender(<Two first second={false} />)
    expect(root).toHaveAttribute('inert')
    expect(layerOf('First')).not.toHaveAttribute('inert')

    rerender(<Two first second />)
    expect(root).toHaveAttribute('inert')
    expect(layerOf('First')).toHaveAttribute('inert')
    expect(layerOf('Second')).not.toHaveAttribute('inert')
    expect(screen.getByRole('dialog', { name: 'Second' })).toHaveFocus()

    // The top one closes: the first is live again, the app stays inert under it.
    rerender(<Two first second={false} />)
    expect(layerOf('First')).not.toHaveAttribute('inert')
    expect(layerOf('Second')).toHaveAttribute('inert')
    expect(root).toHaveAttribute('inert')

    rerender(<Two first={false} second={false} />)
    expect(root).not.toHaveAttribute('inert')
  })

  it('keeps #app-root inert when App had made it inert (the lock screen)', () => {
    const { rerender } = render(<Locked open={false} />)
    rerender(<Locked open />)
    rerender(<Locked open={false} />)
    expect(screen.getByTestId('app-root')).toHaveAttribute('inert')
  })

  it('hides under the lock screen with the app and is back after unlock', async () => {
    const onClose = vi.fn<() => void>()
    const { rerender } = render(<LockableApp locked={false} open />)
    const root = screen.getByTestId('app-root')
    const layer = layerOf('New expense')
    const dialog = screen.getByRole('dialog', { name: 'New expense' })
    expect(dialog).toHaveFocus()

    // The app locks while the sheet is open (§3.8): the sheet keeps its input but takes none.
    rerender(<LockableApp locked open />)
    await waitFor(() => expect(layer).toHaveAttribute('inert'))
    expect(root).toHaveAttribute('inert')
    act(() => dialog.blur())

    rerender(<LockableApp locked={false} open />)
    await waitFor(() => expect(layer).not.toHaveAttribute('inert'))
    // Still under the open sheet, and focus is back in it.
    expect(root).toHaveAttribute('inert')
    expect(dialog).toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()

    rerender(<LockableApp locked={false} open={false} />)
    expect(root).not.toHaveAttribute('inert')
  })

  it('answers Escape and the scrim only in the top sheet', async () => {
    const user = userEvent.setup()
    const closeFirst = vi.fn<() => void>()
    const closeSecond = vi.fn<() => void>()
    render(
      <>
        <Sheet open onClose={closeFirst} label="First" />
        <Sheet open onClose={closeSecond} label="Second" />
      </>,
    )
    await user.keyboard('{Escape}')
    expect(closeSecond).toHaveBeenCalledTimes(1)
    expect(closeFirst).not.toHaveBeenCalled()

    // The first sheet's scrim is under the second one and inert: a click there does nothing.
    scrimOf('First').click()
    expect(closeFirst).not.toHaveBeenCalled()
  })

  it('follows a drag on its handle: back up after a short slow one, closed after a long or fast one', () => {
    const onClose = vi.fn<() => void>()
    render(<Harness open onClose={onClose} />)
    const panel = panelOf('New expense')
    const grab = panel.querySelector<HTMLElement>('[data-sheet-grab]')
    if (grab === null) throw new Error('no grab handle')

    // 80px of 600 over a second: neither far enough nor a flick.
    drag(grab, 180, 1000, 0)
    expect(onClose).not.toHaveBeenCalled()
    expect(panel.style.getPropertyValue('--drag')).toBe('0px')

    // Past 30% of the height, slowly.
    drag(grab, 400, 2000, 5000)
    expect(onClose).toHaveBeenCalledTimes(1)

    // A short flick: 60px in 60ms is 1px/ms, over the 0.5px/ms that closes.
    drag(grab, 160, 60, 10_000)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('drags by its content only when the content is scrolled to the top', () => {
    const onClose = vi.fn<() => void>()
    render(<Harness open onClose={onClose} />)
    const panel = panelOf('New expense')
    const save = within(panel).getByRole('button', { name: 'Save' })
    const content = save.parentElement
    if (content === null) throw new Error('no content')

    Object.defineProperty(content, 'scrollTop', { configurable: true, value: 120 })
    drag(save, 400, 300, 0)
    expect(onClose).not.toHaveBeenCalled()
    expect(panel.style.getPropertyValue('--drag')).toBe('')

    Object.defineProperty(content, 'scrollTop', { configurable: true, value: 0 })
    drag(save, 400, 300, 5000)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('springs back and asks when a dirty sheet is dragged away', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn<() => void>()
    render(<Harness open dirty onClose={onClose} />)
    const panel = panelOf('New expense')
    const grab = panel.querySelector<HTMLElement>('[data-sheet-grab]')
    if (grab === null) throw new Error('no grab handle')

    drag(grab, 400, 2000, 0)
    expect(panel.style.getPropertyValue('--drag')).toBe('0px')
    const ask = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
    expect(onClose).not.toHaveBeenCalled()
    await user.click(within(ask).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('follows the visual viewport while the keyboard is up, then puts the page back', async () => {
    // A visual viewport the test can move: jsdom's layout viewport is 768px tall.
    const viewport = Object.assign(new EventTarget(), { height: 768, width: 1024, offsetTop: 0, offsetLeft: 0, scale: 1 })
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    const scrollTo = vi.spyOn(window, 'scrollTo')
    try {
      render(<Harness open />)
      const layer = layerOf('New expense')
      expect(layer).not.toHaveAttribute('data-keyboard')

      // The keyboard slides up and covers 336px.
      viewport.height = 432
      act(() => {
        viewport.dispatchEvent(new Event('resize'))
      })
      await waitFor(() => expect(layer).toHaveAttribute('data-keyboard'))
      expect(layer.style.getPropertyValue('--vv-top')).toBe('0px')
      expect(layer.style.getPropertyValue('--vv-height')).toBe('432px')

      // It goes, and iOS leaves the visual viewport panned: the frame returns to the layout
      // viewport and the page goes back to the top.
      viewport.height = 768
      viewport.offsetTop = 40
      act(() => {
        viewport.dispatchEvent(new Event('resize'))
      })
      await waitFor(() => expect(layer).not.toHaveAttribute('data-keyboard'))
      expect(layer.style.getPropertyValue('--vv-height')).toBe('')
      expect(scrollTo).toHaveBeenCalledWith(0, 0)
    } finally {
      cleanup()
      if (original) Object.defineProperty(window, 'visualViewport', original)
    }
  })
})
