import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ConsequenceLine } from '@/ui/ConsequenceLine'
import styles from '@/ui/ConsequenceLine.module.css'
import { classOf, cssRule, readSibling } from '@/ui/testing/css'

// docs/DESIGN.md §9.16 and §9.26.

afterEach(cleanup)

const css = readSibling(import.meta.url, 'ConsequenceLine.module.css')

describe('ConsequenceLine', () => {
  it('draws the default tone in --ink-2 with its figure in --ink', () => {
    render(
      <ConsequenceLine data-testid="line">
        Leaves <strong>4,84 €</strong> for today
      </ConsequenceLine>,
    )
    const line = screen.getByTestId('line')
    expect(line).toHaveTextContent('Leaves 4,84 € for today')
    expect(line).toHaveClass(classOf(styles, 'default'))
    expect(cssRule(css, '.line').color).toBe('var(--ink-2)')
    expect(cssRule(css, '.default strong')).toEqual({ 'font-weight': 'inherit', color: 'var(--ink)' })
  })

  it('takes the warning and critical inks', () => {
    const { rerender } = render(<ConsequenceLine tone="warning" data-testid="line">2,66 € over today's budget</ConsequenceLine>)
    expect(screen.getByTestId('line')).toHaveClass(classOf(styles, 'warning'))
    expect(cssRule(css, '.warning').color).toBe('var(--warning-ink)')
    rerender(<ConsequenceLine tone="critical" data-testid="line">Wallet after: short by 68,78 €</ConsequenceLine>)
    expect(screen.getByTestId('line')).toHaveClass(classOf(styles, 'critical'))
    expect(cssRule(css, '.critical').color).toBe('var(--critical-ink)')
  })

  it('puts the 16px glyph inline before the words, decorative', () => {
    render(<ConsequenceLine tone="critical" icon="critical" data-testid="line">41,28 € over this month's budget</ConsequenceLine>)
    const glyph = screen.getByTestId('line').querySelector('svg[data-icon="critical"]')
    expect(glyph).toHaveAttribute('width', '16')
    expect(glyph).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('line').firstElementChild).toBe(glyph)
  })

  it('keeps its 20px line when empty', () => {
    render(<ConsequenceLine data-testid="line" />)
    expect(screen.getByTestId('line')).toBeEmptyDOMElement()
    expect(screen.getByTestId('line')).toHaveClass(classOf(styles, 'line'))
    expect(cssRule(css, '.line').height).toBe('20px')
  })

  it('is a polite live region only when asked', () => {
    const { rerender } = render(<ConsequenceLine data-testid="line">Wallet after: 531,22 €</ConsequenceLine>)
    expect(screen.getByTestId('line')).not.toHaveAttribute('aria-live')
    rerender(<ConsequenceLine live data-testid="line">Wallet after: 531,22 €</ConsequenceLine>)
    expect(screen.getByTestId('line')).toHaveAttribute('aria-live', 'polite')
  })
})
