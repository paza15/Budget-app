import { cleanup, render, screen } from '@testing-library/react'
import { createRef, type ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMoneyFormat, type MoneyFormatOptions } from '@/domain/money'
import { LedgerFigure } from '@/ui/LedgerFigure'
import { MASKED_LABEL } from '@/ui/Money'
import { MoneyFormatContext } from '@/ui/MoneyFormatContext'

afterEach(cleanup)

function withMoney(children: ReactNode, options: Partial<MoneyFormatOptions> = {}) {
  const money = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: false, ...options })
  return <MoneyFormatContext value={money}>{children}</MoneyFormatContext>
}

/** The text of the figure's own text nodes, without the hanging unit's span. */
function bareText(element: HTMLElement): string {
  return [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join('')
}

describe('LedgerFigure', () => {
  it('writes an addend as a bare figure, without the currency', () => {
    render(withMoney(<LedgerFigure cents={145000} data-testid="income" />))
    const figure = screen.getByTestId('income')
    expect(figure).toHaveTextContent('1.450,00')
    expect(figure).not.toHaveTextContent('€')
  })

  it('hangs the unit after the result in suffix locales', () => {
    render(withMoney(<LedgerFigure cents={23472} result data-testid="left" />))
    const figure = screen.getByTestId('left')
    expect(bareText(figure)).toBe('234,72')
    const unit = figure.lastElementChild
    expect(unit).toHaveTextContent('€')
    expect(figure.firstChild?.nodeType).toBe(Node.TEXT_NODE)
  })

  it('hangs the unit before the result in prefix locales', () => {
    render(withMoney(<LedgerFigure cents={23472} result data-testid="left" />, { currency: 'USD', locale: 'en-US' }))
    const figure = screen.getByTestId('left')
    expect(bareText(figure)).toBe('234.72')
    expect(figure.firstElementChild).toHaveTextContent('$')
    expect(figure.firstChild).toBe(figure.firstElementChild)
  })

  it('keeps a multi-letter unit whole', () => {
    render(withMoney(<LedgerFigure cents={23472} result data-testid="left" />, { currency: 'CHF', locale: 'de-CH' }))
    const figure = screen.getByTestId('left')
    expect(figure).toHaveTextContent('CHF')
    expect(bareText(figure)).toMatch(/^234[.,]72$/)
  })

  it('writes an over-budget result with a true minus', () => {
    render(withMoney(<LedgerFigure cents={-4128} result tone="critical" data-testid="left" />))
    const figure = screen.getByTestId('left')
    expect(bareText(figure)).toBe('−41,28')
    expect(figure.textContent).not.toContain('-')
  })

  it('always shows cents, whatever the big-number setting says', () => {
    render(withMoney(<LedgerFigure cents={33640} data-testid="daily" />, { showCents: false }))
    expect(screen.getByTestId('daily')).toHaveTextContent('336,40')
  })

  it('shows whole units for currencies without a minor unit', () => {
    render(withMoney(<LedgerFigure cents={139900} result data-testid="left" />, { currency: 'JPY', locale: 'de-DE' }))
    const figure = screen.getByTestId('left')
    expect(bareText(figure)).toBe('1.399')
    expect(figure).toHaveTextContent('¥')
  })

  it('masks figures and results without a unit', () => {
    render(
      withMoney(
        <>
          <LedgerFigure cents={145000} data-testid="income" />
          <LedgerFigure cents={23472} result data-testid="left" />
        </>,
        { masked: true },
      ),
    )
    expect(screen.getAllByRole('img', { name: MASKED_LABEL })).toHaveLength(2)
    expect(screen.getByTestId('left')).toHaveTextContent('•••')
    expect(screen.getByTestId('left')).not.toHaveTextContent('€')
  })

  it('hands its box to a ref, so the rules can be measured from it', () => {
    const ref = createRef<HTMLSpanElement>()
    render(withMoney(<LedgerFigure cents={23472} result ref={ref} data-testid="left" />))
    expect(ref.current).toBe(screen.getByTestId('left'))
  })
})
