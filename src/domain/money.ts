import { MAX_CENTS } from '@/domain/constants'
import type { Cents } from '@/domain/types'

/**
 * Money (docs/SPEC.md §4.1): formatting, parsing and keypad input. The only module that turns
 * Cents into text or text into Cents. Amounts are integers in hundredths of the major unit for
 * every currency; the currency's digits (0 or 2) only change input and display.
 */

/** A key on the amount keypad. '.' is the decimal key whatever the locale's separator. */
export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back'

/** Fraction digits a currency shows and accepts: 2 for EUR, 0 for JPY and ALL. */
export type CurrencyDigits = 0 | 2

/** Shown instead of an amount while amounts are hidden. Its accessible name is "Amount hidden". */
export const MASKED = '•••'

/** 'auto': minus sign for negatives only. 'always': also a plus for positives (never for 0). 'never': no sign. */
export type MoneySign = 'auto' | 'always' | 'never'

export interface FormatMoneyOptions {
  currency: string
  locale: string
  /** Default true. False rounds to whole units, half away from zero. */
  showCents?: boolean
  sign?: MoneySign
  /** Compact notation, for chart ticks only. */
  compact?: boolean
  /** Default true. False leaves out the currency symbol (ledger addends; docs/DESIGN.md §9.6). */
  symbol?: boolean
}

/**
 * An amount split for layouts that set the currency symbol apart, such as the ledger total with
 * its hanging unit: (23472, EUR, de-DE) → { number: '234,72', symbol: '€', symbolFirst: false }.
 */
export interface MoneyParts {
  /** The amount with its sign and the locale's grouping, without the symbol. */
  number: string
  symbol: string
  /** True when the locale writes the symbol before the number ('$3.50', 'CHF 3.50'). */
  symbolFirst: boolean
}

/** The settings a MoneyFormat is bound to. */
export interface MoneyFormatOptions {
  currency: string
  locale: string
  /** settings.showCents. Only BigAmount applies it; everything else always shows cents. */
  showCents: boolean
  /** hideAmounts is on and amounts are not revealed: `format()` returns MASKED. */
  masked: boolean
}

/** Per-call options of `MoneyFormat.format`. */
export interface MoneyFormatCallOptions {
  /** Default true. */
  showCents?: boolean
  sign?: MoneySign
  compact?: boolean
  /** Ignore masking (keypad display, AmountField while editing, number-format samples). */
  unmasked?: boolean
  /** Default true. False leaves out the currency symbol. */
  symbol?: boolean
}

/** A formatter bound to the user's money settings. Components read it from MoneyFormatContext. */
export interface MoneyFormat extends MoneyFormatOptions {
  digits: CurrencyDigits
  decimalSeparator: '.' | ','
  symbol: string
  format(cents: Cents, o?: MoneyFormatCallOptions): string
  /** The amount and its symbol apart; while masked, `number` is MASKED unless `unmasked`. */
  parts(cents: Cents, o?: Omit<MoneyFormatCallOptions, 'symbol'>): MoneyParts
}

/** The largest whole amount: 99 999 999, the integer part of MAX_CENTS (99.999.999,99 €). */
const MAX_WHOLE_UNITS = Math.floor(MAX_CENTS / 100)

/** Most integer digits an amount can have: 8, the digits of MAX_WHOLE_UNITS. */
const MAX_INTEGER_DIGITS = String(MAX_WHOLE_UNITS).length

// ---------------------------------------------------------------------------------------------
// Currencies and Intl formatters

/**
 * Fraction digits per currency: the `digits` column of CURRENCIES in catalog.ts. The table lives
 * here because catalog.ts imports this module. Digits never come from Intl, whose defaults follow
 * CLDR and can differ from the app's choice (ALL) and between engines, while stored cents must
 * read the same everywhere.
 */
