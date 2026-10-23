import { useId } from 'react'
import styles from '@/ui/EmojiPicker.module.css'
import picker from '@/ui/Picker.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface EmojiPickerProps extends TestIdProps {
  /** The chosen emoji, or '' for none. */
  value: string
  onChange(value: string): void
  choices: string[]
  /** Adds a first option that clears the choice (e.g. "Use my initial"). */
  allowEmpty?: { label: string }
  /** Accessible name of the group. Default "Emoji". */
  label?: string
  className?: string
}

/** Picks one emoji (the avatar, or a category symbol). Built on native radio buttons. */
export function EmojiPicker({
  value,
  onChange,
  choices,
  allowEmpty,
  label = 'Emoji',
  className,
  'data-testid': testId,
  'data-id': dataId,
}: EmojiPickerProps) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} className={cx(styles.picker, className)} data-testid={testId} data-id={dataId}>
      {allowEmpty && (
        <label className={cx(picker.pill, styles.empty, value === '' && picker.selected)}>
          <input
            type="radio"
            name={name}
            className={picker.input}
            checked={value === ''}
            onChange={() => onChange('')}
          />
          {allowEmpty.label}
        </label>
      )}
      <div className={picker.grid}>
        {choices.map((emoji) => (
          <label key={emoji} className={cx(picker.cell, picker.emoji, emoji === value && picker.selected)}>
            <input
              type="radio"
              name={name}
              className={picker.input}
              checked={emoji === value}
              onChange={() => onChange(emoji)}
            />
            {emoji}
          </label>
        ))}
      </div>
    </div>
  )
}
