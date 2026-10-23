import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cssRule, px, readSibling } from '@/ui/testing/css'
import { Toggle } from '@/ui/Toggle'

// docs/DESIGN.md §9.13.

afterEach(cleanup)

const css = readSibling(import.meta.url, 'Toggle.module.css')

describe('Toggle', () => {
  it('is a switch named by its label and described by its description', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(checked: boolean) => void>()
    render(<Toggle label="Spread over 12 months" description="12,50 € a month" checked={false} onChange={onChange} />)
    const toggle = screen.getByRole('switch', { name: 'Spread over 12 months' })
    expect(toggle).toHaveAccessibleDescription('12,50 € a month')
    await user.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('is exactly the form row height: the 10 above and below sit on its text, not the row', () => {
    const row = cssRule(css, '.row')
    expect(row['min-height']).toBe('var(--form-row-min, 50px)')
    expect(row.padding).toBe('0 var(--group-padding)')
    expect(px(cssRule(css, '.text')['padding-block'] ?? '')).toBe(10)
    // A one-line label (22) with its padding stays under the shortest row (44), so the row is
    // exactly --form-row-min, while the 31pt switch keeps clear of it.
    expect(22 + 2 * 10).toBeLessThanOrEqual(44)
  })
})
