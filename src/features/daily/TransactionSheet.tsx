import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useNav, type SheetProps } from '@/app/nav'
import { withUndo } from '@/app/undo'
import { MAX_LENGTHS } from '@/domain/constants'
import { addDays, formatDate, isValidISODate } from '@/domain/dates'
import { frequentEntries, type FrequentEntry } from '@/domain/insights'
import type { CurrencyDigits, KeypadKey, MoneyFormat } from '@/domain/money'
import { formatPeriodTitle, periodOf } from '@/domain/period'
import { categoryDisplay } from '@/domain/queries'
import { budgetAmount, myShare } from '@/domain/splits'
import type { AppData, Cents, ISODate, Transaction, TxKind } from '@/domain/types'
import { cx } from '@/features/daily/cx'
import { shownAmount, spokenAmount } from '@/features/daily/format'
import { addedMessage } from '@/features/daily/quickAdd'
import { SplitPanel } from '@/features/daily/SplitPanel'
import {
  ALL_CATEGORIES,
  addPerson,
  applySuggestion,
  categoryChoices,
  clearDraft,
  completePerson,
  draftRouteOf,
  draftTransaction,
  editForm,
  formAmount,
  hasChanges,
  newForm,
  newRowKey,
  pressKey,
  readDraft,
  removePerson,
  setPersonAmount,
  setPersonName,
  splitEvenly,
  splitsFit,
  splitsToSave,
  tidyPerson,
  walletAfter,
  writeDraft,
  type TxForm,
} from '@/features/daily/transactionForm'
import { actions } from '@/store/actions'
import { useCategoryMap, useData, useMonthSummary, useSettings } from '@/store/hooks'
import { useToday } from '@/store/today'
import {
  AmountDisplay,
  Button,
  Chip,
  ChipTabs,
  ConsequenceLine,
  EmptyState,
  Icon,
  Keypad,
  SheetHeader,
  TextField,
  toast,
  Toggle,
  useMoneyFormatContext,
} from '@/ui'
import styles from './TransactionSheet.module.css'

type Route = SheetProps<'transaction'>['route']

/** What the sheet opened with: the entry being edited, and the form before and after any draft. */
interface Opened {
  kind: TxKind
  /** The stored transaction when editing. */
  original: Transaction | null
  /** Editing an entry that no longer exists (deleted meanwhile). */
  missing: boolean
  /** The form as it opened, without a draft: what "unsaved changes" compares against. */
  initial: TxForm
  /** The form to start from: a draft of this new item when one was kept (§5.10), else `initial`. */
  start: TxForm
}

function openForm(data: AppData, route: Route, today: ISODate, digits: CurrencyDigits): Opened {
  if (route.id !== undefined) {
    const original = data.transactions.find((tx) => tx.id === route.id) ?? null
    if (original === null) {
      const blank = newForm(data, route.kind ?? 'expense', undefined, today)
      return { kind: route.kind ?? 'expense', original: null, missing: true, initial: blank, start: blank }
    }
    const form = editForm(original, digits)
    return { kind: original.kind, original, missing: false, initial: form, start: form }
  }
  const kind = route.kind ?? 'expense'
  const initial = newForm(data, kind, route.categoryId, today)
  const draftRoute = draftRouteOf(route)
  const draft = draftRoute === null ? null : readDraft(draftRoute, digits)
  return { kind, original: null, missing: false, initial, start: draft ?? initial }
}

function titleOf(kind: TxKind, editing: boolean): string {
  if (kind === 'income') return editing ? 'Edit income' : 'One-off income'
  return editing ? 'Edit expense' : 'New expense'
}

/** One line under the amount (DESIGN.md §9.16, §9.26; EXTRAS.md §2.2). */
interface Line {
  key: string
  tone: 'default' | 'warning' | 'critical'
  content: ReactNode
  testId?: string
}

