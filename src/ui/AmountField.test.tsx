import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMoneyFormat, parseAmountInput, type MoneyFormat, type MoneyFormatOptions } from '@/domain/money'
import type { Cents } from '@/domain/types'
import { AmountField, amountWidthCh, plainAmount } from '@/ui/AmountField'
import { MoneyFormatContext } from '@/ui/MoneyFormatContext'
import { cssRule, px, readSibling } from '@/ui/testing/css'

afterEach(cleanup)

function money(options: Partial<MoneyFormatOptions> = {}): MoneyFormat {
  return createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: false, ...options })
}

function withMoney(children: ReactNode, format: MoneyFormat = money()) {
  return <MoneyFormatContext value={format}>{children}</MoneyFormatContext>
}

/** The field with its value in state, as a form holds it. */
function Harness({ initial, onChange }: { initial: Cents | null; onChange?(value: Cents | null): void }) {
  const [value, setValue] = useState<Cents | null>(initial)
  return (
    <>
      <AmountField
        label="Amount"
        value={value}
        onChange={(next) => {
          onChange?.(next)
          setValue(next)
        }}
        data-testid="amount"
      />
      <button type="button">Elsewhere</button>
    </>
  )
}

const FORMATS: [string, MoneyFormat][] = [
  ['de-DE euros', money()],
  ['en-US dollars', money({ currency: 'USD', locale: 'en-US' })],
  ['de-CH francs', money({ currency: 'CHF', locale: 'de-CH' })],
  ['fr-FR euros', money({ locale: 'fr-FR' })],
  ['ja-JP yen', money({ currency: 'JPY', locale: 'ja-JP' })],
  ['sq-AL lek', money({ currency: 'ALL', locale: 'sq-AL' })],
]

const AMOUNTS: Cents[] = [1, 5, 99, 100, 350, 1399, 100000, 123456, 1234567, 9_999_999_999]

describe('AmountField parse and format round trip', () => {
  for (const [name, format] of FORMATS) {
    it(`reads back what it shows, in ${name}`, () => {
      for (const cents of AMOUNTS) {
        // Currencies without a minor unit only hold whole units.
        const amount = format.digits === 0 ? Math.floor(cents / 100) * 100 : cents
        if (amount === 0) continue
        const plain = plainAmount(amount, format)
        expect(parseAmountInput(plain, format.digits, format.decimalSeparator)).toBe(amount)
        const shown = format.format(amount)
        expect(parseAmountInput(shown, format.digits, format.decimalSeparator)).toBe(amount)
      }
    })
  }

  it('edits with the locale separator, without grouping or symbol', () => {
    expect(plainAmount(123456, money())).toBe('1234,56')
    expect(plainAmount(123456, money({ currency: 'USD', locale: 'en-US' }))).toBe('1234.56')
    expect(plainAmount(350, money())).toBe('3,50')
    expect(plainAmount(139900, money({ currency: 'JPY', locale: 'ja-JP' }))).toBe('1399')
  })
})