const CURRENCY_DIGITS: ReadonlyMap<string, CurrencyDigits> = new Map<string, CurrencyDigits>([
  ['EUR', 2],
  ['USD', 2],
  ['GBP', 2],
  ['CHF', 2],
  ['ALL', 0],
  ['PLN', 2],
  ['CZK', 2],
  ['HUF', 2],
  ['RON', 2],
  ['SEK', 2],
  ['NOK', 2],
  ['DKK', 2],
  ['TRY', 2],
  ['JPY', 0],
  ['CNY', 2],
  ['INR', 2],
  ['CAD', 2],
  ['AUD', 2],
])

/** Fraction digits from the CURRENCIES table, never Intl; unknown codes give 2. */
export function currencyDigits(currency: string): CurrencyDigits {
  return CURRENCY_DIGITS.get(currency.toUpperCase()) ?? 2
}

type SignDisplay = 'auto' | 'exceptZero' | 'never'

/** 'always' must not put a plus on zero, hence exceptZero. */
const SIGN_DISPLAY: Readonly<Record<MoneySign, SignDisplay>> = {
  auto: 'auto',
  always: 'exceptZero',
  never: 'never',
}

/** Fixed fraction digits, or compact notation for chart ticks. */
type Precision = 0 | 2 | 'compact'

/**
 * Intl.NumberFormat instances by locale, currency, precision and sign. Building one costs far
 * more than using it, and a list renders an amount per row. Bounded in case settings change many
 * times in one session; clearing only means rebuilding the few instances in use.
 */
const formatters = new Map<string, Intl.NumberFormat>()
const MAX_CACHED_FORMATTERS = 128

function currencyFormatter(
  locale: string,
  currency: string,
  precision: Precision,
  signDisplay: SignDisplay,
): Intl.NumberFormat {
  const key = `${locale}|${currency}|${precision}|${signDisplay}`
  const cached = formatters.get(key)
  if (cached !== undefined) return cached

  const options: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    signDisplay,
    // Parsing and the keypad only know 0-9, so never native digits (ar-EG would use ١٢٣).
    numberingSystem: 'latn',
  }
  if (precision === 'compact') {
    // Intl's compact default with three significant digits instead of two, so ticks such as
    // 1.25K and 12.5K stay distinct; amounts that are not abbreviated keep whole units.
    options.notation = 'compact'
    options.maximumSignificantDigits = 3
    options.maximumFractionDigits = 0
    options.roundingPriority = 'morePrecision'
  } else {
    options.minimumFractionDigits = precision
    options.maximumFractionDigits = precision
  }

  const formatter = new Intl.NumberFormat(locale, options)
  if (formatters.size >= MAX_CACHED_FORMATTERS) formatters.clear()
  formatters.set(key, formatter)
  return formatter
}

/**
 * The locale's decimal separator, e.g. 'de-DE' → ",", 'en-US' → ".". Read from a currency format
 * because a few locales write amounts differently from plain numbers (fr-CH: 1,5 but 1.50 CHF).
 */
export function decimalSeparator(locale: string): '.' | ',' {
  const parts = currencyFormatter(locale, 'EUR', 2, 'auto').formatToParts(1.5)
  return parts.find((part) => part.type === 'decimal')?.value === ',' ? ',' : '.'
}

/** The currency symbol as the locale writes it, e.g. ('EUR', 'de-DE') → "€", ('CHF', 'de-CH') → "CHF". */
export function currencySymbol(currency: string, locale: string): string {
  const parts = currencyFormatter(locale, currency, 0, 'auto').formatToParts(0)
  return parts.find((part) => part.type === 'currency')?.value ?? currency.toUpperCase()
}

// ---------------------------------------------------------------------------------------------
// Formatting

/** Whole units, rounded half away from zero in integers: 150 → 2, 149 → 1, −150 → −2. */
function toWholeUnits(cents: Cents): number {
  return Math.sign(cents) * Math.floor((Math.abs(cents) + 50) / 100)
}

/** Intl writes −0 as "-0,00 €"; zero never carries a sign. */
function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value
}