/** "Leaves 4,84 € for today", "2,66 € over today's budget" or "41,28 € over this month's budget". */
function budgetLine(spend: Cents, todayLeft: Cents, left: Cents, money: MoneyFormat): Line {
  if (spend > left) {
    return { key: 'budget', tone: 'critical', content: `${shownAmount(money, spend - left)} over this month's budget` }
  }
  if (spend > todayLeft) {
    return { key: 'budget', tone: 'warning', content: `${shownAmount(money, spend - todayLeft)} over today's budget` }
  }
  return {
    key: 'budget',
    tone: 'default',
    content: (
      <>
        Leaves <strong>{shownAmount(money, todayLeft - spend)}</strong> for today
      </>
    ),
  }
}

/** "Wallet after: 82,22 €", or "Wallet after: short by 67,78 €" below zero (still allowed). */
function walletLine(after: Cents, money: MoneyFormat): Line {
  if (after < 0) {
    return { key: 'wallet', tone: 'critical', content: `Wallet after: short by ${shownAmount(money, -after)}`, testId: 'wallet-consequence' }
  }
  return {
    key: 'wallet',
    tone: 'default',
    content: (
      <>
        Wallet after: <strong>{shownAmount(money, after)}</strong>
      </>
    ),
    testId: 'wallet-consequence',
  }
}

function ConsequenceLines({ lines }: { lines: readonly Line[] }) {
  return (
    <div className={styles.lines} aria-live="polite">
      {lines.map((line) => (
        <ConsequenceLine
          key={line.key}
          tone={line.tone}
          icon={line.tone === 'default' ? undefined : line.tone}
          className={styles.line}
          data-testid={line.testId}
        >
          {line.content}
        </ConsequenceLine>
      ))}
    </div>
  )
}

interface DateRowProps {
  date: ISODate
  today: ISODate
  locale: string
  onChange(date: ISODate): void
}

/**
 * "Date" with the mini chips "Today", "Yesterday" and "Other" (§3.4, DESIGN.md §9.16). A native date
 * input lies over the third chip, invisible, so a tap opens the iOS date picker; the chip then
 * shows the picked date ("Wed 14 Oct"). An empty value (the picker's Reset) is ignored.
 */
function DateRow({ date, today, locale, onChange }: DateRowProps) {
  const labelId = useId()
  const pointer = useRef('')
  const yesterday = addDays(today, -1)
  const other = date !== today && date !== yesterday
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value
    if (isValidISODate(value)) onChange(value)
  }
  // A mouse may need the picker opened for it; a tap on iOS opens it by itself.
  const remember = (event: PointerEvent<HTMLInputElement>) => {
    pointer.current = event.pointerType
  }
  const openPicker = (event: MouseEvent<HTMLInputElement>) => {
    if (pointer.current !== 'mouse') return
    try {
      event.currentTarget.showPicker()
    } catch {
      // Not allowed here: the input still takes typing.
    }
  }
  return (
    <div className={styles.dateRow} data-row="">
      <span id={labelId} className={styles.rowLabel}>
        Date
      </span>
      <fieldset className={styles.dateChips} aria-labelledby={labelId}>
        <Chip size="mini" selected={date === today} onClick={() => onChange(today)}>
          Today
        </Chip>
        <Chip size="mini" selected={date === yesterday} onClick={() => onChange(yesterday)}>
          Yesterday
        </Chip>
        <span className={styles.other}>
          {/* The look of the chip; the input on top is what a tap, VoiceOver and the keyboard reach. */}
          <span inert className={styles.otherChip}>
            <Chip size="mini" selected={other} leading={<Icon name="calendar" size={16} />}>
              {other ? formatDate(date, locale, 'medium') : 'Other'}
            </Chip>
          </span>
          <input
            type="date"
            className={styles.dateInput}
            value={date}
            aria-label={other ? `Other date, ${formatDate(date, locale, 'long')}` : 'Other date'}
            onChange={pick}
            onPointerDown={remember}
            onClick={openPicker}
          />
        </span>
      </fieldset>
    </div>
  )
}

interface NoteRowProps {
  label: string
  value: string
  suggestions: readonly FrequentEntry[]
  money: MoneyFormat
  onChange(note: string): void
  onPick(entry: FrequentEntry): void
  onFocusChange(focused: boolean): void
}

