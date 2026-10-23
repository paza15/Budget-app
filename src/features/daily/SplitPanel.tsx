import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { personSuggestions } from '@/domain/splits'
import type { AppData, Cents } from '@/domain/types'
import { personKey, type SplitRow } from '@/features/daily/transactionForm'
import { AmountField, Chip, Coin, firstGrapheme, Icon, IconButton, Money } from '@/ui'
import styles from './SplitPanel.module.css'

export interface SplitPanelProps {
  /** For the Split capsule's aria-controls. */
  id: string
  rows: readonly SplitRow[]
  /** For the names of earlier splits. */
  data: AppData
  /** Adds a person under `key` (named for a suggestion chip, else empty). */
  onAdd(key: string, person: string): void
  onName(key: string, person: string): void
  /** A suggestion chip completes the name being typed. */
  onComplete(key: string, person: string): void
  /** The name field was left: a blank row goes, a name already in the split merges. */
  onNameDone(key: string): void
  onAmount(key: string, amount: Cents | null): void
  onRemove(key: string): void
  onEven(): void
  /** Makes the key for onAdd. */
  newKey(): string
}

/** At most this many suggestion chips sit beside "Add person" (EXTRAS.md §2.3: one or two). */
const MAX_CHIPS = 2
/** Two chips share the row only while both names together are this short; else one shows. */
const TWO_CHIPS_MAX_LENGTH = 14

/** The coin's letter: the first character of the name, upper case. */
function initialOf(person: string): string {
  return firstGrapheme(person.trim()).toLocaleUpperCase()
}

/** "Done" on an amount closes the keyboard. */
function amountKeys(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.target.blur()
}

/** Keeps focus where it is while a chip is pressed, so the name being typed is the one completed. */
function keepFocus(event: MouseEvent<HTMLSpanElement>): void {
  event.preventDefault()
}

/** Toggles the "more below" fade; an attribute, so scrolling never re-renders the panel. */
function updateMore(panel: HTMLElement): void {
  panel.toggleAttribute('data-more', panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1)
}

/**
 * The split editor (docs/SPEC.md §3.16, docs/design/EXTRAS.md §2.3, §2.4) in the keypad's place:
 * "Who owes you" with "Split evenly", one row per person (their coin, their name and what they owe,
 * and a remove button) and "Add person" with chips of names from earlier splits. It is never
 * taller than the keypad: more people scroll inside it under its pinned title row. Settled splits
 * (paid back, forgiven) are listed as they are; the Owed screen manages them.
 */
