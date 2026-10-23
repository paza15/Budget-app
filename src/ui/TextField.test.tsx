import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cssRule, mountCssModule, px, readSibling } from '@/ui/testing/css'
import { TextField, type TextFieldProps } from '@/ui/TextField'
import styles from '@/ui/TextField.module.css'

// docs/DESIGN.md §9.14.

const css = readSibling(import.meta.url, 'TextField.module.css')
let unmountCss: () => void = () => {}

// The module's rules in the document, so display: none hides the clear button from the queries.
beforeAll(() => {
  unmountCss = mountCssModule(css, styles)
})
afterAll(() => unmountCss())
afterEach(cleanup)

/**
 * jsdom keeps computed styles until the DOM changes, and a focus change is not a DOM change: touch
 * the document so the next query sees the :focus-within rules apply.
 */
function restyle(): void {
  document.body.toggleAttribute('data-restyle')
}

function Field({ initial = 'Netflix', ...props }: Partial<TextFieldProps> & { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <TextField label="Name" value={value} onChange={setValue} {...props} />
}

describe('TextField', () => {
  describe('clear button', () => {
    for (const variant of ['row', 'form'] as const) {
      it(`shows in a ${variant} field only while it is edited and holds text`, async () => {
        const user = userEvent.setup()
        render(
          <>
            <Field variant={variant} />
            <button type="button">Elsewhere</button>
          </>,
        )
        expect(screen.queryByRole('button', { name: 'Clear name' })).toBeNull()

        await user.click(screen.getByLabelText('Name'))
        restyle()
        const clear = screen.getByRole('button', { name: 'Clear name' })
        await user.click(clear)
        expect(screen.getByLabelText('Name')).toHaveValue('')
        expect(screen.getByLabelText('Name')).toHaveFocus()
        restyle()
        expect(screen.queryByRole('button', { name: 'Clear name' })).toBeNull()

        await user.type(screen.getByLabelText('Name'), 'Rent')
        restyle()
        expect(screen.getByRole('button', { name: 'Clear name' })).toBeInTheDocument()
        await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
        restyle()
        expect(screen.queryByRole('button', { name: 'Clear name' })).toBeNull()
      })
    }

    it('shows in a search field whenever it holds text', async () => {
      const user = userEvent.setup()
      render(<Field type="search" label="Search" initial="Rewe" />)
      expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Clear search' }))
      expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    })
  })

  it('passes autoCapitalize and autoCorrect to the input, and leaves them out by default', () => {
    const { unmount } = render(<Field label="Type erase to confirm" autoCapitalize="none" autoCorrect="off" />)
    const input = screen.getByLabelText('Type erase to confirm')
    expect(input).toHaveAttribute('autocapitalize', 'none')
    expect(input).toHaveAttribute('autocorrect', 'off')
    unmount()
    render(<Field />)
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('autocapitalize')
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('autocorrect')
  })

  it('pads the label, not the row, so a wrapped label keeps 11 from the group edges', () => {
    const label = cssRule(css, '.label')
    expect(px(label['padding-top'] ?? '')).toBe(11)
    expect(px(label['padding-bottom'] ?? '')).toBe(11)
    // A single line (22) with its padding still fits the 44px input row.
    expect(22 + 2 * 11).toBeLessThanOrEqual(44)
    expect(cssRule(css, '.line').padding).toBe('0 var(--group-padding)')
  })
})
