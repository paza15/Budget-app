import { useState, type CSSProperties, type ReactNode } from 'react'
import { applyKeypadKey, keypadStringToCents, type KeypadKey } from '@/domain/money'
import {
  AmountDisplay,
  BigAmount,
  Button,
  chooseDialog,
  confirmDialog,
  ConfirmHost,
  ConsequenceLine,
  Engraving,
  Icon,
  Keypad,
  Sheet,
  SheetHeader,
  toast,
  ToastHost,
  type ChooseOption,
} from '@/ui'
import { ActionSheetCard, AlertCard } from '@/ui/ConfirmHost'
import { ToastView } from '@/ui/ToastHost'

// Dev-only gallery of the overlays (docs/DESIGN.md §9.15–§9.18). On its own (section=overlays) it
// opens the add-expense sheet on load, as the app shows it; open=large opens the large sheet,
// open=review the statement-paper sheet of the month-end review, and open=none nothing. Shown with
// the other sections it opens nothing, so it covers none of them. The alert, action sheets and
// toast also appear as static previews; the buttons open the real ones.
const params = new URLSearchParams(window.location.search)
const OPEN = params.get('open') ?? (params.get('section') === 'overlays' ? 'add' : null)

type SheetKind = 'add' | 'large' | 'review'

function isSheetKind(value: string | null): value is SheetKind {
  return value === 'add' || value === 'large' || value === 'review'
}

const PIN_LENGTH = 4

/** 10: a half step of the 4pt grid that the designs use, from the space tokens. */
const SPACE_10 = 'calc(var(--space-2) + var(--space-0-5))'

/** A hairline along the top of a row that starts `inset` px in, as inline style. */
function hairlineFrom(inset: number): CSSProperties {
  return {
    backgroundImage: 'linear-gradient(var(--hairline), var(--hairline))',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: `${inset}px 0`,
    backgroundSize: `calc(100% - ${inset}px) var(--hairline-width)`,
  }
}

