import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import buttonStyles from '@/ui/Button.module.css'
import { Sheet } from '@/ui/Sheet'
import { SheetHeader } from '@/ui/SheetHeader'
import { classOf, cssRule, readSibling } from '@/ui/testing/css'

function noop(): void {}

/** The month-end review as MonthReviewSheet builds it: statement paper, a two-line header, "Close". */
function Review({ open = true, range, focusClose = false }: { open?: boolean; range?: string; focusClose?: boolean }) {
  return (
    <>
      <div id="app-root">
        <button type="button">See the review</button>
      </div>
      <Sheet open={open} onClose={noop} label="October statement" size="large" material="paper">
        <SheetHeader title="October statement" subtitle={range} cancelLabel="Close" onCancel={noop} focusCancel={focusClose} />
        <p>Moved to your wallet</p>
      </Sheet>
    </>
  )
}

afterEach(cleanup)

describe('SheetHeader', () => {
  it('has Cancel at the start, the title, and the action at the end', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn<() => void>()
    const onSave = vi.fn<() => void>()
    render(
      <SheetHeader
        title="Netflix"
        onCancel={onCancel}
        action={{ label: 'Save', onClick: onSave, 'data-testid': 'sheet-save' }}
        data-testid="header"
      />,
    )
    const header = screen.getByTestId('header')
    expect(within(header).getByRole('heading', { level: 2 })).toHaveTextContent('Netflix')
    const [cancel, save] = within(header).getAllByRole('button')
    expect(cancel).toHaveAccessibleName('Cancel')
    expect(save).toHaveAccessibleName('Save')
    expect(save).toHaveAttribute('data-testid', 'sheet-save')

    await user.click(within(header).getByRole('button', { name: 'Cancel' }))
    await user.click(within(header).getByRole('button', { name: 'Save' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('leaves out the buttons it has no handler for, and turns the action off', () => {
    const { rerender } = render(<SheetHeader title="How often" />)
    expect(screen.queryByRole('button')).toBeNull()

    rerender(<SheetHeader title="Netflix" action={{ label: 'Save', onClick: noop, disabled: true }} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('puts the range under the title and describes the sheet by it while it shows', () => {
    const { rerender } = render(<Review range="1 Oct – 31 Oct 2026" />)
    const dialog = screen.getByRole('dialog', { name: 'October statement' })
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('October statement')
    expect(within(dialog).getByText('1 Oct – 31 Oct 2026')).toBeInTheDocument()
    expect(dialog).toHaveAccessibleDescription('1 Oct – 31 Oct 2026')

    rerender(<Review />)
    expect(dialog).not.toHaveAttribute('aria-describedby')
    expect(dialog).toHaveAccessibleDescription('')
  })

  it('starts focus on Close when asked, else on the dialog', async () => {
    const { rerender } = render(<Review open={false} />)
    const opener = screen.getByRole('button', { name: 'See the review' })
    opener.focus()

    rerender(<Review open />)
    expect(screen.getByRole('dialog', { name: 'October statement' })).toHaveFocus()
    // The sheet gives focus back once the closing commit is over (a microtask).
    await act(async () => {
      rerender(<Review open={false} />)
    })
    expect(opener).toHaveFocus()
    cleanup()

    const second = render(<Review open={false} focusClose />)
    const seeReview = screen.getByRole('button', { name: 'See the review' })
    seeReview.focus()
    second.rerender(<Review open focusClose />)
    const dialog = screen.getByRole('dialog', { name: 'October statement' })
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()

    // Focus still goes back to where it came from when the sheet closes.
    await act(async () => {
      second.rerender(<Review open={false} focusClose />)
    })
    expect(seeReview).toHaveFocus()
  })

  describe('action tones and disclosure (DESIGN.md §9.26, EXTRAS.md §2.1)', () => {
    const buttonCss = readSibling(import.meta.url, 'Button.module.css')

    it('keeps the action tinted by default, as "Save"', () => {
      render(<SheetHeader title="Netflix" action={{ label: 'Save', onClick: noop }} />)
      const save = screen.getByRole('button', { name: 'Save' })
      expect(save).toHaveClass(classOf(buttonStyles, 'tinted'))
      expect(save).not.toHaveClass(classOf(buttonStyles, 'critical'))
      expect(save).not.toHaveAttribute('aria-expanded')
      expect(save).not.toHaveAttribute('aria-controls')
    })

    it('draws a destructive action in the critical ink, and a neutral one in --ink', () => {
      const { rerender } = render(<SheetHeader title="Deposit" action={{ label: 'Delete', onClick: noop, tone: 'destructive' }} />)
      const destructive = screen.getByRole('button', { name: 'Delete' })
      expect(destructive).toHaveClass(classOf(buttonStyles, 'critical'))
      expect(destructive).not.toHaveClass(classOf(buttonStyles, 'tinted'))
      expect(cssRule(buttonCss, '.glass.critical').color).toBe('var(--critical-ink)')

      rerender(<SheetHeader title="New expense" action={{ label: 'Split', onClick: noop, tone: 'neutral' }} />)
      const neutral = screen.getByRole('button', { name: 'Split' })
      expect(neutral).not.toHaveClass(classOf(buttonStyles, 'tinted'))
      expect(neutral).not.toHaveClass(classOf(buttonStyles, 'critical'))
    })

    it('makes the action a disclosure with expanded and controls', async () => {
      const user = userEvent.setup()
      const onSplit = vi.fn<() => void>()
      const split = { label: 'Split', onClick: onSplit, tone: 'neutral', controls: 'split-panel' } as const
      const { rerender } = render(<SheetHeader title="New expense" action={{ ...split, expanded: false }} />)
      const button = screen.getByRole('button', { name: 'Split' })
      expect(button).toHaveAttribute('aria-expanded', 'false')
      expect(button).toHaveAttribute('aria-controls', 'split-panel')
      expect(button).not.toHaveClass(classOf(buttonStyles, 'selected'))
      await user.click(button)
      expect(onSplit).toHaveBeenCalledTimes(1)

      rerender(<SheetHeader title="New expense" action={{ ...split, expanded: true }} />)
      expect(button).toHaveAttribute('aria-expanded', 'true')
      expect(button).toHaveClass(classOf(buttonStyles, 'selected'))
      expect(cssRule(buttonCss, '.glass.selected')).toMatchObject({
        background: 'var(--accent)',
        color: 'var(--on-accent)',
        'font-weight': '600',
        'box-shadow': 'none',
      })
    })

    it('greys a disabled capsule label at full opacity instead of fading it', () => {
      render(<SheetHeader title="New expense" action={{ label: 'Split', onClick: noop, tone: 'neutral', disabled: true }} />)
      expect(screen.getByRole('button', { name: 'Split' })).toBeDisabled()
      expect(cssRule(buttonCss, '.glass:disabled, .glass.tinted:disabled, .glass.critical:disabled')).toEqual({
        color: 'var(--ink-disabled)',
      })
      expect(cssRule(buttonCss, '.secondary:disabled, .plain:disabled, .destructive:disabled')).toEqual({ opacity: '0.4' })
    })
  })
})