/**
 * Formats cents as currency, e.g. (350, EUR, de-DE) → "3,50 €" (Intl's own spacing: U+00A0 or
 * U+202F, never a plain space). 0-digit currencies always show whole units, rounded half away
 * from zero. With `showCents: false` 2-digit currencies do too, unless that would show a non-zero
 * amount as 0 (49 stays "0,49 €"). `sign: 'always'` adds a plus to positive amounts, never to 0.
 * `compact` abbreviates large amounts ("$1.25K" in en-US) and is meant for chart ticks only.
 */
export function formatMoney(cents: Cents, o: FormatMoneyOptions): string {
  if (o.symbol === false) return formatMoneyParts(cents, o).number
  const { formatter, value } = formatterFor(cents, o)
  return formatter.format(value)
}

/** The cached formatter and the number to give it, following the rules of formatMoney. */
function formatterFor(cents: Cents, o: FormatMoneyOptions): { formatter: Intl.NumberFormat; value: number } {
  const signDisplay = SIGN_DISPLAY[o.sign ?? 'auto']
  const digits = currencyDigits(o.currency)
  const units = toWholeUnits(cents)

  if (o.compact === true) {
    const value = digits === 0 ? units : cents / 100
    return {
      formatter: currencyFormatter(o.locale, o.currency, 'compact', signDisplay),
      value: withoutNegativeZero(value),
    }
  }

  const whole = digits === 0 || (o.showCents === false && (units !== 0 || cents === 0))
  const value = whole ? units : cents / 100
  return {
    formatter: currencyFormatter(o.locale, o.currency, whole ? 0 : 2, signDisplay),
    value: withoutNegativeZero(value),
  }
}

/**
 * Splits a formatted amount into the number and the currency symbol, using the same rules as
 * formatMoney: (23472, EUR, de-DE) → { number: '234,72', symbol: '€', symbolFirst: false };
 * (−350, USD, en-US) → { number: '-3.50', symbol: '$', symbolFirst: true }. The spacing Intl puts
 * between number and symbol is dropped; the layout supplies its own.
 */
export function formatMoneyParts(cents: Cents, o: FormatMoneyOptions): MoneyParts {
  const { formatter, value } = formatterFor(cents, o)
  let number = ''
  let symbol = ''
  let symbolFirst = false
  let seenNumber = false
  for (const part of formatter.formatToParts(value)) {
    if (part.type === 'currency') {
      symbol = part.value
      symbolFirst = !seenNumber
    } else if (part.type === 'literal' && part.value.trim() === '') {
      // Spacing between number and symbol (U+00A0, U+202F or a space); grouping is never a literal.
    } else {
      number += part.value
      if (part.type === 'integer') seenNumber = true
    }
  }
  return { number, symbol, symbolFirst }
}

/**
 * Builds a MoneyFormat for the user's settings; Intl.NumberFormat instances are cached in a module
 * Map, so creating one per settings change is cheap. `format()` shows cents unless the call passes
 * `showCents` (only BigAmount passes the setting), and returns MASKED while masked unless the call
 * passes `unmasked: true`. Throws a RangeError for a malformed currency code or locale.
 */
export function createMoneyFormat(o: MoneyFormatOptions): MoneyFormat {
  const { currency, locale, showCents, masked } = o
  return {
    currency,
    locale,
    showCents,
    masked,
    digits: currencyDigits(currency),
    decimalSeparator: decimalSeparator(locale),
    symbol: currencySymbol(currency, locale),
    format(cents, call) {
      if (masked && call?.unmasked !== true) return MASKED
      return formatMoney(cents, {
        currency,
        locale,
        showCents: call?.showCents,
        sign: call?.sign,
        compact: call?.compact,
        symbol: call?.symbol,
      })
    },
    parts(cents, call) {
      const split = formatMoneyParts(cents, {
        currency,
        locale,
        showCents: call?.showCents,
        sign: call?.sign,
        compact: call?.compact,
      })
      if (masked && call?.unmasked !== true) return { ...split, number: MASKED }
      return split
    },
  }
}