describe('AmountField', () => {
  it('shows the formatted amount until it is focused, then the plain number', async () => {
    const user = userEvent.setup()
    render(withMoney(<Harness initial={1399} />))
    const field = screen.getByRole('textbox', { name: 'Amount' })
    expect(field).toHaveValue('13,99 €')
    expect(field).toHaveAttribute('inputmode', 'decimal')
    await user.click(field)
    expect(field).toHaveValue('13,99')
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(field).toHaveValue('13,99 €')
  })

  it('parses as you type and formats the result on blur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: Cents | null) => void>()
    render(withMoney(<Harness initial={1399} onChange={onChange} />))
    const field = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(field)
    expect(onChange).toHaveBeenLastCalledWith(null)
    await user.type(field, '1.234,5')
    expect(onChange).toHaveBeenLastCalledWith(123450)
    expect(field).toHaveValue('1.234,5')
    await user.tab()
    expect(field).toHaveValue('1.234,50 €')
  })

  it('keeps text that is not an amount and says how to type one', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: Cents | null) => void>()
    render(withMoney(<Harness initial={null} onChange={onChange} />))
    const field = screen.getByRole('textbox', { name: 'Amount' })
    await user.type(field, '12-')
    expect(onChange).toHaveBeenLastCalledWith(1200)
    await user.tab()
    expect(field).toHaveValue('12-')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription("That isn't an amount. Type it like 13,99.")

    await user.clear(field)
    await user.type(field, '7')
    await user.tab()
    expect(field).not.toHaveAttribute('aria-invalid')
    expect(field).toHaveValue('7,00 €')
  })

  it('reports a cleared field as no amount', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(value: Cents | null) => void>()
    render(withMoney(<Harness initial={350} onChange={onChange} />))
    const field = screen.getByRole('textbox', { name: 'Amount' })
    await user.clear(field)
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('placeholder', '0,00 €')
  })

  it('hides the amount while amounts are hidden, but edits the real number', async () => {
    const user = userEvent.setup()
    render(withMoney(<Harness initial={1399} />, money({ masked: true })))
    const field = screen.getByRole('textbox', { name: 'Amount' })
    expect(field).toHaveValue('•••')
    await user.click(field)
    expect(field).toHaveValue('13,99')
  })

  it('shows an error from the form under the row', () => {
    render(withMoney(<AmountField label="Monthly limit" value={null} onChange={() => {}} error="Enter an amount above 0." />))
    expect(screen.getByRole('textbox', { name: 'Monthly limit' })).toHaveAccessibleDescription('Enter an amount above 0.')
  })

  it('hands the input to inputRef', () => {
    const ref = createRef<HTMLInputElement>()
    render(withMoney(<AmountField label="This month" value={null} onChange={() => {}} inputRef={ref} />))
    expect(ref.current).toBe(screen.getByRole('textbox', { name: 'This month' }))
  })

  it('is a form row by default, and a bare cell with variant cell', () => {
    const { container, rerender } = render(withMoney(<AmountField label="Amount" value={1399} onChange={() => {}} />))
    expect(container.firstElementChild).toHaveAttribute('data-row', '')
    rerender(withMoney(<AmountField label="Amount" value={1399} onChange={() => {}} variant="cell" error="Enter an amount above 0." />))
    const field = container.firstElementChild as HTMLElement
    expect(field).not.toHaveAttribute('data-row')
    expect(field.querySelector('[data-part="line"]')).toContainElement(screen.getByRole('textbox', { name: 'Amount' }))
    expect(field.querySelector('[data-part="error"]')).toHaveTextContent('Enter an amount above 0.')
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveAccessibleDescription('Enter an amount above 0.')
  })

  it('sets a placeholder in words in the UI font, and leaves figures serif', () => {
    const { rerender } = render(withMoney(<AmountField label="Monthly limit" value={null} onChange={() => {}} placeholder="None" />))
    expect(screen.getByRole('textbox', { name: 'Monthly limit' })).toHaveAttribute('data-placeholder', 'text')
    rerender(withMoney(<AmountField label="Monthly limit" value={null} onChange={() => {}} />))
    expect(screen.getByRole('textbox', { name: 'Monthly limit' }).getAttribute('placeholder')).toMatch(/^0,00\s€$/)
    expect(screen.getByRole('textbox', { name: 'Monthly limit' })).not.toHaveAttribute('data-placeholder')
    const css = readSibling(import.meta.url, 'AmountField.module.css')
    expect(cssRule(css, ".input[data-placeholder='text']::placeholder").font).toBe('var(--text-body)')
  })

  it('sizes the input to its text, so the label keeps the rest of the row', () => {
    render(withMoney(<AmountField label="Different amount this month" value={1399} onChange={() => {}} />))
    // "13,99 €": four figures, the comma and the space at half a figure, the euro sign.
    expect(screen.getByRole('textbox').style.getPropertyValue('--chars')).toBe('6')
    const css = readSibling(import.meta.url, 'AmountField.module.css')
    expect(cssRule(css, '.input').flex).toBe('0 1 calc(var(--chars, 6) * 1ch + 2px)')
    // A label that wraps keeps 11 from the group's edges; the row itself has no vertical padding.
    expect(px(cssRule(css, '.label')['padding-top'] ?? '')).toBe(11)
    expect(px(cssRule(css, '.label')['padding-bottom'] ?? '')).toBe(11)
    expect(cssRule(css, '.line').padding).toBe('0 var(--group-padding)')
  })
})

describe('amountWidthCh', () => {
  it('counts figures, signs and letters as one ch and separators and spaces as half', () => {
    expect(amountWidthCh('640,00 €')).toBe(7)
    expect(amountWidthCh('1.234,56')).toBe(7)
    expect(amountWidthCh('$1,234.56')).toBe(8)
    expect(amountWidthCh('None')).toBe(4)
    expect(amountWidthCh('')).toBe(1)
  })
})