const S = {
  section: { display: 'grid', gap: 'var(--space-8)', color: 'var(--ink)', paddingBottom: 'var(--space-8)' },
  title: { margin: 0, font: 'var(--text-large-title)' },
  board: { display: 'grid', gap: 'var(--space-3)' },
  heading: { margin: 0, font: 'var(--text-title3)' },
  note: { margin: 0, font: 'var(--text-footnote)', color: 'var(--ink-2)' },
  buttons: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' },
  // A static stand-in for the scrim over the app, so previews read as they do on screen.
  stage: {
    display: 'grid',
    placeItems: 'center',
    minHeight: 240,
    padding: 'var(--space-6) var(--space-2)',
    borderRadius: 'var(--radius-lg)',
    background: 'var(--scrim)',
  },
  stageBottom: { alignItems: 'end', paddingBottom: 'var(--space-2)' },
  // Sheet headers on the sheet's material, one under the other.
  headers: { display: 'grid', overflow: 'hidden', borderRadius: 'var(--radius-lg)', background: 'var(--surface-sheet)' },
  // The transaction sheet's skeleton (DESIGN.md §9.16): amount 10 below the header, the
  // consequence 10 below it, the keypad 10 below, the button 12 below.
  amount: { padding: `${SPACE_10} var(--gutter) 0`, textAlign: 'center' },
  consequence: { marginTop: SPACE_10 },
  keys: { margin: `${SPACE_10} var(--space-4) 0` },
  save: { margin: 'var(--space-3) var(--space-4) 0' },
  groupTitle: {
    margin: 'calc(var(--space-6) + var(--space-0-5)) calc(var(--gutter) + var(--group-padding)) calc(var(--space-2) - 1px)',
    font: 'var(--text-footnote)',
    fontWeight: 600,
    color: 'var(--ink-2)',
  },
  group: { margin: '0 var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-raised)' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    minHeight: 48,
    padding: '0 var(--space-4)',
    font: 'var(--text-body)',
  },
  rowRule: { boxShadow: 'inset 0 var(--hairline-width) 0 var(--hairline)' },
  input: {
    flex: 1,
    minWidth: 0,
    border: 0,
    padding: 0,
    background: 'transparent',
    font: 'var(--text-body)',
    fontSize: 'var(--text-input)',
    color: 'var(--ink)',
    textAlign: 'right',
  },
  rowValue: { marginLeft: 'auto', color: 'var(--ink-2)' },
  rowButton: { width: '100%', textAlign: 'left' },
  pinTitle: { margin: 0, font: 'var(--text-title3)', textAlign: 'center' },
  dots: { display: 'flex', justifyContent: 'center', gap: 'var(--space-5)', margin: 'var(--space-5) 0 var(--section-gap)' },
  dot: { width: 13, height: 13, borderRadius: '50%', boxShadow: 'inset 0 0 0 1.5px var(--ink-3)' },
  dotFilled: { background: 'var(--ink)', boxShadow: 'none' },
  pinStage: { padding: 'var(--space-6) 0', borderRadius: 'var(--radius-lg)', background: 'var(--bg)' },
  // The month-end review's skeleton (docs/design/EXTRAS.md §1.1–§1.5), printed straight onto the
  // sheet's statement paper: no groups, sections parted by space and rules.
  review: { padding: '0 var(--gutter) calc(var(--space-7) + var(--space-0-5))' },
  resultLabel: { margin: 'var(--space-2) 0 0', font: 'var(--text-subhead)', fontWeight: 500, color: 'var(--ink-2)' },
  resultRow: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-1)' },
  resultFigure: { flex: 1, minWidth: 0 },
  seal: { display: 'grid', justifyItems: 'center', gap: 5, width: 85, flex: 'none' },
  sealCaption: { font: 'var(--text-footnote)', color: 'var(--ink-2)', whiteSpace: 'nowrap' },
  sentence: { margin: `${SPACE_10} 0 0`, font: 'var(--text-body)' },
  sectionHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 'var(--space-3)',
    margin: 'calc(var(--space-7) + var(--space-0-5)) 0 0',
    paddingBottom: 'calc(var(--space-2) + 1px)',
    borderBottom: 'var(--hairline-width) solid var(--hairline-strong)',
  },
  sectionTitle: { margin: 0, font: 'var(--text-headline)' },
  sectionMeta: { font: 'var(--text-figure-sm)', color: 'var(--ink-2)' },
  ledger: { margin: 0, padding: 'var(--space-0-5) 0 var(--space-2)' },
  ledgerRow: { display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) auto 20px', alignItems: 'center', minHeight: 44 },
  // Printed rules between rows, from the label to the end (past the operator column).
  ledgerRule: hairlineFrom(22),
  operator: { font: 'var(--text-figure)', color: 'var(--ink-3)' },
  ledgerLabel: { font: 'var(--text-body)' },
  ledgerFigure: { font: 'var(--text-figure)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' },
  ledgerResult: { minHeight: 52 },
  ledgerResultLabel: { font: 'var(--text-body)', fontWeight: 600 },
  ledgerResultFigure: {
    font: 'var(--text-figure-strong)',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
    borderBottom: '3px double var(--brass)',
    paddingBottom: 'var(--space-0-5)',
  },
  hungUnit: { font: 'var(--text-figure-strong)', textAlign: 'right' },
  legendRow: {
    display: 'grid',
    gridTemplateColumns: '18px minmax(0, 1fr) auto',
    columnGap: 0,
    rowGap: 'var(--space-0-5)',
    padding: `${SPACE_10} 0 calc(var(--space-2) + var(--space-1) - 1px)`,
  },
  legendRule: hairlineFrom(18),
  legendDot: { width: 9, height: 9, borderRadius: '50%', alignSelf: 'center' },
  legendName: { font: 'var(--text-body)' },
  legendAmount: { font: 'var(--text-figure)', fontVariantNumeric: 'tabular-nums' },
  legendChange: {
    gridColumn: '2 / -1',
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    font: 'var(--text-footnote)',
    color: 'var(--ink-2)',
  },
  fact: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'baseline',
    columnGap: 'var(--space-3)',
    minHeight: 48,
    padding: 'calc(var(--space-3) + 1px) 0',
    boxSizing: 'border-box',
    margin: 0,
  },
  factRule: { boxShadow: 'inset 0 var(--hairline-width) 0 var(--hairline)' },
  factLabel: { margin: 0, font: 'var(--text-body)' },
  factValue: { margin: 0, font: 'var(--text-body)', fontVariantNumeric: 'tabular-nums' },
  factMoney: { margin: 0, font: 'var(--text-figure)', fontVariantNumeric: 'tabular-nums' },
  footer: { margin: 'calc(var(--space-5) + var(--space-0-5)) 0 0', font: 'var(--text-footnote)', color: 'var(--ink-2)' },
} satisfies Record<string, CSSProperties>

