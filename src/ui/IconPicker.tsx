import { useId, useMemo, useState } from 'react'
import type { CategoryIconOption } from '@/domain/catalog'
import type { IconRef } from '@/domain/types'
import { CategoryIcon, isEmojiIcon } from '@/ui/CategoryIcon'
import { EmojiPicker } from '@/ui/EmojiPicker'
import styles from '@/ui/IconPicker.module.css'
import picker from '@/ui/Picker.module.css'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { cx, emojiFromInput, firstGrapheme } from '@/ui/text'
import { TextField } from '@/ui/TextField'
import type { TestIdProps } from '@/ui/types'

export interface IconPickerProps extends TestIdProps {
  value: IconRef
  onChange(value: IconRef): void
  /** Phosphor icons on the Icons tab, in picker order, grouped by `group`. */
  icons: CategoryIconOption[]
  /** Emoji on the Emoji tab, which also accepts one typed emoji (letters and digits rejected). */
  emojis: string[]
  className?: string
}

type Tab = 'icons' | 'emoji'

const TABS: { value: Tab; label: string }[] = [
  { value: 'icons', label: 'Icons' },
  { value: 'emoji', label: 'Emoji' },
]

/** True when a search matches the icon's name, keywords, key or group. */
function matches(option: CategoryIconOption, query: string): boolean {
  if (query === '') return true
  return (
    option.name.toLocaleLowerCase().includes(query) ||
    option.key.includes(query) ||
    option.group.toLocaleLowerCase().includes(query) ||
    option.keywords.some((keyword) => keyword.toLocaleLowerCase().includes(query))
  )
}

/**
 * The emoji the field holds after `text` was typed into a field showing `shown`: the first
 * grapheme of the input (Intl.Segmenter), or null when that is not an emoji (letters and digits are
 * rejected). Typing after the emoji already there replaces it, unless the new character joins it
 * into one grapheme (a skin tone added to 👍 makes 👍🏽).
 */
export function typedEmoji(text: string, shown: string): string | null {
  const replaces = shown !== '' && text.startsWith(shown) && firstGrapheme(text) === shown
  return emojiFromInput(replaces ? text.slice(shown.length) : text)
}

/**
 * Picks a category or quick-add symbol (docs/SPEC.md §5.8): tabs "Icons" (the CATEGORY_ICONS glyphs
 * in light, grouped, with a search over names and keywords) and "Emoji" (the choices, plus a field
 * that keeps the first grapheme typed or pasted and rejects letters and digits). Built on native
 * radios, so arrow keys move the choice.
 */
export function IconPicker({
  value,
  onChange,
  icons,
  emojis,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: IconPickerProps) {
  const name = useId()
  const [tab, setTab] = useState<Tab>(() => (isEmojiIcon(value) ? 'emoji' : 'icons'))
  const [query, setQuery] = useState('')
  // The field's text, tied to the value it was typed against: once the value changes elsewhere
  // (a tap in a grid) the draft no longer applies and the field shows the value again.
  const [draft, setDraft] = useState<{ text: string; value: IconRef } | null>(null)
  const [rejected, setRejected] = useState(false)

  const custom = isEmojiIcon(value) && !emojis.includes(value) ? value : ''
  const field = draft !== null && draft.value === value ? draft.text : custom

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const byGroup = new Map<string, CategoryIconOption[]>()
    for (const option of icons) {
      if (!matches(option, needle)) continue
      const list = byGroup.get(option.group)
      if (list) list.push(option)
      else byGroup.set(option.group, [option])
    }
    return [...byGroup]
  }, [icons, query])
  const noMatch = `No icon matches “${query.trim()}”. Try another word.`

  const onType = (text: string) => {
    if (text === '') {
      setDraft({ text: '', value })
      setRejected(false)
      return
    }
    const emoji = typedEmoji(text, field)
    if (emoji === null) {
      // The field keeps what it had; the message says why.
      setRejected(true)
      return
    }
    setDraft({ text: emoji, value: emoji })
    setRejected(false)
    if (emoji !== value) onChange(emoji)
  }

  const onTab = (next: Tab) => {
    setTab(next)
    setRejected(false)
  }

  return (
    <div className={cx(styles.picker, className)} data-testid={testId} data-id={dataId}>
      <SegmentedControl options={TABS} value={tab} onChange={onTab} label="Symbol type" />
      {tab === 'icons' ? (
        <div className={styles.panel}>
          <TextField
            type="search"
            label="Search icons"
            placeholder="Search"
            value={query}
            onChange={setQuery}
            enterKeyHint="search"
          />
          <div role="radiogroup" aria-label="Icon" className={styles.groups}>
            {groups.map(([group, options]) => (
              <fieldset key={group} className={styles.group}>
                <legend className={styles.groupTitle}>{group}</legend>
                <div className={picker.grid}>
                  {options.map((option) => (
                    <label key={option.key} className={cx(picker.cell, option.key === value && picker.selected)}>
                      <input
                        type="radio"
                        name={name}
                        className={picker.input}
                        aria-label={option.name}
                        checked={option.key === value}
                        onChange={() => onChange(option.key)}
                      />
                      <CategoryIcon icon={option.key} size={26} />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          {groups.length === 0 && (
            <p className={styles.none} aria-hidden="true">
              {noMatch}
            </p>
          )}
          {/* Always present, so the empty result is announced while typing. */}
          <output className="visually-hidden">{groups.length === 0 ? noMatch : ''}</output>
        </div>
      ) : (
        <div className={styles.panel}>
          <div className={styles.typed}>
            <TextField
              label="Emoji"
              placeholder="Type or paste one"
              value={field}
              onChange={onType}
              enterKeyHint="done"
              clearLabel="Clear emoji"
              error={rejected ? 'Only an emoji works here, not letters or numbers.' : undefined}
            />
          </div>
          <EmojiPicker
            value={isEmojiIcon(value) ? value : ''}
            onChange={onChange}
            choices={emojis}
            label="Suggested emoji"
          />
        </div>
      )}
    </div>
  )
}
