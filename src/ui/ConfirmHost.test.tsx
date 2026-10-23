import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfirmHost } from '@/ui/ConfirmHost'
import { chooseDialog, confirmDialog } from '@/ui/dialogs'

/** ConfirmHost beside #app-root, as App renders it, with a button that had focus before. */
function Harness() {
  return (
    <>
      <div id="app-root" data-testid="app-root">
        <button type="button">Remove</button>
      </div>
      <ConfirmHost />
    </>
  )
}

function ask<T>(open: () => Promise<T>): Promise<T> {
  let pending: Promise<T> | undefined
  act(() => {
    pending = open()
  })
  if (pending === undefined) throw new Error('no dialog')
  return pending
}

function removeNetflix(): Promise<'stop' | 'delete' | null> {
  return chooseDialog({
    title: 'Remove Netflix?',
    message: 'Stopping keeps it in past months.',
    options: [
      { value: 'stop', label: 'Stop after October' },
      { value: 'delete', label: 'Delete from all months', destructive: true },
    ],
  })
}

/** Answered dialogs fade out before the next one shows. */
async function gone(): Promise<void> {
  await waitFor(() => expect(document.querySelector('[data-dialog-scrim]')).toBeNull())
}

afterEach(async () => {
  await gone()
  cleanup()
})

describe('chooseDialog', () => {
  it('resolves the chosen option', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const answer = ask(removeNetflix)

    const sheet = await screen.findByRole('dialog', { name: 'Remove Netflix?' })
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(sheet).toHaveAccessibleDescription('Stopping keeps it in past months.')
    await user.click(within(sheet).getByRole('button', { name: 'Delete from all months' }))
    await expect(answer).resolves.toBe('delete')
  })

  it('resolves null on Cancel, Escape and a tap outside', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const viaButton = ask(removeNetflix)
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await expect(viaButton).resolves.toBeNull()
    await gone()

    const viaEscape = ask(removeNetflix)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await expect(viaEscape).resolves.toBeNull()
    await gone()

    const viaScrim = ask(removeNetflix)
    await screen.findByRole('dialog')
    const scrim = document.querySelector<HTMLElement>('[data-dialog-scrim]')
    if (scrim === null) throw new Error('no scrim')
    await user.click(scrim)
    await expect(viaScrim).resolves.toBeNull()
  })

  it('leads an option with its glyph or emoji, which VoiceOver skips', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const answer = ask(() =>
      chooseDialog({
        title: 'Quick add',
        options: [
          { value: 'coffee', label: 'Coffee, 3,50 €', icon: 'coffee' },
          { value: 'tea', label: 'Tea, 2,00 €', icon: '🍵' },
          { value: 'other', label: 'Something else' },
        ],
      }),
    )
    const menu = await screen.findByRole('dialog', { name: 'Quick add' })
    const coffee = within(menu).getByRole('button', { name: 'Coffee, 3,50 €' })
    const glyph = coffee.querySelector('svg')
    expect(glyph).toHaveAttribute('aria-hidden', 'true')
    // The glyph comes first, before the label.
    expect(coffee.firstElementChild).toBe(glyph)

    const tea = within(menu).getByRole('button', { name: 'Tea, 2,00 €' })
    expect(tea.querySelector('[aria-hidden="true"]')).toHaveTextContent('🍵')

    const other = within(menu).getByRole('button', { name: 'Something else' })
    expect(other.querySelector('svg, [aria-hidden="true"]')).toBeNull()

    await user.click(coffee)
    await expect(answer).resolves.toBe('coffee')
  })

  it('starts on Cancel when an option is destructive, else on the first option', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const destructive = ask(removeNetflix)
    const first = await screen.findByRole('dialog')
    expect(within(first).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await destructive
    await gone()

    const plain = ask(() =>
      chooseDialog({
        title: 'Add your income',
        options: [
          { value: 'every', label: 'Every month' },
          { value: 'once', label: 'Just this month' },
        ],
        cancelLabel: 'Not now',
      }),
    )
    const second = await screen.findByRole('dialog', { name: 'Add your income' })
    expect(within(second).getByRole('button', { name: 'Every month' })).toHaveFocus()
    await user.click(within(second).getByRole('button', { name: 'Not now' }))
    await expect(plain).resolves.toBeNull()
  })
})

describe('confirmDialog', () => {
  it('resolves true on confirm and false on cancel', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const yes = ask(() => confirmDialog({ title: 'Replace everything?', confirmLabel: 'Replace' }))
    const alert = await screen.findByRole('alertdialog', { name: 'Replace everything?' })
    // Not destructive: focus starts on the action.
    expect(within(alert).getByRole('button', { name: 'Replace' })).toHaveFocus()
    await user.click(within(alert).getByRole('button', { name: 'Replace' }))
    await expect(yes).resolves.toBe(true)
    await gone()

    const no = ask(() => confirmDialog({ title: 'Replace everything?', confirmLabel: 'Replace' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    await expect(no).resolves.toBe(false)
  })

  it('starts on the way back when destructive, and Escape cancels', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const answer = ask(() =>
      confirmDialog({ title: 'Discard changes?', confirmLabel: 'Discard', cancelLabel: 'Keep editing', destructive: true }),
    )
    const alert = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
    expect(within(alert).getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    expect(within(alert).getByRole('button', { name: 'Discard' })).toHaveAttribute('data-variant', 'destructive')
    await user.keyboard('{Escape}')
    await expect(answer).resolves.toBe(false)
  })

  it('makes the app inert while it waits, keeps Tab inside and gives focus back', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Remove' })
    opener.focus()

    const answer = ask(() => confirmDialog({ title: 'Delete Netflix?', confirmLabel: 'Delete', destructive: true }))
    const alert = await screen.findByRole('alertdialog', { name: 'Delete Netflix?' })
    expect(screen.getByTestId('app-root')).toHaveAttribute('inert')
    const cancel = within(alert).getByRole('button', { name: 'Cancel' })
    const confirm = within(alert).getByRole('button', { name: 'Delete' })
    expect(cancel).toHaveFocus()
    await user.tab()
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()

    await user.click(cancel)
    await expect(answer).resolves.toBe(false)
    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.getByTestId('app-root')).not.toHaveAttribute('inert')
  })

  it('shows dialogs asked together one after the other', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const first = ask(() => confirmDialog({ title: 'First?', confirmLabel: 'OK' }))
    const second = ask(() => confirmDialog({ title: 'Second?', confirmLabel: 'OK' }))

    await user.click(within(await screen.findByRole('alertdialog', { name: 'First?' })).getByRole('button', { name: 'OK' }))
    await expect(first).resolves.toBe(true)
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Second?' })).getByRole('button', { name: 'Cancel' }))
    await expect(second).resolves.toBe(false)
  })
})
