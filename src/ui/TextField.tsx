import { useId, useImperativeHandle, useRef, type InputHTMLAttributes, type Ref } from 'react'
import { Icon } from '@/ui/Icon'
import { cx } from '@/ui/text'
import styles from '@/ui/TextField.module.css'
import type { TestIdProps } from '@/ui/types'

export interface TextFieldProps extends TestIdProps {
  label: string
  value: string
  onChange(value: string): void
  /** Default 'text'. */
  type?: 'text' | 'search' | 'date' | 'month'
  min?: string
  max?: string
  placeholder?: string
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']
  enterKeyHint?: InputHTMLAttributes<HTMLInputElement>['enterKeyHint']
  /** iOS keyboard capitalisation, e.g. 'none' for "Type erase to confirm". Browser default when omitted. */
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  /** iOS autocorrection. Browser default when omitted. */
  autoCorrect?: 'on' | 'off'
  maxLength?: number
  /** Shown under the field in Footnote --critical-ink; the field is then marked invalid. */
  error?: string
  /** Keeps the label for assistive technology only. */
  hideLabel?: boolean
  /** Input id; generated when omitted. */
  id?: string
  onFocus?(): void
  onBlur?(): void
  /**
   * docs/DESIGN.md §9.14. 'row' (default): a labelled row in a group, the label in a 48px column
   * (--ink-2) then the input (Note, Name, From). 'form': the label in --ink at the start and the
   * input right-aligned, like a settings value. 'search' (the default for type search): a 44pt
   * capsule on --surface-2 with a magnifier; its label is for assistive technology only.
   */
  variant?: 'row' | 'form' | 'search'
  /** Accessible name of the clear button. Default "Clear {label}" in lower case ("Clear note"). */
  clearLabel?: string
  autoComplete?: string
  disabled?: boolean
  inputRef?: Ref<HTMLInputElement>
  className?: string
}

/**
 * A labelled text input, 16px or larger so iOS never zooms. Text and search fields get a clear
 * button (x-circle fill 19 in --ink-3, a 44pt target): a search field while it holds text, a row
 * or form field only while it is being edited and holds text (iOS "while editing"). A label that
 * wraps keeps 11 above and below it; a single-line row stays --form-row-min tall.
 */
export function TextField({
  label,
  value,
  onChange,
  type = 'text',
  min,
  max,
  placeholder,
  inputMode,
  enterKeyHint,
  autoCapitalize,
  autoCorrect,
  maxLength,
  error,
  hideLabel = false,
  id,
  onFocus,
  onBlur,
  variant,
  clearLabel,
  autoComplete = 'off',
  disabled = false,
  inputRef,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: TextFieldProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const errorId = `${inputId}-error`
  const kind = variant ?? (type === 'search' ? 'search' : 'row')
  const ownRef = useRef<HTMLInputElement>(null)
  const clearable = (type === 'text' || type === 'search') && value !== '' && !disabled
  // Hand the input to the caller's ref as well; the field keeps its own to refocus after clearing.
  useImperativeHandle(inputRef, () => ownRef.current as HTMLInputElement, [])

  const clear = () => {
    onChange('')
    ownRef.current?.focus()
  }

  return (
    <div
      className={cx(styles.field, styles[kind], disabled && styles.disabled, className)}
      data-row={kind === 'search' ? undefined : ''}
    >
      <div className={styles.line}>
        {kind === 'search' && <Icon name="search" size={17} className={styles.searchIcon} />}
        <label
          htmlFor={inputId}
          className={cx(styles.label, (hideLabel || kind === 'search') && 'visually-hidden')}
        >
          {label}
        </label>
        <input
          ref={ownRef}
          id={inputId}
          type={type}
          value={value}
          min={min}
          max={max}
          placeholder={placeholder}
          inputMode={inputMode}
          enterKeyHint={enterKeyHint}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          maxLength={maxLength}
          autoComplete={autoComplete}
          spellCheck={type === 'text' ? undefined : false}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={styles.input}
          onChange={(event) => onChange(event.currentTarget.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          data-testid={testId}
          data-id={dataId}
        />
        {clearable && (
          <button
            type="button"
            className={styles.clear}
            aria-label={clearLabel ?? `Clear ${label.toLocaleLowerCase()}`}
            // Keep the keyboard up: the field stays focused while it is cleared.
            onMouseDown={(event) => event.preventDefault()}
            onClick={clear}
          >
            <Icon name="clear" size={19} />
          </button>
        )}
      </div>
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
