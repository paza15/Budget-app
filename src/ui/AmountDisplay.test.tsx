import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMoneyFormat } from '@/domain/money'
import { AmountDisplay, keypadFigure } from '@/ui/AmountDisplay'
import { MoneyFormatContext } from '@/ui/MoneyFormatContext'

/** Text with its runs of white space (thin and no-break spaces too) as one space. */
function plain(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/gu, ' ').trim()
}

const euro = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: true })
const dollar = createMoneyFormat({ currency: 'USD', locale: 'en-US', showCents: true, masked: false })
const yen = createMoneyFormat({ currency: 'JPY', locale: 'de-DE', showCents: true, masked: false })

afterEach(cleanup)

describe('keypadFigure (DESIGN.md §9.16)', () => {
  it('writes what was typed in the locale, the unit apart', () => {
    expect(keypadFigure('1234.5', euro)).toEqual({ number: '1.234,5', symbol: '€', symbolFirst: false })
    expect(keypadFigure('3.', dollar)).toEqual({ number: '3.', symbol: '$', symbolFirst: true })
    expect(keypadFigure('', euro)).toEqual({ number: '0', symbol: '€', symbolFirst: false })
    expect(keypadFigure('350', yen)).toEqual({ number: '350', symbol: '¥', symbolFirst: false })
  })
})

describe('AmountDisplay', () => {
  it('shows the typed amount even while amounts are hidden, as a polite live region', () => {
    render(
      <MoneyFormatContext value={euro}>
        <AmountDisplay keys="7.8" />
      </MoneyFormatContext>,
    )
    const display = screen.getByTestId('amount-display')
    expect(plain(display.textContent)).toBe('Amount 7,8€')
    expect(display).toHaveAttribute('aria-live', 'polite')
  })

  it('puts a prefix symbol first', () => {
    render(
      <MoneyFormatContext value={dollar}>
        <AmountDisplay keys="12.5" />
      </MoneyFormatContext>,
    )
    expect(plain(screen.getByTestId('amount-display').textContent)).toBe('Amount $12.5')
  })

  it('becomes the button back to the keypad while the split editor is open', async () => {
    const user = userEvent.setup({ delay: null })
    const onEdit = vi.fn<() => void>()
    render(
      <MoneyFormatContext value={euro}>
        <AmountDisplay keys="32" onEdit={onEdit} />
      </MoneyFormatContext>,
    )
    const button = screen.getByRole('button', { name: /^Amount, 32,00\s€, the whole bill\. Edit amount$/u })
    await user.click(button)
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