export function SplitPanel({
  id,
  rows,
  data,
  onAdd,
  onName,
  onComplete,
  onNameDone,
  onAmount,
  onRemove,
  onEven,
  newKey,
}: SplitPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const names = useRef(new Map<string, HTMLInputElement>())
  /** The row whose name field has focus: the chips filter by what it holds and complete it. */
  const [editing, setEditing] = useState<string | null>(null)

  const editingRow = rows.find((row) => row.key === editing && row.status === 'open')
  const taken = new Set(rows.map((row) => personKey(row.person)))
  const suggestions = personSuggestions(data, editingRow?.person ?? '')
    .filter((person) => !taken.has(personKey(person)))
    .slice(0, MAX_CHIPS)
  const chips = suggestions.join('').length > TWO_CHIPS_MAX_LENGTH ? suggestions.slice(0, 1) : suggestions
  const hasOpen = rows.some((row) => row.status === 'open')

  // The fade at the bottom edge shows only while more rows wait below: on scrolling, and when the
  // panel or its rows change size.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (panel === null) return undefined
    updateMore(panel)
    const onChange = () => updateMore(panel)
    panel.addEventListener('scroll', onChange, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onChange)
    observer?.observe(panel)
    if (panel.firstElementChild !== null) observer?.observe(panel.firstElementChild)
    return () => {
      panel.removeEventListener('scroll', onChange)
      observer?.disconnect()
    }
  }, [])

  const amountId = (key: string) => `${id}-owes-${key}`

  const add = (person: string) => {
    const key = newKey()
    // Rendered at once, so the new name field takes focus inside the tap and the keyboard comes up.
    flushSync(() => onAdd(key, person))
    if (person === '') names.current.get(key)?.focus()
  }

  const pick = (person: string) => {
    if (editingRow === undefined) {
      add(person)
      return
    }
    onComplete(editingRow.key, person)
    names.current.get(editingRow.key)?.blur()
  }

  const leaveName = (event: FocusEvent<HTMLInputElement>, key: string) => {
    setEditing((current) => (current === key ? null : current))
    // "Next" moves on to the same person's amount and keeps the row as it is.
    const next = event.relatedTarget
    if (next instanceof HTMLElement && next.id === amountId(key)) return
    onNameDone(key)
  }

  const nameKeys = (event: KeyboardEvent<HTMLInputElement>, key: string) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    document.getElementById(amountId(key))?.focus()
  }

  return (
    <div ref={panelRef} id={id} className={styles.panel} data-testid="split-panel">
      <fieldset className={styles.fields} aria-labelledby={`${id}-title`}>
        <div className={styles.head}>
          <span id={`${id}-title`} className={styles.title}>
            Who owes you
          </span>
          <button type="button" className={styles.even} onClick={onEven} disabled={!hasOpen} data-testid="split-evenly">
            Split evenly
          </button>
        </div>
        <div className={styles.people}>
          {rows.map((row) => {
            const name = row.person.trim()
            const initial = initialOf(row.person)
            const settled = row.status !== 'open'
            return (
              <div key={row.key} className={styles.person} data-testid="split-person" data-id={row.key}>
                <Coin size="sm">
                  {initial === '' ? <Icon name="person" weight="light" size={16} /> : <span className={styles.initial}>{initial}</span>}
                </Coin>
                {settled ? (
                  <span className={styles.settled}>
                    <span className={styles.settledName}>{name}</span>
                    <span className={styles.status}>{row.status === 'paid' ? 'Paid back' : 'Forgiven'}</span>
                  </span>
                ) : (
                  <input
                    ref={(input) => {
                      if (input === null) return undefined
                      names.current.set(row.key, input)
                      return () => {
                        names.current.delete(row.key)
                      }
                    }}
                    type="text"
                    className={styles.name}
                    value={row.person}
                    placeholder="Name"
                    aria-label="Name"
                    maxLength={24}
                    enterKeyHint="next"
                    autoComplete="off"
                    autoCapitalize="words"
                    spellCheck={false}
                    onChange={(event) => onName(row.key, event.currentTarget.value)}
                    onFocus={() => setEditing(row.key)}
                    onBlur={(event) => leaveName(event, row.key)}
                    onKeyDown={(event) => nameKeys(event, row.key)}
                  />
                )}
                {settled ? (
                  <Money cents={row.amount ?? 0} tone="muted" className={styles.settledAmount} />
                ) : (
                  // "Done" in the amount field below closes the keyboard.
                  // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
                  <div className={styles.amount} onKeyDown={amountKeys}>
                    <AmountField
                      variant="cell"
                      id={amountId(row.key)}
                      label={`${name === '' ? 'This person' : name} owes`}
                      hideLabel
                      placeholder="Amount"
                      value={row.amount}
                      onChange={(amount) => onAmount(row.key, amount)}
                    />
                  </div>
                )}
                {settled ? (
                  <span aria-hidden="true" />
                ) : (
                  <IconButton
                    icon="clear"
                    weight="fill"
                    iconSize={19}
                    label={name === '' ? 'Remove this person' : `Remove ${name}`}
                    className={styles.remove}
                    onClick={() => onRemove(row.key)}
                  />
                )}
              </div>
            )
          })}
          <div className={styles.addRow}>
            <button type="button" className={styles.add} onClick={() => add('')} data-testid="split-add">
              <span className={styles.addGlyph}>
                <Icon name="plus-circle" size={22} />
              </span>
              <span className={styles.addLabel}>Add person</span>
            </button>
            {chips.length > 0 && (
              <span className={styles.suggestions}>
                {chips.map((person) => (
                  // A pressed chip leaves focus in the name being typed, which it completes.
                  // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
                  <span key={person} className={styles.suggestion} onMouseDown={keepFocus}>
                    <Chip size="mini" label={`Add ${person}`} onClick={() => pick(person)}>
                      {person}
                    </Chip>
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>
      </fieldset>
    </div>
  )
}