/** Return closes the keyboard, so the keypad comes back. */
function blurOnEnter(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.target.blur()
}

/**
 * "Note" (or "From" for income), one line, up to 80 characters. While it is empty the notes
 * entered at least twice lately in this category sit beside it as chips; a tap fills in the note
 * and the amount (§3.4). They live in the note's own row, so the sheet gains no height (DESIGN.md
 * §14 note 21).
 */
function NoteRow({ label, value, suggestions, money, onChange, onPick, onFocusChange }: NoteRowProps) {
  const shown = value.trim() === '' && suggestions.length > 0
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Return in the note below
    <div className={cx(styles.noteRow, shown && styles.withSuggestions)} data-row="" onKeyDown={blurOnEnter}>
      <TextField
        label={label}
        value={value}
        onChange={onChange}
        maxLength={MAX_LENGTHS.note}
        enterKeyHint="done"
        autoComplete="off"
        className={styles.note}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
      />
      {shown && (
        <fieldset className={styles.suggestions} aria-label="Suggestions">
          {suggestions.map((entry) => (
            <Chip
              key={`${entry.note}|${entry.amount}`}
              size="mini"
              label={`${entry.note}, ${spokenAmount(money, entry.amount)}`}
              onClick={() => onPick(entry)}
            >
              {entry.note} <span className={styles.suggestionAmount}>{shownAmount(money, entry.amount)}</span>
            </Chip>
          ))}
        </fieldset>
      )}
    </div>
  )
}

/** The period's name for a toast: "September", or "September 2025" outside the current year. */
function periodNameFor(date: ISODate, today: ISODate, startDay: number, locale: string): string {
  return formatPeriodTitle(periodOf(date, startDay), periodOf(today, startDay), startDay, locale)
}

/**
 * Adds or edits an expense or one-off income (docs/SPEC.md §3.4, §3.13, §3.16, §5.10; DESIGN.md
 * §9.16, §9.26; EXTRAS.md §2.1 to §2.4). Top to bottom: the header with "Cancel" and, for
 * expenses, the Split capsule; the amount with the line of what it leaves (or "Your share", or the
 * wallet after it); the category chips; note, date and "Pay from wallet"; the keypad, or the split
 * editor in its place; the primary button, with "Delete" beside it when editing. It fits a
 * 375×667 screen. A new item keeps a draft until it is saved or the sheet closes.
 */
