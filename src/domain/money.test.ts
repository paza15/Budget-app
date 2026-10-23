import { describe, expect, it, vi } from 'vitest'
import { CURRENCIES } from '@/domain/catalog'
import { MAX_CENTS } from '@/domain/constants'
import {
  applyKeypadKey,
  centsToDecimalString,
  centsToKeypadString,
  createMoneyFormat,
  currencyDigits,
  currencySymbol,
  decimalSeparator,
  formatKeypadString,
  formatMoney,
  keypadStringToCents,
  MASKED,
  parseAmountInput,
  ratio,
  sumCents,
  type CurrencyDigits,
  type KeypadKey,
} from '@/domain/money'

/**
 * Intl separates amount and symbol with U+00A0 and groups with U+202F in some locales. Tests that
 * spell out an expected string compare after turning both into plain spaces; tests that need the
 * exact characters compute the expectation with Intl itself.
 */
/**
 * Compares formatted output across ICU versions: no-break spaces become plain ones, and de-CH's
 * group separator becomes \u2019. Newer CLDR data writes the Swiss grouping as a plain apostrophe
 * (1'234.56) where older data writes \u2019 (1\u2019234.56), so Node 22 on a laptop and on the CI runner
 * disagree. The parser accepts both (AMOUNT_CHARACTERS).
 */
function spaced(s: string): string {
  return s.replace(/[\u00A0\u202F]/g, ' ').replace(/'/g, '\u2019')
}

/** The number locales of §5.3 (NUMBER_LOCALES) with the currency each region uses. */
const LOCALE_CURRENCIES = [
  ['de-DE', 'EUR'],
  ['de-AT', 'EUR'],
  ['de-CH', 'CHF'],
  ['en-IE', 'EUR'],
  ['en-GB', 'GBP'],
  ['en-US', 'USD'],
  ['fr-FR', 'EUR'],
  ['it-IT', 'EUR'],
  ['es-ES', 'EUR'],
  ['nl-NL', 'EUR'],
  ['sq-AL', 'ALL'],
  ['pl-PL', 'PLN'],
] as const

/** The currencies of §5.3 (CURRENCIES) in catalog order. */
const CURRENCY_CODES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'ALL',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'SEK',
  'NOK',
  'DKK',
  'TRY',
  'JPY',
  'CNY',
  'INR',
  'CAD',
  'AUD',
] as const

const EUR_DE = { currency: 'EUR', locale: 'de-DE' } as const
const USD_US = { currency: 'USD', locale: 'en-US' } as const
const JPY_US = { currency: 'JPY', locale: 'en-US' } as const

/** Amounts for the §4.1 round-trip property; whole units only for 0-digit currencies. */
function roundTripValues(digits: CurrencyDigits): number[] {
  const values = [100, 500, 350, 123456, 1234567]
  return digits === 0 ? values.map((c) => Math.round(c / 100) * 100) : values
}

