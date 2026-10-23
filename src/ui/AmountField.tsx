import { useId, useState, type CSSProperties, type FocusEvent, type Ref } from 'react'
import { centsToDecimalString, parseAmountInput, type MoneyFormat } from '@/domain/money'
import type { Cents } from '@/domain/types'
import styles from '@/ui/AmountField.module.css'
import { useMoneyFormatContext } from '@/ui/MoneyFormatContext'
import { cx, withTrueMinus } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface AmountFieldProps extends TestIdProps {
  label: string
  /** null: empty. */
  value: Cents | null
  /** Called with the parsed amount as it is typed, or null when the field is cleared. */
  onChange(value: Cents | null): void
  /** Default: zero in the user's format ("0,00 €"). */
  placeholder?: string
  /** A message from the form (e.g. the amount must be more than 0), shown under the row. */
  error?: string
  disabled?: boolean
  /** Keeps the label for assistive technology only. */
  hideLabel?: boolean
  id?: string
  /** The input element, e.g. to focus a field that has just been revealed. */
  inputRef?: Ref<HTMLInputElement>
  /**
   * 'row' (default): a form row in a group, with the row padding, --form-row-min and the hairline
   * (data-row). 'cell': just the label and input, filling the grid cell it sits in (the split
   * editor's amount column); the feature lays out the row and places the message, which it finds
   * by data-part="error" (the label and input are in data-part="line").
   */
  variant?: 'row' | 'cell'
  className?: string
}

/** Separators and spaces are about half a figure wide; figures, signs and letters about one. */
const NARROW = new Set([',', '.', "'", ' ', '\u00a0', '\u202f', '\u2009'])

/** About how wide `text` is, in ch (the width of a figure), so the input can be just that wide. */
export function amountWidthCh(text: string): number {
  let width = 0
  for (const char of text) width += NARROW.has(char) ? 0.5 : 1
  return Math.max(width, 1)
}

/** Whether a placeholder is words ("None", "Amount") rather than a figure ("0,00 €"). */
function isTextPlaceholder(placeholder: string): boolean {
  return !/\d/.test(placeholder)
}

/** The amount as typed while editing: no grouping, no symbol, the locale's decimal separator ("1234,56"). */
export function plainAmount(cents: Cents, money: MoneyFormat): string {
  return centsToDecimalString(cents, money.digits).replace('.', money.decimalSeparator)
}

/**
 * An amount typed with the system keyboard, in a form row (docs/DESIGN.md §9.14): right-aligned
 * serif figures. While focused it shows the plain number ("13,99", never masked); on blur the
 * formatted amount ("13,99 €", or "•••" while amounts are hidden). It parses as you type with
 * parseAmountInput, so the form always holds Cents. Text that is not an amount stays in the field
 * with an error under the row. The input is as wide as its text (or placeholder), so the label
 * keeps the rest of the row; a label that wraps keeps 11 above and below it. A placeholder in
 * words is set in the UI font: only figures are serif (DESIGN.md §5.2).
 */
export function AmountField({
  label,
  value,
  onChange,
  placeholder,
  error,
  disabled = false,
  hideLabel = false,
  id,
  inputRef,
  variant = 'row',
  className,
  'data-testid': testId,
  'data-id': dataId,
}: AmountFieldProps) {
  const money = useMoneyFormatContext()
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = `${inputId}-message`
  // The text being edited; null while the field shows the formatted value.
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)

  const parse = (text: string): Cents | null => parseAmountInput(text, money.digits, money.decimalSeparator)
  const example = withTrueMinus(money.format(money.digits === 0 ? 139900 : 1399, { symbol: false, unmasked: true }))
  const message = invalid ? `That isn't an amount. Type it like ${example}.` : error
  const shown = draft ?? (value === null ? '' : withTrueMinus(money.format(value)))
  const hint = placeholder ?? withTrueMinus(money.format(0, { unmasked: true }))
  // The input's width in characters: what it shows, or the placeholder while it is empty.
  const width = { '--chars': amountWidthCh(shown === '' ? hint : shown) } as CSSProperties

  const onFocus = (event: FocusEvent<HTMLInputElement>) => {
    // A draft survives a blur only when it is not an amount; keep it, and the caret, as they are.
    if (draft !== null) return
    const plain = value === null ? '' : plainAmount(value, money)
    setDraft(plain)
    if (plain === '') return
    // Select once React has put the plain value in, so typing replaces it, but never over what
    // was typed in the meantime.
    const input = event.currentTarget
    requestAnimationFrame(() => {
      if (document.activeElement === input && input.value === plain) input.select()
    })
  }

  const onBlur = () => {
    if (draft === null) return
    if (draft.trim() === '' || parse(draft) !== null) {
      setDraft(null)
      setInvalid(false)
    } else {
      setInvalid(true)
    }
  }

  const onInput = (text: string) => {
    setDraft(text)
    setInvalid(false)
    if (text.trim() === '') {
      onChange(null)
      return
    }
    const cents = parse(text)
    if (cents !== null) onChange(cents)
  }

  return (
    <div
      className={cx(styles.field, styles[variant], disabled && styles.disabled, className)}
      data-row={variant === 'row' ? '' : undefined}
    >
      <div className={styles.line} data-part="line">
        <label htmlFor={inputId} className={cx(styles.label, hideLabel && 'visually-hidden')}>
          {label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={hint}
          data-placeholder={isTextPlaceholder(hint) ? 'text' : undefined}
          value={shown}
          style={width}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={styles.input}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => onInput(event.currentTarget.value)}
          data-testid={testId}
          data-id={dataId}
        />
      </div>
      {message && (
        <p id={messageId} className={styles.error} data-part="error">
          {message}
        </p>
      )}
    </div>
  )
}
