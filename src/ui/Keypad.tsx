import type { PointerEvent, ReactNode } from 'react'
import type { KeypadKey } from '@/domain/money'
import { Icon } from '@/ui/Icon'
import styles from '@/ui/Keypad.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface KeypadProps extends TestIdProps {
  onKey(key: KeypadKey): void
  /** The locale's separator for the decimal key; null hides it (0-digit currencies). */
  decimalSeparator: '.' | ',' | null
  /** 'pin' has no decimal key; its bottom-left cell shows `leftKey`. Default 'amount'. */
  variant?: 'amount' | 'pin'
  /** Bottom-left cell of the pin variant, e.g. the Face ID button. */
  leftKey?: ReactNode
  /** Accessible name of the keypad. Default "Keypad". */
  label?: string
  /** Turns every key off, e.g. during a PIN lockout. */
  disabled?: boolean
  className?: string
}

type Digit = Exclude<KeypadKey, '.' | 'back'>

const DIGIT_ROWS: readonly (readonly Digit[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
]

// Press feedback that shows at once on touch: iOS can hold :active back while it waits to see
// whether a touch becomes a scroll. :active still covers keyboard presses.
function press(event: PointerEvent<HTMLButtonElement>): void {
  event.currentTarget.dataset.pressed = ''
}

function unpress(event: PointerEvent<HTMLButtonElement>): void {
  delete event.currentTarget.dataset.pressed
}

const pressHandlers = {
  onPointerDown: press,
  onPointerUp: unpress,
  onPointerLeave: unpress,
  onPointerCancel: unpress,
}

/**
 * Four rows of keys: 1–9, then the decimal key (or `leftKey`), 0 and backspace (docs/DESIGN.md
 * §9.15). 'amount' is the light hairline keypad of the transaction sheet; 'pin' the engraved
 * coins of the lock screen. Test ids keypad-0…9, keypad-dec and keypad-back.
 */
export function Keypad({
  onKey,
  decimalSeparator,
  variant = 'amount',
  leftKey,
  label = 'Keypad',
  disabled = false,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: KeypadProps) {
  const showDecimal = variant === 'amount' && decimalSeparator !== null
  const digitKey = (digit: Digit) => (
    <button
      key={digit}
      type="button"
      className={styles.key}
      aria-label={`Digit ${digit}`}
      data-testid={`keypad-${digit}`}
      disabled={disabled}
      onClick={() => onKey(digit)}
      {...pressHandlers}
    >
      {digit}
    </button>
  )
  return (
    <fieldset
      aria-label={label}
      className={cx(styles.keypad, variant === 'pin' ? styles.pin : styles.amount, className)}
      data-variant={variant}
      data-testid={testId}
      data-id={dataId}
    >
      {DIGIT_ROWS.map((row) => (
        <div key={row[0]} className={styles.row}>
          {row.map(digitKey)}
        </div>
      ))}
      <div className={styles.row}>
        {showDecimal ? (
          <button
            type="button"
            className={styles.key}
            aria-label="Decimal separator"
            data-testid="keypad-dec"
            disabled={disabled}
            onClick={() => onKey('.')}
            {...pressHandlers}
          >
            <span className={styles.separator}>{decimalSeparator}</span>
          </button>
        ) : (
          <div className={styles.slot}>{leftKey}</div>
        )}
        {digitKey('0')}
        <button
          type="button"
          className={cx(styles.key, styles.bare)}
          aria-label="Delete"
          data-testid="keypad-back"
          disabled={disabled}
          onClick={() => onKey('back')}
          {...pressHandlers}
        >
          <Icon name="backspace" weight="light" size={variant === 'pin' ? 30 : 26} />
        </button>
      </div>
    </fieldset>
  )
}