describe('currencyDigits', () => {
  it.each(CURRENCY_CODES.map((code) => [code, code === 'ALL' || code === 'JPY' ? 0 : 2] as const))(
    '%s has %i digits',
    (code, digits) => {
      expect(currencyDigits(code)).toBe(digits)
    },
  )

  it.each(['XYZ', 'KRW', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'gives 2 for the unknown code %j',
    (code) => {
      expect(currencyDigits(code)).toBe(2)
    },
  )

  it('ignores letter case like Intl does', () => {
    expect(currencyDigits('jpy')).toBe(0)
    expect(currencyDigits('All')).toBe(0)
    expect(currencyDigits('eur')).toBe(2)
  })

  it('matches the digits column of the catalog CURRENCIES table', () => {
    const fromTable = CURRENCIES.map(({ code }) => ({ code, digits: currencyDigits(code) }))
    expect(fromTable).toEqual(CURRENCIES.map(({ code, digits }) => ({ code, digits })))
  })
})

describe('decimalSeparator', () => {
  it.each([
    ['de-DE', ','],
    ['de-AT', ','],
    ['de-CH', '.'],
    ['en-IE', '.'],
    ['en-GB', '.'],
    ['en-US', '.'],
    ['fr-FR', ','],
    ['it-IT', ','],
    ['es-ES', ','],
    ['nl-NL', ','],
    ['sq-AL', ','],
    ['pl-PL', ','],
  ])('%s writes amounts with "%s"', (locale, separator) => {
    expect(decimalSeparator(locale)).toBe(separator)
  })

  it('uses the separator of currency amounts where it differs from plain numbers', () => {
    // fr-CH writes 1,5 but 1.50 CHF.
    expect(decimalSeparator('fr-CH')).toBe('.')
  })

  it('reads Latin digits, so locales with native digits still give "." or ","', () => {
    expect(decimalSeparator('ar-EG')).toBe('.')
  })
})

describe('currencySymbol', () => {
  it.each([
    ['EUR', 'de-DE', '€'],
    ['EUR', 'nl-NL', '€'],
    ['USD', 'en-US', '$'],
    ['USD', 'en-GB', 'US$'],
    ['GBP', 'en-GB', '£'],
    ['CHF', 'de-CH', 'CHF'],
    ['PLN', 'pl-PL', 'zł'],
    ['ALL', 'sq-AL', 'Lekë'],
    ['JPY', 'en-US', '¥'],
  ])('%s in %s is %s', (currency, locale, symbol) => {
    expect(currencySymbol(currency, locale)).toBe(symbol)
  })
})

describe('formatMoney', () => {
  it('passes Intl output through unchanged, non-breaking spaces included', () => {
    const intl = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
    expect(formatMoney(350, EUR_DE)).toBe(intl.format(3.5))
    expect(formatMoney(350, EUR_DE)).toMatch(/^3,50[\u00A0\u202F]€$/)
  })

  it.each([
    [350, 'EUR', 'de-DE', '3,50 €'],
    [350, 'EUR', 'en-US', '€3.50'],
    [123456, 'USD', 'en-US', '$1,234.56'],
    [123456, 'EUR', 'de-AT', '€ 1.234,56'],
    [123456, 'EUR', 'fr-FR', '1 234,56 €'],
    [123456, 'EUR', 'nl-NL', '€ 1.234,56'],
    [123456, 'CHF', 'de-CH', 'CHF 1’234.56'],
    [123456, 'GBP', 'en-GB', '£1,234.56'],
    [123456, 'PLN', 'pl-PL', '1234,56 zł'],
    [1234567, 'PLN', 'pl-PL', '12 345,67 zł'],
    [5, 'EUR', 'de-DE', '0,05 €'],
    [0, 'EUR', 'de-DE', '0,00 €'],
    [MAX_CENTS, 'EUR', 'de-DE', '99.999.999,99 €'],
  ])('%i %s in %s → %s', (cents, currency, locale, expected) => {
    expect(spaced(formatMoney(cents, { currency, locale }))).toBe(expected)
  })

  it('shows whole units for 0-digit currencies, rounded half away from zero', () => {
    expect(formatMoney(35000, JPY_US)).toBe('¥350')
    expect(formatMoney(35050, JPY_US)).toBe('¥351')
    expect(formatMoney(35049, JPY_US)).toBe('¥350')
    expect(formatMoney(-35050, JPY_US)).toBe('-¥351')
    expect(formatMoney(35050, { ...JPY_US, showCents: true })).toBe('¥351')
    expect(spaced(formatMoney(123456, { currency: 'ALL', locale: 'sq-AL' }))).toBe('1235 Lekë')
  })

  it('writes negative amounts with the locale minus', () => {
    expect(spaced(formatMoney(-350, EUR_DE))).toBe('-3,50 €')
    expect(formatMoney(-350, USD_US)).toBe('-$3.50')
  })

  it('maps sign always to a plus on positive amounts, never on zero', () => {
    expect(spaced(formatMoney(350, { ...EUR_DE, sign: 'always' }))).toBe('+3,50 €')
    expect(spaced(formatMoney(-350, { ...EUR_DE, sign: 'always' }))).toBe('-3,50 €')
    expect(spaced(formatMoney(0, { ...EUR_DE, sign: 'always' }))).toBe('0,00 €')
    expect(formatMoney(0, { ...USD_US, sign: 'always' })).toBe('$0.00')
  })

  it('drops the sign with sign never and keeps it with auto', () => {
    expect(spaced(formatMoney(-350, { ...EUR_DE, sign: 'never' }))).toBe('3,50 €')
    expect(spaced(formatMoney(350, { ...EUR_DE, sign: 'never' }))).toBe('3,50 €')
    expect(spaced(formatMoney(350, { ...EUR_DE, sign: 'auto' }))).toBe('3,50 €')
    expect(spaced(formatMoney(-350, { ...EUR_DE, sign: 'auto' }))).toBe('-3,50 €')
  })

  it('normalises −0 to 0, also after rounding to whole units', () => {
    expect(spaced(formatMoney(-0, EUR_DE))).toBe('0,00 €')
    expect(spaced(formatMoney(-0, { ...EUR_DE, showCents: false }))).toBe('0 €')
    expect(formatMoney(-0, JPY_US)).toBe('¥0')
    expect(formatMoney(-49, JPY_US)).toBe('¥0')
    expect(formatMoney(-0, { ...USD_US, compact: true })).toBe('$0')
  })

  it.each([
    [123456, '1.235 €'],
    [123449, '1.234 €'],
    [123450, '1.235 €'],
    [-123450, '-1.235 €'],
    [-123449, '-1.234 €'],
    [100, '1 €'],
    [50, '1 €'],
    [-50, '-1 €'],
    [0, '0 €'],
    // Rounding would show a non-zero amount as 0, so it keeps its cents.
    [49, '0,49 €'],
    [-49, '-0,49 €'],
    [1, '0,01 €'],
  ])('showCents false: %i → %s', (cents, expected) => {
    expect(spaced(formatMoney(cents, { ...EUR_DE, showCents: false }))).toBe(expected)
  })

  it('shows cents when showCents is true or left out (also when passed as undefined)', () => {
    expect(spaced(formatMoney(123456, { ...EUR_DE, showCents: true }))).toBe('1.234,56 €')
    expect(spaced(formatMoney(123456, { ...EUR_DE, showCents: undefined }))).toBe('1.234,56 €')
    expect(spaced(formatMoney(123456, { ...EUR_DE, sign: undefined, compact: undefined }))).toBe('1.234,56 €')
  })

  it.each([
    [0, '$0'],
    [350, '$3.5'],
    [25000, '$250'],
    [100000, '$1K'],
    [125000, '$1.25K'],
    [150000, '$1.5K'],
    [1250000, '$12.5K'],
    [12345600, '$123K'],
    [123456789, '$1.23M'],
  ])('compact for chart ticks: %i → %s', (cents, expected) => {
    expect(formatMoney(cents, { ...USD_US, compact: true })).toBe(expected)
  })

  it('compact keeps whole units where the locale does not abbreviate thousands', () => {
    expect(spaced(formatMoney(123456, { ...EUR_DE, compact: true }))).toBe('1235 €')
    expect(spaced(formatMoney(12345678, { ...EUR_DE, compact: true }))).toBe('123.457 €')
    expect(spaced(formatMoney(123456789, { ...EUR_DE, compact: true }))).toBe('1,23 Mio. €')
  })

  it('compact rounds 0-digit currencies to whole units first and honours the sign', () => {
    expect(formatMoney(35050, { ...JPY_US, compact: true })).toBe('¥351')
    expect(formatMoney(123400, { ...JPY_US, compact: true })).toBe('¥1.23K')
    expect(formatMoney(-125000, { ...USD_US, compact: true })).toBe('-$1.25K')
    expect(formatMoney(125000, { ...USD_US, compact: true, sign: 'always' })).toBe('+$1.25K')
  })

  it('writes Latin digits whatever the locale', () => {
    expect(formatMoney(123456, { currency: 'EUR', locale: 'ar-EG' })).toMatch(/1,234\.56/)
  })

  it('creates each Intl.NumberFormat once and reuses it', () => {
    const NumberFormat = vi.spyOn(Intl, 'NumberFormat')
    // A combination no other test uses, so the cache starts without it.
    const o = { currency: 'NOK', locale: 'en-IE', sign: 'never' } as const
    const first = formatMoney(12345, o)
    expect(formatMoney(12345, o)).toBe(first)
    expect(formatMoney(678, o)).not.toBe(first)
    expect(NumberFormat).toHaveBeenCalledTimes(1)
  })
})

describe('createMoneyFormat', () => {
  it('describes the currency and locale it is bound to', () => {
    expect(createMoneyFormat({ ...EUR_DE, showCents: true, masked: false })).toMatchObject({
      currency: 'EUR',
      locale: 'de-DE',
      showCents: true,
      masked: false,
      digits: 2,
      decimalSeparator: ',',
      symbol: '€',
    })
    expect(createMoneyFormat({ ...JPY_US, showCents: false, masked: true })).toMatchObject({
      currency: 'JPY',
      locale: 'en-US',
      showCents: false,
      masked: true,
      digits: 0,
      decimalSeparator: '.',
      symbol: '¥',
    })
    expect(createMoneyFormat({ currency: 'CHF', locale: 'de-CH', showCents: true, masked: false })).toMatchObject({
      digits: 2,
      decimalSeparator: '.',
      symbol: 'CHF',
    })
  })

  it('formats like formatMoney with the bound currency and locale', () => {
    const money = createMoneyFormat({ ...EUR_DE, showCents: true, masked: false })
    for (const cents of [0, 5, 350, -350, 123456, MAX_CENTS]) {
      expect(money.format(cents)).toBe(formatMoney(cents, EUR_DE))
      expect(money.format(cents, { sign: 'always' })).toBe(formatMoney(cents, { ...EUR_DE, sign: 'always' }))
      expect(money.format(cents, { compact: true })).toBe(formatMoney(cents, { ...EUR_DE, compact: true }))
    }
  })

  it('shows cents unless the call asks otherwise, whatever settings.showCents says', () => {
    const money = createMoneyFormat({ ...EUR_DE, showCents: false, masked: false })
    expect(spaced(money.format(123456))).toBe('1.234,56 €')
    expect(spaced(money.format(123456, { showCents: undefined, sign: undefined }))).toBe('1.234,56 €')
    // BigAmount passes the setting through.
    expect(spaced(money.format(123456, { showCents: money.showCents }))).toBe('1.235 €')
  })

  it('returns MASKED for every amount while masked', () => {
    const money = createMoneyFormat({ ...EUR_DE, showCents: true, masked: true })
    expect(money.format(350)).toBe(MASKED)
    expect(money.format(0)).toBe(MASKED)
    expect(money.format(-350, { sign: 'always' })).toBe(MASKED)
    expect(money.format(350, { compact: true })).toBe(MASKED)
    expect(money.format(350, { showCents: false })).toBe(MASKED)
    expect(money.format(350, { unmasked: false })).toBe(MASKED)
    expect(MASKED).toBe('•••')
  })

  it('shows the amount while masked when the call passes unmasked', () => {
    const money = createMoneyFormat({ ...EUR_DE, showCents: true, masked: true })
    expect(money.format(350, { unmasked: true })).toBe(formatMoney(350, EUR_DE))
    expect(money.format(350, { unmasked: true, sign: 'always' })).toBe(formatMoney(350, { ...EUR_DE, sign: 'always' }))
  })

  it('ignores unmasked when not masked', () => {
    const money = createMoneyFormat({ ...EUR_DE, showCents: true, masked: false })
    expect(money.format(350, { unmasked: true })).toBe(money.format(350))
  })

  it('reuses cached Intl.NumberFormat instances across formats with the same settings', () => {
    const NumberFormat = vi.spyOn(Intl, 'NumberFormat')
    // A locale no other test uses, so the cache starts without it.
    const settings = { currency: 'SEK', locale: 'da-DK', showCents: true, masked: false }
    const a = createMoneyFormat(settings)
    const b = createMoneyFormat(settings)
    for (const cents of [1, 350, 123456]) expect(b.format(cents)).toBe(a.format(cents))
    // The decimal separator probe, the symbol (no fraction digits) and the amounts: three
    // instances, however many formats and amounts.
    expect(NumberFormat).toHaveBeenCalledTimes(3)
  })

  it('throws a RangeError for a malformed currency code', () => {
    expect(() => createMoneyFormat({ currency: 'EURO', locale: 'de-DE', showCents: true, masked: false })).toThrow(
      RangeError,
    )
  })
})

describe('centsToDecimalString', () => {
  it.each([
    [350, 2, '3.50'],
    [5, 2, '0.05'],
    [0, 2, '0.00'],
    [-0, 2, '0.00'],
    [100, 2, '1.00'],
    [123456, 2, '1234.56'],
    [MAX_CENTS, 2, '99999999.99'],
    [-350, 2, '-3.50'],
    [-5, 2, '-0.05'],
    [350, 0, '4'],
    [349, 0, '3'],
    [35000, 0, '350'],
    [49, 0, '0'],
    [50, 0, '1'],
    [-350, 0, '-4'],
    [-49, 0, '0'],
    [0, 0, '0'],
  ] as const)('(%i, %i) → %s', (cents, digits, expected) => {
    expect(centsToDecimalString(cents, digits)).toBe(expected)
  })

  it('matches the CSV examples of §4.7: EUR 5 → 0.05, JPY 35000 → 350', () => {
    expect(centsToDecimalString(5, currencyDigits('EUR'))).toBe('0.05')
    expect(centsToDecimalString(35000, currencyDigits('JPY'))).toBe('350')
  })
})

describe('parseAmountInput', () => {
  it.each([
    ['1.234', 2, ',', 123400],
    ['1,234', 2, ',', null],
    ['1,234', 2, '.', 123400],
    ['1.234', 2, '.', null],
    ['3,5', 2, '.', 350],
    ['1.234,5', 2, ',', 123450],
    ['3.50', 0, ',', null],
    ['1.234', 0, ',', 123400],
    ['CHF 1’234.56', 2, '.', 123456],
    ['1 234,56 €', 2, ',', 123456],
    ['1.2.3,4', 2, ',', null],
    ['3,', 2, ',', 300],
    [',5', 2, ',', 50],
    ['−3,50 €', 2, ',', null],
    ['99.999.999,99', 2, ',', 9999999999],
    ['100.000.000', 2, ',', null],
  ] as const)('§4.1 table: (%s, %i, "%s") → %s', (input, digits, sep, expected) => {
    expect(parseAmountInput(input, digits, sep)).toBe(expected)
  })

  it.each([
    ['1\u00A0234,56\u00A0€', 123456],
    ['1\u202F234,56\u00A0€', 123456],
    ['1\u2009234,50', 123450],
    [' 3,50 ', 350],
    ['3,50\t€', 350],
    ['\n12\n', 1200],
  ] as const)('ignores every kind of whitespace: %j → %i', (input, expected) => {
    expect(parseAmountInput(input, 2, ',')).toBe(expected)
  })

  it.each([
    ['€3.50', 2, ',', 350],
    ['$1,234.56', 2, '.', 123456],
    ['US$ 12', 2, '.', 1200],
    ['12 EUR', 2, ',', 1200],
    ['EUR 12 EUR', 2, ',', 1200],
    ['12,50 zł', 2, ',', 1250],
    ['CA$5', 2, '.', 500],
    ['350 Lekë', 0, ',', 35000],
    ['1\u00A0234\u00A0Lekë', 0, ',', 123400],
    ['¥1,234', 0, '.', 123400],
  ] as const)('ignores one symbol or code at each end: (%s, %i, "%s") → %i', (input, digits, sep, expected) => {
    expect(parseAmountInput(input, digits, sep)).toBe(expected)
  })

  it.each(['-3', '-3,50 €', '3-', '(3,50)', '€ −1', '−0'])('rejects negative input %j', (input) => {
    expect(parseAmountInput(input, 2, ',')).toBeNull()
  })

  it.each(['', '   ', '€', 'EUR', '.', ',', "'", 'abc', '3,50 € 4', '1e5', '0x10', '+3', '12a34', '3.5.0', '½', '١٢٣'])(
    'rejects %j',
    (input) => {
      expect(parseAmountInput(input, 2, ',')).toBeNull()
    },
  )

  it('reads the last mark as decimal when it is the locale separator or cannot be grouping', () => {
    // US-style input in a German locale: "." occurs once and is not followed by three digits.
    expect(parseAmountInput('1,234.5', 2, ',')).toBe(123450)
    expect(parseAmountInput('0.5', 2, ',')).toBe(50)
    expect(parseAmountInput('5.', 2, ',')).toBe(500)
    // "3.505" can only be grouping in a German locale; "3,505" has too many decimals.
    expect(parseAmountInput('3.505', 2, ',')).toBe(350500)
    expect(parseAmountInput('3,505', 2, ',')).toBeNull()
  })

  it('accepts groups of three with one kind of mark only', () => {
    expect(parseAmountInput("1'234,5", 2, ',')).toBe(123450)
    expect(parseAmountInput('1’234’567.89', 2, '.')).toBe(123456789)
    expect(parseAmountInput('1,234,567', 2, '.')).toBe(123456700)
    expect(parseAmountInput('1.000.000', 2, ',')).toBe(100000000)
    expect(parseAmountInput("1'234.567", 2, ',')).toBeNull()
    expect(parseAmountInput('1.234,567.890', 2, ',')).toBeNull()
    expect(parseAmountInput('12,34,567', 2, '.')).toBeNull()
    expect(parseAmountInput("'1000", 2, ',')).toBeNull()
    expect(parseAmountInput('1,234,56', 2, ',')).toBeNull()
  })

  it('strips leading zeros and allows at most 8 integer digits', () => {
    expect(parseAmountInput('007', 2, ',')).toBe(700)
    expect(parseAmountInput('0,05', 2, ',')).toBe(5)
    expect(parseAmountInput('0', 2, ',')).toBe(0)
    expect(parseAmountInput('00000000012,34', 2, ',')).toBe(1234)
    expect(parseAmountInput('99999999', 2, ',')).toBe(9999999900)
    expect(parseAmountInput('12.345.678,9', 2, ',')).toBe(1234567890)
    expect(parseAmountInput('123456789', 2, ',')).toBeNull()
    expect(parseAmountInput('123.456.789', 2, ',')).toBeNull()
  })

  it('rejects fractions longer than the currency allows instead of rounding', () => {
    expect(parseAmountInput('3,505', 2, ',')).toBeNull()
    expect(parseAmountInput('3,5', 0, ',')).toBeNull()
    expect(parseAmountInput('1.234', 0, '.')).toBeNull()
    expect(parseAmountInput('350,', 0, ',')).toBe(35000)
    expect(parseAmountInput('1,234', 0, '.')).toBe(123400)
  })

  it.each(LOCALE_CURRENCIES)('§4.1 property: parse(format(c)) === c in %s with %s', (locale, currency) => {
    const digits = currencyDigits(currency)
    const sep = decimalSeparator(locale)
    const values = roundTripValues(digits)
    const parsed = values.map((cents) => parseAmountInput(formatMoney(cents, { currency, locale }), digits, sep))
    expect(parsed).toEqual(values)
  })

  it('round-trips every catalog currency in every number locale, up to MAX_CENTS', () => {
    const failures: string[] = []
    for (const [locale] of LOCALE_CURRENCIES) {
      const sep = decimalSeparator(locale)
      for (const currency of CURRENCY_CODES) {
        const digits = currencyDigits(currency)
        const values = [...roundTripValues(digits), 0]
        for (const cents of [...values, digits === 0 ? MAX_CENTS - 99 : MAX_CENTS]) {
          const text = formatMoney(cents, { currency, locale })
          const parsed = parseAmountInput(text, digits, sep)
          if (parsed !== cents) failures.push(`${locale} ${currency} ${cents}: ${JSON.stringify(text)} → ${parsed}`)
        }
        // Whole-unit display (BigAmount without cents) parses back to the rounded amount.
        for (const cents of values) {
          const whole = formatMoney(cents, { currency, locale, showCents: false })
          const rounded = Math.round(cents / 100) * 100
          if (parseAmountInput(whole, digits, sep) !== rounded) failures.push(`${locale} ${currency} ${whole}`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})

describe('applyKeypadKey', () => {
  it.each([
    ['0', '0', 2, '0'],
    ['0', '5', 2, '5'],
    ['', '.', 2, '0.'],
    ['0.', 'back', 2, ''],
    ['12345678', '9', 2, '12345678'],
    ['3.50', '1', 2, '3.50'],
    ['3', '.', 0, '3'],
  ] as const)('§4.1 table: (%j, %j, digits %i) → %j', (current, key, digits, expected) => {
    expect(applyKeypadKey(current, key, digits)).toBe(expected)
  })

  it.each([
    ['', '0', 2, '0'],
    ['', '5', 2, '5'],
    ['3', '5', 2, '35'],
    ['3', '.', 2, '3.'],
    ['3.', '.', 2, '3.'],
    ['3.5', '.', 2, '3.5'],
    ['3.', '5', 2, '3.5'],
    ['3.5', '0', 2, '3.50'],
    ['0.', '0', 2, '0.0'],
    ['0.0', '5', 2, '0.05'],
    ['1234567', '8', 2, '12345678'],
    ['12345678', '.', 2, '12345678.'],
    ['12345678.', '9', 2, '12345678.9'],
    ['3', '5', 0, '35'],
    ['', '.', 0, ''],
    ['12345678', '0', 0, '12345678'],
  ] as const)('(%j, %j, digits %i) → %j', (current, key, digits, expected) => {
    expect(applyKeypadKey(current, key, digits)).toBe(expected)
  })

  it.each([
    ['3.5', '3.'],
    ['3.', '3'],
    ['35', '3'],
    ['3', ''],
    ['10', '1'],
    ['0', ''],
    ['', ''],
    ['0.05', '0.0'],
    ['0.0', '0.'],
  ])('back: %j → %j', (current, expected) => {
    expect(applyKeypadKey(current, 'back', 2)).toBe(expected)
  })

  it('builds an amount key by key', () => {
    const keys: KeypadKey[] = ['0', '1', '2', '.', '3', '4', '5', 'back', '9']
    expect(keys.reduce((s, key) => applyKeypadKey(s, key, 2), '')).toBe('12.39')
  })

  it('keeps any key sequence canonical and in range (seeded random walk)', () => {
    const keys: KeypadKey[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', 'back', 'back', '0', '.']
    let seed = 20261018
    const random = (): number => {
      // Park–Miller LCG: deterministic, so a failure reproduces.
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    const failures: string[] = []
    for (const digits of [0, 2] as const) {
      const canonical = digits === 2 ? /^$|^(?:0|[1-9]\d{0,7})(?:\.\d{0,2})?$/ : /^$|^(?:0|[1-9]\d{0,7})$/
      let s = ''
      for (let step = 0; step < 20000; step += 1) {
        const key = keys[Math.floor(random() * keys.length)] ?? 'back'
        s = applyKeypadKey(s, key, digits)
        const cents = keypadStringToCents(s)
        // A keypad string reads as the same amount through the typed-text parser.
        if (!canonical.test(s) || cents > MAX_CENTS || cents !== (parseAmountInput(s, digits, '.') ?? 0)) {
          failures.push(`digits ${digits}: ${JSON.stringify(s)}`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})

describe('keypadStringToCents', () => {
  it.each([
    ['', 0],
    ['3.', 300],
    ['0.05', 5],
    ['3.5', 350],
    ['3.50', 350],
    ['0', 0],
    ['0.', 0],
    ['1000', 100000],
    ['12345678.99', 1234567899],
    ['99999999.99', MAX_CENTS],
  ])('%j → %i', (s, expected) => {
    expect(keypadStringToCents(s)).toBe(expected)
  })

  it('reads malformed strings as 0', () => {
    expect(keypadStringToCents('abc')).toBe(0)
    expect(keypadStringToCents('1.2.3')).toBe(0)
    expect(keypadStringToCents('-3')).toBe(0)
  })
})

describe('centsToKeypadString', () => {
  it.each([
    [0, 2, ''],
    [300, 2, '3'],
    [350, 2, '3.50'],
    [305, 2, '3.05'],
    [5, 2, '0.05'],
    [100000, 2, '1000'],
    [MAX_CENTS, 2, '99999999.99'],
    [-350, 2, '3.50'],
    [35000, 0, '350'],
    [35050, 0, '351'],
    [35049, 0, '350'],
    [50, 0, '1'],
    [49, 0, ''],
    [0, 0, ''],
  ] as const)('(%i, digits %i) → %j', (cents, digits, expected) => {
    expect(centsToKeypadString(cents, digits)).toBe(expected)
  })

  it('round-trips through keypadStringToCents', () => {
    for (let cents = 0; cents <= 2000; cents += 1) {
      expect(keypadStringToCents(centsToKeypadString(cents, 2))).toBe(cents)
    }
    for (const cents of [123456, 1234567, MAX_CENTS]) {
      expect(keypadStringToCents(centsToKeypadString(cents, 2))).toBe(cents)
    }
    for (const cents of [100, 35000, MAX_CENTS - 99]) {
      expect(keypadStringToCents(centsToKeypadString(cents, 0))).toBe(cents)
    }
  })

  it('never rounds a 0-digit amount past the keypad’s 8 digits or MAX_CENTS', () => {
    // A 2-digit amount near the top, shown after the currency was switched to JPY or ALL: whole
    // units half away from zero would be 100 000 000.
    for (const cents of [9_999_999_950, 9_999_999_975, MAX_CENTS]) {
      const s = centsToKeypadString(cents, 0)
      expect(s).toBe('99999999')
      expect(keypadStringToCents(s)).toBe(9_999_999_900)
      // The keypad is full, so typing cannot carry it further either.
      expect(applyKeypadKey(s, '9', 0)).toBe(s)
    }
    expect(centsToKeypadString(9_999_999_949, 0)).toBe('99999999')
    expect(centsToKeypadString(9_999_999_849, 0)).toBe('99999998')
  })

  it('gives the string of MAX_CENTS for anything above it', () => {
    expect(centsToKeypadString(MAX_CENTS + 1, 2)).toBe('99999999.99')
    expect(centsToKeypadString(-(MAX_CENTS + 1), 2)).toBe('99999999.99')
    expect(centsToKeypadString(MAX_CENTS + 1, 0)).toBe('99999999')
    expect(centsToKeypadString(Number.MAX_SAFE_INTEGER, 0)).toBe('99999999')
  })

  it('always gives a string the keypad can hold, worth at most MAX_CENTS', () => {
    const canonical = { 0: /^$|^[1-9]\d{0,7}$/, 2: /^$|^(?:0|[1-9]\d{0,7})(?:\.\d{2})?$/ } as const
    const failures: string[] = []
    for (const digits of [0, 2] as const) {
      for (let cents = MAX_CENTS - 300; cents <= MAX_CENTS + 300; cents += 1) {
        const s = centsToKeypadString(cents, digits)
        if (!canonical[digits].test(s) || keypadStringToCents(s) > MAX_CENTS) failures.push(`${cents}, ${digits}: ${s}`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe('formatKeypadString', () => {
  it.each([
    ['1234.5', 'EUR', 'de-DE', '1.234,5 €'],
    ['3.', 'USD', 'en-US', '$3.'],
    ['', 'EUR', 'de-DE', '0 €'],
    ['', 'USD', 'en-US', '$0'],
    ['0', 'EUR', 'de-DE', '0 €'],
    ['0.', 'EUR', 'de-DE', '0, €'],
    ['0.05', 'EUR', 'de-DE', '0,05 €'],
    ['1234.5', 'EUR', 'nl-NL', '€ 1.234,5'],
    ['1234.56', 'CHF', 'de-CH', 'CHF 1’234.56'],
    ['1234.5', 'EUR', 'fr-FR', '1 234,5 €'],
    ['12345.6', 'PLN', 'pl-PL', '12 345,6 zł'],
    ['12345678', 'JPY', 'en-US', '¥12,345,678'],
    ['1234', 'ALL', 'sq-AL', '1234 Lekë'],
    ['3.5', 'CHF', 'fr-CH', '3.5 CHF'],
  ])('(%j, %s, %s) → %s', (s, currency, locale, expected) => {
    expect(spaced(formatKeypadString(s, { currency, locale }))).toBe(expected)
  })

  it('renders malformed strings as 0', () => {
    expect(spaced(formatKeypadString('abc', EUR_DE))).toBe('0 €')
  })

  it('matches formatMoney exactly once the fraction is complete', () => {
    const failures: string[] = []
    for (const [locale, currency] of LOCALE_CURRENCIES) {
      const digits = currencyDigits(currency)
      const values = digits === 0 ? [100, 123400, 1234500] : [5, 350, 123456, 1234567, MAX_CENTS]
      for (const cents of values) {
        const typed = formatKeypadString(centsToKeypadString(cents, digits), { currency, locale })
        const formatted = formatMoney(cents, { currency, locale })
        if (typed !== formatted) failures.push(`${locale} ${cents}: ${typed} ≠ ${formatted}`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe('sumCents', () => {
  it('adds integers exactly', () => {
    expect(sumCents([])).toBe(0)
    expect(sumCents([350])).toBe(350)
    expect(sumCents([350, 250, -100])).toBe(500)
    expect(sumCents([MAX_CENTS, MAX_CENTS, 1])).toBe(2 * MAX_CENTS + 1)
    // 0.1 + 0.2 in floats; in cents it stays exact.
    expect(sumCents([10, 20])).toBe(30)
  })
})

describe('ratio', () => {
  it('divides part by whole', () => {
    expect(ratio(1, 4)).toBe(0.25)
    expect(ratio(0, 10)).toBe(0)
    expect(ratio(15, 10)).toBe(1.5)
    expect(ratio(-5, 10)).toBe(-0.5)
  })

  it('gives 0 when the whole is 0 or negative', () => {
    expect(ratio(5, 0)).toBe(0)
    expect(ratio(5, -1)).toBe(0)
    expect(ratio(0, 0)).toBe(0)
  })
})