export function TransactionSheet({ route, onClose, setDirty }: SheetProps<'transaction'>) {
  const data = useData((d) => d)
  const today = useToday()
  const money = useMoneyFormatContext()
  const map = useCategoryMap()
  const { locale, monthStartDay: startDay } = useSettings()
  const [opened] = useState(() => openForm(data, route, today, money.digits))
  const [form, setForm] = useState(opened.start)
  const [panel, setPanel] = useState<'keypad' | 'split'>('keypad')
  const [noteFocused, setNoteFocused] = useState(false)
  // The keypad comes back with a fade once it has made way for the split editor (EXTRAS.md §2.9).
  const [keypadBack, setKeypadBack] = useState(false)
  const panelId = useId()
  const draftRoute = useMemo(() => draftRouteOf(route), [route])
  const currentSummary = useMonthSummary(periodOf(today, startDay))

  const { kind, original, missing } = opened
  const income = kind === 'income'
  const editing = original !== null || missing
  const amount = formAmount(form)
  const fits = income || splitsFit(form)
  const dirty = !missing && hasChanges(form, opened.initial)
  const canSave = !missing && amount > 0 && (income || form.categoryId !== null) && fits

  // Unsaved changes ask before a swipe, the scrim or a system back closes the sheet (§5.10 rule 5).
  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])

  // A new item keeps its draft on every change (§5.10 rule 4).
  useEffect(() => {
    if (draftRoute === null) return
    if (dirty) writeDraft(draftRoute, form, Date.now())
    else clearDraft(draftRoute)
  }, [draftRoute, form, dirty])

  // Closing the sheet, however it closes, ends the draft; only an app that is killed keeps it.
  useEffect(() => {
    if (draftRoute === null) return undefined
    return () => clearDraft(draftRoute)
  }, [draftRoute])

  const draft = useMemo(() => draftTransaction(form, kind, original), [form, kind, original])
  const choices = useMemo(
    () => (income ? [] : categoryChoices(data.categories, form.categoryId, form.showAllCategories, map)),
    [income, data.categories, form.categoryId, form.showAllCategories, map],
  )
  const suggestions = useMemo(
    () =>
      income || form.categoryId === null
        ? []
        : frequentEntries(data.transactions, today, { categoryId: form.categoryId, categories: data.categories, limit: 4 }),
    [income, form.categoryId, data.transactions, data.categories, today],
  )
  const wallet = useMemo(
    () => (!income && form.fromWallet ? walletAfter(data, today, original, draft) : null),
    [income, form.fromWallet, data, today, original, draft],
  )

  // The lines under the amount: "Your share" while a split exists, then the budget or the wallet.
  const lines: Line[] = []
  const split = !income && form.splits.length > 0
  if (split) {
    lines.push(
      fits
        ? {
            key: 'share',
            tone: 'default',
            content: (
              <>
                Your share: <strong>{shownAmount(money, myShare(draft))}</strong>
              </>
            ),
            testId: 'split-share',
          }
        : { key: 'share', tone: 'critical', content: `Others owe more than the bill of ${shownAmount(money, amount)}`, testId: 'split-share' },
    )
  }
  if (!income && amount > 0 && fits) {
    if (wallet !== null) lines.push(walletLine(wallet, money))
    else if (!editing && form.date === today && currentSummary.todayLeft !== null) {
      lines.push(budgetLine(budgetAmount(draft), currentSummary.todayLeft, currentSummary.left, money))
    }
  }

  const press = (key: KeypadKey) => setForm((f) => pressKey(f, key, money.digits))

  const close = () => {
    if (draftRoute !== null) clearDraft(draftRoute)
    setDirty(false)
    onClose()
  }

  const save = () => {
    if (!canSave) return
    const note = form.note.trim()
    let added = false
    try {
      if (original === null) {
        actions.addTransaction({
          kind,
          amount,
          categoryId: income ? null : form.categoryId,
          date: form.date,
          note,
          ...(income ? {} : { fromWallet: form.fromWallet, splits: splitsToSave(form.splits) }),
        })
        added = true
      } else {
        actions.updateTransaction(original.id, {
          amount,
          date: form.date,
          note,
          ...(income ? {} : { categoryId: form.categoryId, fromWallet: form.fromWallet, splits: splitsToSave(form.splits) }),
        })
      }
    } catch (error) {
      console.error(error)
      toast({ message: "Couldn't save this entry. Check the amount and who owes what, then try again.", tone: 'critical' })
      return
    }
    close()
    if (!added) {
      toast({ message: 'Saved' })
      return
    }
    // "Added 3,50 € to Coffee & snacks"; dated outside the month on screen, "Added 3,50 € to
    // September" with "Show", which selects that month (§3.4). Income goes to its month.
    const nav = useNav.getState()
    const selected = nav.month ?? periodOf(today, startDay)
    const period = periodOf(form.date, startDay)
    const where = period !== selected || income ? periodNameFor(form.date, today, startDay, locale) : categoryDisplay(form.categoryId, map).name
    toast({
      message: addedMessage(money, amount, where),
      action: period === selected ? undefined : { label: 'Show', onClick: () => useNav.getState().setMonth(period) },
    })
  }

  const remove = () => {
    if (original === null) return
    const what = original.note.trim() || (income ? 'income' : categoryDisplay(original.categoryId, map).name)
    close()
    withUndo(`Deleted ${what}`, () => actions.deleteTransaction(original.id)).catch((error: unknown) => {
      console.error(error)
      toast({ message: "Couldn't delete this entry. Open it again from Daily and try once more.", tone: 'critical' })
    })
  }

  const showKeypad = () => {
    setPanel('keypad')
    setKeypadBack(true)
  }
  const toggleSplit = () => (panel === 'split' ? showKeypad() : setPanel('split'))

  if (missing) {
    return (
      <div className={styles.sheet}>
        <SheetHeader title={titleOf(kind, true)} onCancel={onClose} cancelLabel="Close" />
        <EmptyState title="This entry no longer exists" message="It was deleted. Close this sheet to go back." />
      </div>
    )
  }

  const splitOpen = panel === 'split' && !income
  const splitSet = form.splits.length > 0
  return (
    <div className={styles.sheet} data-lines={income ? 0 : Math.max(1, lines.length)}>
      <SheetHeader
        title={titleOf(kind, editing)}
        onCancel={close}
        // Split is a disclosure for the split panel (EXTRAS.md §2.1): tinted once a split is set,
        // selected while the panel is open, and greyed while the amount is 0.
        action={
          income
            ? undefined
            : {
                label: 'Split',
                tone: splitSet && !splitOpen ? 'confirm' : 'neutral',
                expanded: splitOpen,
                controls: panelId,
                disabled: amount === 0 && !splitOpen,
                onClick: toggleSplit,
                'data-testid': 'split-toggle',
              }
        }
      />

      <div className={styles.amount}>
        <AmountDisplay keys={form.keys} onEdit={splitOpen ? showKeypad : undefined} />
        {/* Income has no consequence, so it keeps no room for one. */}
        {!income && <ConsequenceLines lines={lines} />}
      </div>

      {!income && (
        <ChipTabs
          items={choices}
          value={form.categoryId ?? ''}
          onChange={(value) =>
            setForm((f) => (value === ALL_CATEGORIES ? { ...f, showAllCategories: true } : { ...f, categoryId: value }))
          }
          label="Category"
          itemTestId="category-chip"
          className={styles.chips}
        />
      )}

      <div className={cx(styles.group, income && styles.groupIncome)}>
        <NoteRow
          label={income ? 'From' : 'Note'}
          value={form.note}
          suggestions={suggestions}
          money={money}
          onChange={(note) => setForm((f) => ({ ...f, note }))}
          onPick={(entry) => {
            setForm((f) => applySuggestion(f, entry.note, entry.amount, money.digits))
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          }}
          onFocusChange={setNoteFocused}
        />
        <DateRow date={form.date} today={today} locale={locale} onChange={(date) => setForm((f) => ({ ...f, date }))} />
        {!income && (
          <Toggle
            label="Pay from wallet"
            checked={form.fromWallet}
            onChange={(fromWallet) => setForm((f) => ({ ...f, fromWallet }))}
            data-testid="pay-from-wallet"
          />
        )}
      </div>

      {splitOpen ? (
        <SplitPanel
          id={panelId}
          rows={form.splits}
          data={data}
          newKey={newRowKey}
          onAdd={(key, person) => setForm((f) => addPerson(f, key, person))}
          onName={(key, person) => setForm((f) => setPersonName(f, key, person))}
          onComplete={(key, person) => setForm((f) => completePerson(f, key, person))}
          onNameDone={(key) => setForm((f) => tidyPerson(f, key))}
          onAmount={(key, value) => setForm((f) => setPersonAmount(f, key, value))}
          onRemove={(key) => setForm((f) => removePerson(f, key))}
          onEven={() => setForm(splitEvenly)}
        />
      ) : (
        !noteFocused && (
          <Keypad
            onKey={press}
            decimalSeparator={money.digits === 0 ? null : money.decimalSeparator}
            label="Amount keypad"
            className={cx(styles.keypad, keypadBack && styles.keypadBack)}
          />
        )
      )}

      <div className={styles.actions}>
        {original !== null && (
          <Button variant="destructive" className={styles.delete} onClick={remove} data-testid="sheet-delete">
            Delete
          </Button>
        )}
        <Button variant="primary" size="lg" block className={styles.save} disabled={!canSave} onClick={save} data-testid="sheet-save">
          {original !== null ? 'Save changes' : income ? 'Add income' : 'Add expense'}
        </Button>
      </div>
    </div>
  )
}
