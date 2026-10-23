import { useId, useRef, useState } from 'react'
import type { SheetProps } from '@/app/nav'
import { withUndo } from '@/app/undo'
import { MAX_LENGTHS } from '@/domain/constants'
import { addDays, compareISO, formatDate, isValidISODate } from '@/domain/dates'
import {
  applyKeypadKey,
  centsToKeypadString,
  keypadStringToCents,
  type KeypadKey,
  type MoneyFormat,
} from '@/domain/money'
import type { Cents, ISODate, WalletEntry } from '@/domain/types'
import styles from '@/features/wallet/WalletEntrySheet.module.css'
import { entryAddedMessage, entryDeletedMessage, moneyText } from '@/features/wallet/walletText'
import { actions } from '@/store/actions'
import { useData, useMoneyFormat, useWallet } from '@/store/hooks'
import { useToday } from '@/store/today'
import { AmountDisplay, Button, Chip, ConsequenceLine, EmptyState, Icon, Keypad, Section, SheetHeader, TextField, toast } from '@/ui'

/**
 * "Add money" / "Take money out" (docs/SPEC.md §3.12, DESIGN.md §9.26 "The wallet entry sheet"):
 * the transaction sheet without categories. The amount on the keypad, "Wallet after: {x}" under
 * it (critical, "short by", below zero; still allowed), a note and a date up to today, and the
 * primary button. Editing an entry is titled "Edit entry", with "Delete" as a header capsule; both
 * changes run through withUndo.
 */

type EntryKind = WalletEntry['kind']

interface EntryForm {
  /** The keypad string ("", "3", "3.5"; docs/SPEC.md §4.1). */
  amount: string
  /** An existing amount the next digit replaces (backspace edits it). */
  pristine: boolean
  note: string
  date: ISODate
}

function formFor(entry: WalletEntry | null, today: ISODate, money: MoneyFormat): EntryForm {
  if (entry === null) return { amount: '', pristine: false, note: '', date: today }
  return { amount: centsToKeypadString(entry.amount, money.digits), pristine: true, note: entry.note, date: entry.date }
}

/** True when `form` would save something else than the sheet opened with. */
function changed(form: EntryForm, initial: EntryForm): boolean {
  return (
    keypadStringToCents(form.amount) !== keypadStringToCents(initial.amount) ||
    form.note.trim() !== initial.note.trim() ||
    form.date !== initial.date
  )
}

function showSaveError(): void {
  toast({ message: "Couldn't save this entry. Check the amount and the date, then try again.", tone: 'critical' })
}

function showDeleteError(): void {
  toast({ message: "Couldn't delete this entry. Open it again from the passbook and try once more.", tone: 'critical' })
}

export function WalletEntrySheet({ route, onClose, setDirty }: SheetProps<'walletEntry'>) {
  const entries = useData((d) => d.wallet.entries)
  const entry = route.id === undefined ? null : (entries.find((item) => item.id === route.id) ?? null)
  // An entry deleted while its sheet is open (an Undo from the toast) leaves nothing to edit.
  if (route.id !== undefined && entry === null) return <MissingEntry onClose={onClose} />
  return <EntryEditor key={entry?.id ?? 'new'} entry={entry} kind={entry?.kind ?? route.kind ?? 'deposit'} onClose={onClose} setDirty={setDirty} />
}

interface EntryEditorProps {
  entry: WalletEntry | null
  kind: EntryKind
  onClose(): void
  setDirty(dirty: boolean): void
}