function Board({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section style={S.board}>
      <h2 style={S.heading}>{title}</h2>
      {note ? <p style={S.note}>{note}</p> : null}
      {children}
    </section>
  )
}

function noop(): void {}

async function confirmReplace(): Promise<void> {
  const replace = await confirmDialog({
    title: 'Replace everything on this iPhone?',
    message:
      'The backup from 12 Oct has 214 entries and 9 fixed costs and income items. This iPhone has 41 entries. Settings and categories are replaced too.',
    confirmLabel: 'Replace',
    destructive: true,
  })
  toast({ message: replace ? 'Backup restored' : 'Nothing was replaced', tone: replace ? 'success' : 'default' })
}

async function chooseIncome(): Promise<void> {
  const choice = await chooseDialog({
    title: 'Add your income',
    options: [
      { value: 'every', label: 'Every month' },
      { value: 'once', label: 'Just this month' },
    ],
  })
  if (choice !== null) toast({ message: choice === 'every' ? 'Opens the recurring sheet' : 'Opens the transaction sheet' })
}

/** The add button's long-press menu (DESIGN.md §9.1): each quick add with its glyph, label and amount. */
const QUICK_ADDS: ChooseOption<'coffee' | 'bakery' | 'mensa'>[] = [
  { value: 'coffee', label: 'Coffee, 3,50 €', icon: 'coffee' },
  { value: 'bakery', label: 'Bakery, 2,50 €', icon: 'bread' },
  { value: 'mensa', label: 'Mensa, 4,50 €', icon: 'fork-knife' },
]

const QUICK_ADD_NAMES = { coffee: 'Coffee', bakery: 'Bakery', mensa: 'Mensa' } as const

async function offerQuickAdds(): Promise<void> {
  const choice = await chooseDialog({ title: 'Quick add', options: QUICK_ADDS })
  if (choice !== null) {
    toast({ message: `Added ${QUICK_ADD_NAMES[choice]}`, action: { label: 'Undo', onClick: noop } })
  }
}

interface AmountEntry {
  amount: string
  /** Opened with an amount: the first digit or separator replaces it (docs/SPEC.md §3.4). */
  pristine: boolean
}

function typeKey(entry: AmountEntry, key: KeypadKey): AmountEntry {
  const from = entry.pristine && key !== 'back' ? '' : entry.amount
  return { amount: applyKeypadKey(from, key, 2), pristine: false }
}

interface SheetProps {
  open: boolean
  onClose(): void
  onExited(): void
}

/** The transaction sheet's skeleton: header, the amount being typed, its consequence, the keypad. */
function AddExpenseSheet({ open, onClose, onExited }: SheetProps) {
  const [entry, setEntry] = useState<AmountEntry>({ amount: '4.50', pristine: true })
  const { amount } = entry
  return (
    <Sheet open={open} onClose={onClose} onExited={onExited} label="New expense" data-sheet="transaction">
      <SheetHeader title="New expense" onCancel={onClose} />
      <div style={S.amount}>
        <AmountDisplay keys={amount} />
        <div style={S.consequence}>
          <ConsequenceLine live>
            Leaves <strong>4,84&nbsp;€</strong> for today
          </ConsequenceLine>
        </div>
      </div>
      <div style={S.keys}>
        <Keypad decimalSeparator="," label="Amount keypad" onKey={(key) => setEntry((e) => typeKey(e, key))} />
      </div>
      <div style={S.save}>
        <Button
          variant="primary"
          size="lg"
          block
          onClick={onClose}
          disabled={keypadStringToCents(amount) === 0}
          data-testid="sheet-save"
        >
          Add expense
        </Button>
      </div>
    </Sheet>
  )
}