/**
 * Plain decimal string with "." and no grouping, for CSV export: 350 → "3.50", 5 → "0.05".
 * With 0 digits whole units, rounded half away from zero: 350 → "4". Zero never gets a sign.
 */
export function centsToDecimalString(cents: Cents, digits: CurrencyDigits): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  if (digits === 0) {
    const units = Math.floor((abs + 50) / 100)
    return units === 0 ? '0' : `${sign}${units}`
  }
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------------------------
// Parsing

/** Hyphen-minus, minus sign (U+2212) or an opening bracket (accounting negatives). */
const NEGATIVE_MARKS = /[-\u2212(]/u
const WHITESPACE = /\s/gu
const LEADING_SYMBOLS = /^[\p{L}\p{Sc}]+/u
const TRAILING_SYMBOLS = /[\p{L}\p{Sc}]+$/u
const AMOUNT_CHARACTERS = /^[0-9.,'’]+$/
const ANY_DIGIT = /[0-9]/
const PLAIN_INTEGER = /^\d+$/
const GROUPED_INTEGER = /^\d{1,3}([.,'’]\d{3})+$/
const NON_DIGITS = /\D/g

/** How often `char` occurs in `s`. */
function countOf(s: string, char: string): number {
  return s.split(char).length - 1
}

/**
 * The integer part of an amount (step 4 of §4.1 parsing): '' is 0; otherwise plain digits or
 * groups of three separated by one kind of mark ("1.234.567", "1’234"), at most 8 significant
 * digits. Null when it is none of these.
 */
function parseIntegerPart(s: string): number | null {
  if (s === '') return 0
  if (!PLAIN_INTEGER.test(s)) {
    if (!GROUPED_INTEGER.test(s)) return null
    if (new Set(s.replace(/\d/g, '')).size !== 1) return null
  }
  const significant = s.replace(NON_DIGITS, '').replace(/^0+/, '')
  return significant.length > MAX_INTEGER_DIGITS ? null : Number(significant || '0')
}

/**
 * Parses typed or pasted text into cents, or null when it is not a valid non-negative amount
 * (§4.1 parsing rules and test table). Whitespace of any kind and a currency symbol or code on
 * either side are ignored. A "." or "," is read as the decimal separator when it is the locale's
 * own (`decimalSep`), or when it occurs once and is not followed by exactly three digits; any
 * other "." or "," must group thousands. Fractions longer than `digits` are rejected, not rounded.
 */
export function parseAmountInput(input: string, digits: CurrencyDigits, decimalSep: '.' | ','): Cents | null {
  // 1. Negative amounts (minus, U+2212 or accounting brackets) are never valid input.
  if (NEGATIVE_MARKS.test(input)) return null

  // 2. Drop whitespace and one run of letters or currency signs at each end ("CHF", "€", "zł").
  const s = input.replace(WHITESPACE, '').replace(LEADING_SYMBOLS, '').replace(TRAILING_SYMBOLS, '')
  if (!AMOUNT_CHARACTERS.test(s) || !ANY_DIGIT.test(s)) return null

  // 3. Decide whether the last "." or "," is the decimal separator.
  let integer = s
  let fraction = ''
  const k = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
  if (k !== -1) {
    const sep = s.charAt(k)
    const tail = s.slice(k + 1)
    if (sep === decimalSep || (tail.length !== 3 && countOf(s, sep) === 1)) {
      if (tail.length > digits) return null
      integer = s.slice(0, k)
      if (integer.includes(sep)) return null
      fraction = tail
    }
  }

  // 4. and 5. Validate the integer part, then combine it with the fraction padded to cents.
  const units = parseIntegerPart(integer)
  if (units === null) return null
  return units * 100 + Number(fraction.padEnd(2, '0'))
}

// ---------------------------------------------------------------------------------------------
// Keypad

/** A keypad string: integer digits, then optionally "." and the typed fraction digits. */
const KEYPAD_STRING = /^(\d*)(?:\.(\d*))?$/

/**
 * Applies one keypad key to the canonical keypad string ("", "3", "3.", "3.5"), per §4.1: a digit
 * replaces a lone "0" and is otherwise appended while the fraction is shorter than `digits` (after
 * a ".") or the integer part shorter than 8 digits; "." is ignored for 0-digit currencies and when
 * one exists, and turns "" into "0."; "back" drops the last character, and a remaining "0" becomes "".
 */
export function applyKeypadKey(current: string, key: KeypadKey, digits: CurrencyDigits): string {
  if (key === 'back') {
    const shorter = current.slice(0, -1)
    return shorter === '0' ? '' : shorter
  }

  const dot = current.indexOf('.')
  if (key === '.') {
    if (digits === 0 || dot !== -1) return current
    return current === '' ? '0.' : `${current}.`
  }

  if (current === '0') return key
  if (dot !== -1) return current.length - dot - 1 < digits ? current + key : current
  return current.length < MAX_INTEGER_DIGITS ? current + key : current
}

/** Keypad string to cents: "" → 0, "3." → 300, "0.05" → 5, "3.5" → 350. Malformed strings give 0. */
export function keypadStringToCents(s: string): Cents {
  const match = KEYPAD_STRING.exec(s)
  if (match === null) return 0
  const units = Number(match[1] || '0')
  const cents = Number((match[2] ?? '').slice(0, 2).padEnd(2, '0'))
  return units * 100 + cents
}

/**
 * Cents to a keypad string: 0 → "", 300 → "3", 350 → "3.50", 305 → "3.05". With 0 digits whole
 * units, rounded half away from zero. Keypad strings carry no sign; the kind gives the direction.
 * The result always fits the keypad (at most 8 integer digits) and reads back as at most
 * MAX_CENTS: amounts above MAX_CENTS give its string, and with 0 digits the amounts that would
 * round up to 100 000 000 (9 999 999 950 and above) give 99 999 999.
 */
export function centsToKeypadString(cents: Cents, digits: CurrencyDigits): string {
  const abs = Math.min(Math.abs(cents), MAX_CENTS)
  if (digits === 0) {
    // Rounding can carry into a ninth digit, which the keypad cannot hold and no amount field
    // accepts, so the top whole amount stands in for those.
    const units = Math.min(Math.floor((abs + 50) / 100), MAX_WHOLE_UNITS)
    return units === 0 ? '' : String(units)
  }
  const units = Math.floor(abs / 100)
  const fraction = abs % 100
  if (fraction === 0) return units === 0 ? '' : String(units)
  return `${units}.${String(fraction).padStart(2, '0')}`
}

/**
 * Renders a keypad string as typed: the integer part formatted by Intl (grouping and symbol
 * position, no fraction digits), then the locale's separator and exactly the typed fraction.
 * ('1234.5', EUR, de-DE) → "1.234,5 €"; ('3.', USD, en-US) → "$3."; "" renders as 0.
 */
export function formatKeypadString(s: string, o: { currency: string; locale: string }): string {
  const match = KEYPAD_STRING.exec(s)
  const units = Number(match?.[1] || '0')
  const fraction = match?.[2]
  const parts = currencyFormatter(o.locale, o.currency, 0, 'auto').formatToParts(units)
  if (fraction === undefined) return parts.map((part) => part.value).join('')

  const typed = decimalSeparator(o.locale) + fraction
  const lastInteger = parts.findLastIndex((part) => part.type === 'integer')
  return parts.map((part, i) => (i === lastInteger ? part.value + typed : part.value)).join('')
}

// ---------------------------------------------------------------------------------------------
// Arithmetic

/** Integer sum of amounts. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0
  for (const value of values) total += value
  return total
}

/** part / whole, or 0 when whole <= 0 (an empty budget or income has no share). */
export function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}
