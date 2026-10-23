import { describe, expect, it } from 'vitest'
import { MASKED, createMoneyFormat, formatMoney, formatMoneyParts } from '@/domain/money'

// Amounts without their symbol, for the ledger addends and the hanging unit (docs/DESIGN.md §9.6).

const spaces = /[  ]/g

describe('formatMoney with symbol: false', () => {
  it('formats the number alone with the locale grouping', () => {
    expect(formatMoney(145000, { currency: 'EUR', locale: 'de-DE', symbol: false })).toBe('1.450,00')
    expect(formatMoney(123456, { currency: 'USD', locale: 'en-US', symbol: false })).toBe('1,234.56')
    expect(formatMoney(-350, { currency: 'EUR', locale: 'de-DE', symbol: false })).toBe('-3,50')
    expect(formatMoney(350, { currency: 'EUR', locale: 'de-DE', symbol: false, sign: 'always' })).toBe('+3,50')
    expect(formatMoney(35000, { currency: 'JPY', locale: 'en-US', symbol: false })).toBe('350')
    expect(formatMoney(123456, { currency: 'CHF', locale: 'de-CH', symbol: false }).replace(spaces, ' ')).toBe(
      '1’234.56',
    )
  })

  it('keeps every other rule of formatMoney', () => {
    expect(formatMoney(150, { currency: 'EUR', locale: 'de-DE', symbol: false, showCents: false })).toBe('2')
    expect(formatMoney(-0, { currency: 'EUR', locale: 'de-DE', symbol: false })).toBe('0,00')
    expect(formatMoney(0, { currency: 'EUR', locale: 'de-DE', symbol: false, sign: 'always' })).toBe('0,00')
  })
})

describe('formatMoneyParts', () => {
  it('splits number and symbol and says which comes first', () => {
    expect(formatMoneyParts(23472, { currency: 'EUR', locale: 'de-DE' })).toEqual({
      number: '234,72',
      symbol: '€',
      symbolFirst: false,
    })
    expect(formatMoneyParts(-350, { currency: 'USD', locale: 'en-US' })).toEqual({
      number: '-3.50',
      symbol: '$',
      symbolFirst: true,
    })
    expect(formatMoneyParts(123456, { currency: 'CHF', locale: 'de-CH' })).toMatchObject({
      symbol: 'CHF',
      symbolFirst: true,
    })
    expect(formatMoneyParts(150, { currency: 'EUR', locale: 'de-DE', showCents: false })).toEqual({
      number: '2',
      symbol: '€',
      symbolFirst: false,
    })
  })

  // Negative amounts are left out: en-US writes "-$3.50", while the parts keep the sign with the
  // number ({ number: '-3.50', symbol: '$' }), which a hanging-unit layout renders as "$ -3.50".
  it('joins back to the full formatted amount apart from spacing', () => {
    for (const [currency, locale] of [
      ['EUR', 'de-DE'],
      ['EUR', 'en-IE'],
      ['USD', 'en-US'],
      ['GBP', 'en-GB'],
      ['CHF', 'de-CH'],
      ['EUR', 'fr-FR'],
      ['ALL', 'sq-AL'],
    ] as const) {
      for (const cents of [0, 350, 123456, 9999999999]) {
        const parts = formatMoneyParts(cents, { currency, locale })
        const joined = parts.symbolFirst ? parts.symbol + parts.number : parts.number + parts.symbol
        const full = formatMoney(cents, { currency, locale }).replace(/[\s  ]/g, '')
        expect(joined.replace(/[\s  ]/g, '')).toBe(full)
      }
    }
  })
})

describe('MoneyFormat parts and symbol', () => {
  it('masks the number but keeps the symbol', () => {
    const masked = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: true })
    expect(masked.parts(23472)).toEqual({ number: MASKED, symbol: '€', symbolFirst: false })
    expect(masked.parts(23472, { unmasked: true }).number).toBe('234,72')
    expect(masked.format(23472, { symbol: false })).toBe(MASKED)
  })

  it('formats without the symbol when unmasked', () => {
    const open = createMoneyFormat({ currency: 'EUR', locale: 'de-DE', showCents: true, masked: false })
    expect(open.format(23472, { symbol: false })).toBe('234,72')
    expect(open.parts(-4128)).toEqual({ number: '-41,28', symbol: '€', symbolFirst: false })
  })
})
