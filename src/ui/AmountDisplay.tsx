import type { CSSProperties } from 'react'
import { formatKeypadString, keypadStringToCents, type MoneyFormat } from '@/domain/money'
import styles from '@/ui/AmountDisplay.module.css'
import { useMoneyFormatContext } from '@/ui/MoneyFormatContext'
import { cx, withTrueMinus } from '@/ui/text'

/** The typed amount split for its layout: the number, and the currency symbol before or after it. */
export interface KeypadFigure {
  number: string
  symbol: string
  symbolFirst: boolean
}

/**
 * The keypad string as the locale writes it (formatKeypadString: "1.234,5 €", "$3."), with the
 * symbol set apart for the half-size unit (DESIGN.md §9.16).
 */
export function keypadFigure(keys: string, money: MoneyFormat): KeypadFigure {
  const text = formatKeypadString(keys, { currency: money.currency, locale: money.locale })
  const at = money.symbol === '' ? -1 : text.indexOf(money.symbol)
  if (at < 0) return { number: text.trim(), symbol: '', symbolFirst: false }
  const before = text.slice(0, at).trim()
  const after = text.slice(at + money.symbol.length).trim()
  return before === '' ? { number: after, symbol: money.symbol, symbolFirst: true } : { number: before, symbol: money.symbol, symbolFirst: false }
}

/**
 * About how wide the figure is, in em of the 64px amount: proportional digits of about half an em,
 * separators a quarter, the half-size unit and the caret. Long amounts shrink to fit with it.
 */
function figureWidth({ number, symbol }: KeypadFigure): number {
  let width = 0
  for (const char of number) width += /\d/.test(char) ? 0.54 : 0.27
  return width + symbol.length * 0.33 + 0.35
}

export interface AmountDisplayProps {
  /** The keypad string. */
  keys: string
  /**
   * The split panel has the keypad's place (EXTRAS.md §2.3): the amount is then a button that
   * brings the keypad back, without a caret.
   */
  onEdit?(): void
}

/**
 * The amount being typed in the transaction and wallet entry sheets (docs/SPEC.md §3.4, DESIGN.md
 * §9.16): serif --text-amount with
 * proportional figures, a 2 × 50 --accent-ink caret between the number and the half-size unit
 * in --ink-2. Never masked: it is what you type. A polite live region named "Amount", test id
 * amount-display.
 */
export function AmountDisplay({ keys, onEdit }: AmountDisplayProps) {
  const money = useMoneyFormatContext()
  const figure = keypadFigure(keys, money)
  const fit = { '--figure-em': figureWidth(figure) } as CSSProperties
  const unit = figure.symbol === '' ? null : <span className={styles.unit}>{figure.symbol}</span>
  const content = (
    <span className={styles.fit} style={fit}>
      {figure.symbolFirst && unit}
      <span className={cx(styles.number, keys === '' && styles.zero)}>{withTrueMinus(figure.number)}</span>
      {onEdit === undefined && <span className={styles.caret} aria-hidden="true" />}
      {!figure.symbolFirst && unit}
    </span>
  )

  if (onEdit !== undefined) {
    const whole = money.format(keypadStringToCents(keys), { unmasked: true })
    return (
      <button
        type="button"
        className={cx(styles.figure, styles.button)}
        aria-label={`Amount, ${withTrueMinus(whole)}, the whole bill. Edit amount`}
        data-testid="amount-display"
        onClick={onEdit}
      >
        {content}
      </button>
    )
  }
  return (
    <div className={styles.figure} aria-live="polite" aria-atomic="true" data-testid="amount-display">
      <span className="visually-hidden">Amount </span>
      {content}
    </div>
  )
}