/** A large sheet with text fields (the keyboard), unsaved changes and a second sheet on top. */
function LargeSheet({ open, onClose, onExited, onOpenStacked }: SheetProps & { onOpenStacked(): void }) {
  const [name, setName] = useState('Netflix')
  const [note, setNote] = useState('')
  const dirty = name !== 'Netflix' || note !== ''
  const remove = async () => {
    const choice = await chooseDialog({
      title: 'Remove Netflix?',
      message:
        'Stopping keeps it in past months. Deleting removes it from every month, including the past, and changes those totals.',
      options: [
        { value: 'stop', label: 'Stop after October' },
        { value: 'delete', label: 'Delete from all months', destructive: true },
      ],
    })
    if (choice !== null) {
      onClose()
      toast({ message: choice === 'stop' ? 'Netflix stops after October' : 'Deleted Netflix', action: { label: 'Undo', onClick: noop } })
    }
  }
  return (
    <Sheet open={open} onClose={onClose} onExited={onExited} label="Netflix" size="large" dirty={dirty} data-sheet="recurring">
      <SheetHeader title={name || 'Fixed cost'} onCancel={onClose} action={{ label: 'Save', onClick: onClose, disabled: name.trim() === '' }} />
      <p style={S.groupTitle}>Every month</p>
      <div style={S.group}>
        <label style={S.row}>
          Name
          <input style={S.input} value={name} maxLength={40} enterKeyHint="next" onChange={(e) => setName(e.target.value)} />
        </label>
        <div style={{ ...S.row, ...S.rowRule }}>
          Amount<span style={{ ...S.rowValue, font: 'var(--text-figure)', color: 'var(--ink)' }}>13,99&nbsp;€</span>
        </div>
        <div style={{ ...S.row, ...S.rowRule }}>
          How often<span style={S.rowValue}>Monthly</span>
        </div>
        <label style={{ ...S.row, ...S.rowRule }}>
          Note
          <input style={S.input} value={note} maxLength={80} placeholder="Optional" onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <p style={S.groupTitle}>Gallery</p>
      <div style={S.group}>
        <div style={S.row}>
          <Button variant="plain" onClick={onOpenStacked}>
            Open a sheet on top
          </Button>
        </div>
        <div style={{ ...S.row, ...S.rowRule }}>
          <Button variant="destructive" onClick={() => void remove()}>
            Delete
          </Button>
        </div>
      </div>
      <p style={{ ...S.note, margin: `var(--space-2) calc(var(--gutter) + var(--group-padding)) 0` }}>
        Change the name or the note, then press Escape, tap outside or drag the sheet down: it asks before closing.
      </p>
    </Sheet>
  )
}

const LEDGER = [
  { op: '+', label: 'Income', figure: '1.450,00' },
  { op: '−', label: 'Fixed costs', figure: '778,88' },
  { op: '−', label: 'Daily spending', figure: '538,30' },
] as const

const WHERE_IT_WENT = [
  { name: 'Groceries', amount: '186,30 €', ink: 'var(--cat-green)', change: '8 % more than September', arrow: 'arrow-up' },
  { name: 'Eating', amount: '121,50 €', ink: 'var(--cat-orange)', change: '14 % less than September', arrow: 'arrow-down' },
  { name: 'Going out', amount: '96,40 €', ink: 'var(--cat-red)', change: 'Same as September', arrow: null },
  { name: 'Coffee & snacks', amount: '48,60 €', ink: 'var(--cat-yellow)', change: 'New in October', arrow: null },
  { name: 'Transport', amount: '34,20 €', ink: 'var(--cat-blue)', change: '3 % less than September', arrow: 'arrow-down' },
] as const

const FACTS = [
  { label: 'Biggest expense', value: '41,30 €', money: true },
  { label: 'Days without spending', value: '6', money: false },
  { label: 'Entries', value: '64', money: false },
  { label: 'Fixed costs paid', value: '6 of 6', money: false },
] as const

