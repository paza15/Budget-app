import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMoneyFormat, type MoneyFormatOptions } from '@/domain/money'
import { MoneyFormatContext } from '@/ui/MoneyFormatContext'
import { TotalFigure } from '@/ui/TotalFigure'
import styles from '@/ui/TotalFigure.module.css'
import { classOf } from '@/ui/testing/css'

// docs/DESIGN.md §5.3 (--text-figure-lg) and §5.4 (hidden amounts).

afterEach(cleanup)

function withMoney(children: ReactNode, options: Partial<MoneyFormatOptions> = {}) {
  const money = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: false, ...options })
  return <MoneyFormatContext value={money}>{children}</MoneyFormatContext>
}

/** The figure as drawn: the aria-hidden copy's text, unit spans marked. */
function drawn(root: HTMLElement): { number: string; before: string | null; after: string | null } {
  const shown = root.querySelector('[aria-hidden="true"]')
  return {
    number: shown?.querySelector(`.${classOf(styles, 'number')}`)?.textContent ?? '',
    before: shown?.querySelector(`.${classOf(styles, 'before')}`)?.textContent ?? null,
    after: shown?.querySelector(`.${classOf(styles, 'after')}`)?.textContent ?? null,
  }
}

describe('TotalFigure', () => {
  it('draws 38,50 with the euro sign after it in de-DE, and reads the full amount', () => {
    render(withMoney(<TotalFigure cents={3850} data-testid="total" />))
    const total = screen.getByTestId('total')
    expect(drawn(total)).toEqual({ number: '38,50', before: null, after: '€' })
    expect(total.querySelector('.visually-hidden')?.textContent).toMatch(/^38,50\s€$/)
  })

  it('puts the dollar sign before the figure in en-US', () => {
    render(withMoney(<TotalFigure cents={3850} data-testid="total" />, { currency: 'USD', locale: 'en-US' }))
    expect(drawn(screen.getByTestId('total'))).toEqual({ number: '38.50', before: '$', after: null })
  })

  it('shows "•••" without a unit, named Amount hidden, while amounts are hidden', () => {
    render(withMoney(<TotalFigure cents={3850} data-testid="total" />, { masked: true }))
    const total = screen.getByRole('img', { name: 'Amount hidden' })
    expect(total).toHaveTextContent('•••')
    expect(total).toHaveClass(classOf(styles, 'masked'))
    expect(total).toHaveAttribute('data-testid', 'total')
    expect(total).not.toHaveTextContent('€')
  })

  it('applies the critical tone', () => {
    const { rerender } = render(withMoney(<TotalFigure cents={-1200} data-testid="total" />))
    expect(screen.getByTestId('total')).not.toHaveClass(classOf(styles, 'critical'))
    rerender(withMoney(<TotalFigure cents={-1200} tone="critical" data-testid="total" />))
    expect(screen.getByTestId('total')).toHaveClass(classOf(styles, 'critical'))
    expect(drawn(screen.getByTestId('total')).number).toBe('−12,00')
  })

  it('leaves out the hidden copy with labelled={false}, so its text is just the drawn figure', () => {
    render(withMoney(<TotalFigure cents={24602} labelled={false} data-testid="total" />))
    const total = screen.getByTestId('total')
    expect(total.querySelector('.visually-hidden')).toBeNull()
    expect(total).toHaveTextContent(/^246,02\s?€$/)
    expect(drawn(total)).toEqual({ number: '246,02', before: null, after: '€' })
  })

  it('draws "•••" without naming it as an image with labelled={false} while amounts are hidden', () => {
    render(withMoney(<TotalFigure cents={24602} labelled={false} data-testid="total" />, { masked: true }))
    const total = screen.getByTestId('total')
    expect(total).toHaveTextContent('•••')
    expect(total).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('marks the number and the unit with data-part for parents to restyle', () => {
    render(withMoney(<TotalFigure cents={3850} data-testid="total" />))
    const total = screen.getByTestId('total')
    expect(total.querySelector('[data-part="number"]')?.textContent).toBe('38,50')
    expect(total.querySelector('[data-part="unit"]')?.textContent).toBe('€')
  })
})