function EntryEditor({ entry, kind, onClose, setDirty }: EntryEditorProps) {
  const money = useMoneyFormat()
  const wallet = useWallet()
  const locale = useData((d) => d.settings.locale)
  const today = useToday()
  const [initial] = useState(() => formFor(entry, today, money))
  const [form, setForm] = useState(initial)
  const [noteFocused, setNoteFocused] = useState(false)
  const noteRef = useRef<HTMLInputElement>(null)

  const editing = entry !== null
  const cents = keypadStringToCents(form.amount)

  const update = (next: EntryForm) => {
    setForm(next)
    setDirty(changed(next, initial))
  }

  const onKey = (key: KeypadKey) => {
    // An existing amount is replaced by the first digit or separator; backspace edits it.
    const base = form.pristine && key !== 'back' ? '' : form.amount
    update({ ...form, amount: applyKeypadKey(base, key, money.digits), pristine: false })
  }

  // The balance after this entry: an edited entry's old amount comes back out first (when it
  // counted, i.e. it is dated up to today), then the new one goes in. The sheet offers no future dates.
  const counted = entry !== null && compareISO(entry.date, today) <= 0
  const before = wallet.balance - (counted ? signedAmount(entry.kind, entry.amount) : 0)
  const after = before + signedAmount(kind, cents)

  const save = () => {
    if (cents <= 0) return
    const note = form.note.trim()
    const saved =
      entry === null
        ? withUndo(entryAddedMessage(money, kind, cents), () => {
            actions.addWalletEntry({ kind, amount: cents, date: form.date, note })
          })
        : withUndo('Saved', () => actions.updateWalletEntry(entry.id, { amount: cents, date: form.date, note }))
    saved.catch(showSaveError)
    onClose()
  }

  const remove = () => {
    if (entry === null) return
    withUndo(entryDeletedMessage(money, entry, today, locale), () => actions.deleteWalletEntry(entry.id)).catch(showDeleteError)
    onClose()
  }

  const title = editing ? 'Edit entry' : kind === 'deposit' ? 'Add money' : 'Take money out'
  const saveLabel = editing ? 'Save changes' : title
  return (
    <>
      <SheetHeader
        title={title}
        onCancel={onClose}
        action={editing ? { label: 'Delete', tone: 'destructive', onClick: remove, 'data-testid': 'sheet-delete' } : undefined}
      />
      <div className={styles.amount}>
        <AmountDisplay keys={form.amount} />
        <WalletAfter money={money} after={after} visible={cents > 0} />
      </div>
      <Section context="sheet" className={styles.group}>
        <div className={styles.rows}>
          <form
            className={styles.noteForm}
            // A row of the group, so the hairline between Note and Date is drawn (global.css).
            data-row=""
            onSubmit={(event) => {
              // The keyboard's Done ends the note and brings the keypad back.
              event.preventDefault()
              noteRef.current?.blur()
            }}
          >
            <TextField
              label="Note"
              value={form.note}
              onChange={(note) => update({ ...form, note })}
              maxLength={MAX_LENGTHS.note}
              placeholder="Optional"
              enterKeyHint="done"
              inputRef={noteRef}
              onFocus={() => setNoteFocused(true)}
              onBlur={() => setNoteFocused(false)}
              className={styles.note}
              data-testid="wallet-note"
            />
          </form>
          <DateRow date={form.date} today={today} locale={locale} onChange={(date) => update({ ...form, date })} />
        </div>
      </Section>
      {/* The keypad gives way to the keyboard while the note is being typed. */}
      {!noteFocused && (
        <Keypad
          onKey={onKey}
          decimalSeparator={money.digits === 0 ? null : money.decimalSeparator}
          label="Amount keypad"
          className={styles.keypad}
        />
      )}
      <Button size="lg" block disabled={cents <= 0} onClick={save} className={styles.save} data-testid="sheet-save">
        {saveLabel}
      </Button>
    </>
  )
}

function signedAmount(kind: EntryKind, amount: Cents): Cents {
  return kind === 'deposit' ? amount : 0 - amount
}

/** "Wallet after: 531,22 €" (the figure in --ink), or critical "Wallet after: short by 68,78 €". */
function WalletAfter({ money, after, visible }: { money: MoneyFormat; after: Cents; visible: boolean }) {
  const short = after < 0
  // One line, 20 tall in every state (empty until there is an amount), so the sheet never changes
  // height while typing.
  return (
    <ConsequenceLine
      tone={short ? 'critical' : 'default'}
      icon={visible && short ? 'critical' : undefined}
      live
      className={styles.after}
      data-testid="wallet-consequence"
    >
      {visible &&
        (short ? (
          `Wallet after: short by ${moneyText(money, 0 - after)}`
        ) : (
          <>
            Wallet after: <strong>{moneyText(money, after)}</strong>
          </>
        ))}
    </ConsequenceLine>
  )
}

interface DateRowProps {
  date: ISODate
  today: ISODate
  locale: string
  onChange(date: ISODate): void
}

/**
 * "Date" with the chips Today, Yesterday and Other (a calendar glyph; the picked date once chosen).
 * A native date input lies over the third chip, so a tap opens the iOS picker; its max is today,
 * since the wallet has no future entries. An empty or later value is ignored.
 */
function DateRow({ date, today, locale, onChange }: DateRowProps) {
  const labelId = useId()
  const yesterday = addDays(today, -1)
  const other = date !== today && date !== yesterday
  const pick = (value: string) => {
    if (isValidISODate(value) && compareISO(value, today) <= 0) onChange(value)
  }
  return (
    <div className={styles.dateRow} data-row="">
      <span id={labelId} className={styles.dateLabel}>
        Date
      </span>
      <fieldset aria-labelledby={labelId} className={styles.chipSet}>
        <div className={styles.chips}>
          <Chip size="mini" selected={date === today} onClick={() => onChange(today)} className={styles.chip}>
            Today
          </Chip>
          <Chip size="mini" selected={date === yesterday} onClick={() => onChange(yesterday)} className={styles.chip}>
            Yesterday
          </Chip>
          <span className={styles.other}>
            {/* The chip only draws; the input over it takes the tap and the focus. */}
            <span inert aria-hidden="true" className={styles.otherChip}>
              {/* The short date ("12 Sep"): with the weekday the three chips outgrow the row. */}
              <Chip size="mini" selected={other} leading={<Icon name="calendar" size={16} />} className={styles.chip}>
                {other ? formatDate(date, locale, 'short') : 'Other'}
              </Chip>
            </span>
            <input
              type="date"
              className={styles.dateInput}
              value={date}
              max={today}
              aria-label={other ? `Other date, ${formatDate(date, locale, 'long')}` : 'Other date'}
              onChange={(event) => pick(event.currentTarget.value)}
              data-testid="wallet-date"
            />
          </span>
        </div>
      </fieldset>
    </div>
  )
}

/** The edited entry is gone (deleted elsewhere, or an Undo took it back). */
function MissingEntry({ onClose }: { onClose(): void }) {
  return (
    <>
      <SheetHeader title="Edit entry" onCancel={onClose} cancelLabel="Close" />
      <EmptyState
        icon="wallet"
        title="This entry was deleted"
        message="Its money is no longer in your wallet, so there is nothing to edit."
        className={styles.missing}
      />
    </>
  )
}