/**
 * The month-end review's sheet (docs/design/EXTRAS.md §1.1): a large sheet on statement paper
 * (material 'paper') whose header has two lines, the title over the range, and gets its scroll-edge
 * fade once the statement scrolls under it.
 */
function ReviewSheet({ open, onClose, onExited }: SheetProps) {
  return (
    <Sheet open={open} onClose={onClose} onExited={onExited} label="October statement" size="large" material="paper" data-sheet="monthReview">
      <SheetHeader title="October statement" subtitle="1 Oct – 31 Oct 2026" cancelLabel="Close" onCancel={onClose} focusCancel />
      <div style={S.review}>
        <p style={S.resultLabel}>Moved to your wallet</p>
        <div style={S.resultRow}>
          <div style={S.resultFigure}>
            <BigAmount cents={13282} />
          </div>
          <div style={S.seal}>
            <Engraving kind="seal" size={54} label="Statement closed on 31 October" />
            <span style={S.sealCaption} aria-hidden="true">
              Closed 31 Oct
            </span>
          </div>
        </div>
        <p style={S.sentence}>100,00&nbsp;€ of savings and 32,82&nbsp;€ left over.</p>

        <div style={S.sectionHead}>
          <h3 style={S.sectionTitle}>Money in and out</h3>
        </div>
        <div style={S.ledger}>
          {LEDGER.map((row, i) => (
            <div key={row.label} style={i === 0 ? S.ledgerRow : { ...S.ledgerRow, ...S.ledgerRule }}>
              <span style={S.operator} aria-hidden="true">
                {row.op}
              </span>
              <span style={S.ledgerLabel}>{row.label}</span>
              <span style={S.ledgerFigure}>{row.figure}</span>
            </div>
          ))}
          <div style={{ ...S.ledgerRow, ...S.ledgerResult }}>
            <span style={{ ...S.operator, color: 'var(--ink)' }} aria-hidden="true">
              =
            </span>
            <span style={S.ledgerResultLabel}>To your wallet</span>
            <span style={S.ledgerResultFigure}>132,82</span>
            <span style={S.hungUnit}>€</span>
          </div>
        </div>

        <div style={S.sectionHead}>
          <h3 style={S.sectionTitle}>Where it went</h3>
          <span style={S.sectionMeta}>538,30&nbsp;€</span>
        </div>
        {WHERE_IT_WENT.map((row, i) => (
          <div key={row.name} style={i === 0 ? S.legendRow : { ...S.legendRow, ...S.legendRule }}>
            <span style={{ ...S.legendDot, background: row.ink }} aria-hidden="true" />
            <span style={S.legendName}>{row.name}</span>
            <span style={S.legendAmount}>{row.amount}</span>
            <span style={S.legendChange}>
              {row.arrow ? <Icon name={row.arrow} size={13} /> : null}
              {row.change}
            </span>
          </div>
        ))}

        <div style={S.sectionHead}>
          <h3 style={S.sectionTitle}>The month in numbers</h3>
        </div>
        <dl style={{ margin: 0 }}>
          {FACTS.map((fact, i) => (
            <div key={fact.label} style={i === 0 ? S.fact : { ...S.fact, ...S.factRule }}>
              <dt style={S.factLabel}>{fact.label}</dt>
              <dd style={fact.money ? S.factMoney : S.factValue}>{fact.value}</dd>
            </div>
          ))}
        </dl>
        <p style={S.footer}>Changing entries from October updates this statement and your wallet.</p>
      </div>
    </Sheet>
  )
}

/** The lock screen's PIN pad with the Face ID key and the dots it fills. */
function PinPad() {
  const [pin, setPin] = useState('12')
  const onKey = (key: KeypadKey) => {
    if (key === 'back') setPin((p) => p.slice(0, -1))
    else if (key !== '.') setPin((p) => (p.length < PIN_LENGTH ? p + key : key))
  }
  return (
    <div style={S.pinStage}>
      <h3 style={S.pinTitle}>Enter your PIN</h3>
      <div style={S.dots} data-testid="pin-dots" data-filled={pin.length}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} style={i < pin.length ? { ...S.dot, ...S.dotFilled } : S.dot} />
        ))}
      </div>
      <Keypad
        variant="pin"
        decimalSeparator={null}
        label="PIN"
        onKey={onKey}
        leftKey={
          <button type="button" aria-label="Unlock with Face ID" onClick={() => toast({ message: 'Face ID is not available here' })}>
            <Icon name="face-id" size={30} />
          </button>
        }
      />
    </div>
  )
}

/** Overlays and input: sheets, the keypads, the alert, the action sheets and toasts. */
export function OverlaysGallery() {
  const [sheet, setSheet] = useState<SheetKind | null>(isSheetKind(OPEN) ? OPEN : null)
  const [stacked, setStacked] = useState(false)
  // Sheets stay mounted while they play their exit; `shown` remembers which one is on its way out.
  const [shown, setShown] = useState<SheetKind | null>(sheet)
  if (sheet !== null && sheet !== shown) setShown(sheet)
  const close = () => setSheet(null)
  const exited = () => setShown(null)

  return (
    <section style={S.section} aria-labelledby="overlays-gallery-title">
      <h1 id="overlays-gallery-title" style={S.title}>
        Overlays
      </h1>

      <Board title="Sheets" note="The floating iOS 26 sheet over the scrim. Drag it down by the handle or the header to close it.">
        <div style={S.buttons}>
          <Button variant="secondary" onClick={() => setSheet('add')}>
            New expense
          </Button>
          <Button variant="secondary" onClick={() => setSheet('large')}>
            Large sheet with fields
          </Button>
          <Button variant="secondary" onClick={() => setSheet('review')}>
            Statement on paper
          </Button>
        </div>
      </Board>

      <Board
        title="Sheet header actions"
        note="Save (confirm), Delete (destructive) and the Split disclosure: idle, open, a split set, and disabled while the amount is 0."
      >
        <div style={S.headers}>
          <SheetHeader title="Netflix" onCancel={noop} action={{ label: 'Save', onClick: noop }} />
          <SheetHeader title="Deposit" onCancel={noop} action={{ label: 'Delete', onClick: noop, tone: 'destructive' }} />
          <SheetHeader title="New expense" onCancel={noop} action={{ label: 'Split', onClick: noop, tone: 'neutral', expanded: false, controls: 'split-panel' }} />
          <SheetHeader title="New expense" onCancel={noop} action={{ label: 'Split', onClick: noop, tone: 'neutral', expanded: true, controls: 'split-panel' }} />
          <SheetHeader title="New expense" onCancel={noop} action={{ label: 'Split', onClick: noop, expanded: false, controls: 'split-panel' }} />
          <SheetHeader title="New expense" onCancel={noop} action={{ label: 'Split', onClick: noop, tone: 'neutral', disabled: true, expanded: false, controls: 'split-panel' }} />
        </div>
      </Board>

      <Board
        title="Amount and consequence"
        note="The amount being typed (never masked) and the line under it: plain, warning, critical, and empty (it keeps its 20px). With the split panel open the amount is the button back to the keypad."
      >
        <div style={S.headers}>
          <div style={S.amount}>
            <AmountDisplay keys="1234.5" />
            <div style={S.consequence}>
              <ConsequenceLine>
                Wallet after: <strong>531,22&nbsp;€</strong>
              </ConsequenceLine>
            </div>
            <div style={S.consequence}>
              <ConsequenceLine tone="warning" icon="warning">
                2,66&nbsp;€ over today's budget
              </ConsequenceLine>
            </div>
            <div style={S.consequence}>
              <ConsequenceLine tone="critical" icon="critical">
                41,28&nbsp;€ over this month's budget
              </ConsequenceLine>
            </div>
            <div style={S.consequence}>
              <ConsequenceLine />
            </div>
            <AmountDisplay keys="32" onEdit={noop} />
          </div>
        </div>
      </Board>

      <Board title="Alert" note="confirmDialog, destructive: focus starts on Cancel.">
        <div style={S.stage}>
          <AlertCard
            inline
            options={{
              title: 'Discard this expense?',
              confirmLabel: 'Discard',
              cancelLabel: 'Keep editing',
              destructive: true,
            }}
            onAnswer={noop}
          />
        </div>
        <div style={S.buttons}>
          <Button variant="secondary" onClick={() => void confirmReplace()}>
            Ask to replace
          </Button>
        </div>
      </Board>

      <Board title="Action sheet" note="chooseDialog: options in one group, Cancel apart.">
        <div style={{ ...S.stage, ...S.stageBottom }}>
          <ActionSheetCard
            inline
            options={{
              title: 'Remove Netflix?',
              message:
                'Stopping keeps it in past months. Deleting removes it from every month, including the past, and changes those totals.',
              options: [
                { value: 'stop', label: 'Stop after October' },
                { value: 'delete', label: 'Delete from all months', destructive: true },
              ],
            }}
            onAnswer={noop}
          />
        </div>
        <div style={S.buttons}>
          <Button variant="secondary" onClick={() => void chooseIncome()}>
            Choose how income repeats
          </Button>
        </div>
      </Board>

      <Board title="Quick-add menu" note="The add button's long press: each option leads with its glyph, the label stays centred.">
        <div style={{ ...S.stage, ...S.stageBottom }}>
          <ActionSheetCard inline options={{ title: 'Quick add', options: QUICK_ADDS }} onAnswer={noop} />
        </div>
        <div style={S.buttons}>
          <Button variant="secondary" onClick={() => void offerQuickAdds()}>
            Open the quick-add menu
          </Button>
        </div>
      </Board>

      <Board title="Toast" note="One at a time, 12px above the tab bar and above sheets.">
        <ToastView
          inline
          toast={{
            id: 0,
            message: 'Added 3,50 € to Coffee & snacks',
            action: { label: 'Undo', onClick: noop },
            tone: 'default',
            leaving: false,
          }}
        />
        <div style={S.buttons}>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                message: 'Added 3,50 € to Coffee & snacks',
                action: { label: 'Undo', onClick: () => toast({ message: 'Removed the expense' }) },
              })
            }
          >
            Show with Undo
          </Button>
          <Button variant="secondary" onClick={() => toast({ message: 'Backup exported', tone: 'success' })}>
            Show success
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast({ message: "Couldn't export the backup. Try again.", tone: 'critical' })}
          >
            Show critical
          </Button>
        </div>
      </Board>

      <Board title="PIN keypad" note="Engraved coins; Face ID bottom left, backspace bottom right.">
        <PinPad />
      </Board>

      <Board title="Amount keypad, no minor unit" note="A currency without cents has no decimal key.">
        <div style={{ ...S.group, margin: 0, padding: 'var(--space-2) var(--space-4)' }}>
          <Keypad decimalSeparator={null} onKey={noop} />
        </div>
      </Board>

      {shown === 'add' ? <AddExpenseSheet open={sheet === 'add'} onClose={close} onExited={exited} /> : null}
      {shown === 'large' ? (
        <LargeSheet open={sheet === 'large'} onClose={close} onExited={exited} onOpenStacked={() => setStacked(true)} />
      ) : null}
      {shown === 'review' ? <ReviewSheet open={sheet === 'review'} onClose={close} onExited={exited} /> : null}
      <StackedSheet open={stacked} onClose={() => setStacked(false)} />
      <ToastHost />
      <ConfirmHost />
    </section>
  )
}

/** A small sheet over the large one: the one below turns inert until it closes. */
function StackedSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} label="How often" data-sheet="stacked">
      <SheetHeader title="How often" onCancel={onClose} />
      <div style={{ ...S.group, marginTop: 'var(--space-2)' }}>
        {['Monthly', 'Every 2 months', 'Every 3 months', 'Every 6 months', 'Yearly'].map((label, i) => (
          <div key={label} style={i === 0 ? S.row : { ...S.row, ...S.rowRule }}>
            <button type="button" style={S.rowButton} onClick={onClose}>
              {label}
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  )
}
