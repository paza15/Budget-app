/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The book's rows are CSS subgrids, and WebKit drops the
   table semantics of <table>, <tr> and <td> laid out as grids; explicit roles keep VoiceOver's table
   with column headers (DESIGN.md §9.26 Accessibility). */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useNav } from '@/app/nav'
import type { Cents } from '@/domain/types'
import type { WalletMovement } from '@/domain/wallet'
import { cx } from '@/features/wallet/classes'
import { fadeIn } from '@/features/wallet/motion'
import styles from '@/features/wallet/Passbook.module.css'
import {
  bookDate,
  bookFigure,
  broughtForwardLabel,
  movementLabel,
  movementText,
  spokenDate,
} from '@/features/wallet/walletText'
import { useData, useMoneyFormat } from '@/store/hooks'
import { Button, EmptyState, Engraving, Money, Section } from '@/ui'

/**
 * The passbook (docs/SPEC.md §3.12, §4.8; DESIGN.md §9.26 "The passbook"): every movement of the
 * wallet, oldest first, with its date, what it was, the signed amount and the running balance; the
 * last balance is today's and closes the book with the double rule. Month closings carry the brass
 * seal in the date column. Each line is one button that opens what made it.
 */

/** A book longer than this opens on its latest PAGE movements under "Brought forward"… */
const LONG_BOOK = 36
/** …and each tap on "Brought forward" shows this many more. */
const PAGE = 24

const FOOTER = 'When a month closes, its savings and what was left over move here. An overspent month takes the difference out.'

function openSettings(): void {
  useNav.getState().openSheet({ name: 'walletSettings' })
}

/** What a tap on a line opens (DESIGN.md §9.26 movements table). */
function openMovement(movement: WalletMovement): void {
  const nav = useNav.getState()
  switch (movement.kind) {
    case 'opening':
      nav.openSheet({ name: 'walletSettings' })
      return
    case 'month':
      // A closing comes from the month itself, so it is not edited here: Home shows that month.
      if (movement.month !== null) {
        nav.navigate('home')
        nav.setMonth(movement.month)
      }
      return
    case 'deposit':
    case 'withdrawal':
      if (movement.entryId !== null) nav.openSheet({ name: 'walletEntry', id: movement.entryId })
      return
    case 'payment':
      if (movement.transactionId !== null) nav.openSheet({ name: 'transaction', id: movement.transactionId })
  }
}

export interface PassbookProps {
  /** walletSummary's movements, oldest first. */
  movements: WalletMovement[]
}

export function Passbook({ movements }: PassbookProps) {
  const money = useMoneyFormat()
  const startDay = useData((d) => d.settings.monthStartDay)
  const locale = useData((d) => d.settings.locale)
  const [pages, setPages] = useState(1)
  const tableRef = useRef<HTMLDivElement>(null)
  const known = useRef<ReadonlySet<string> | null>(null)
  const refocus = useRef(false)

  // A movement that arrives while the book is open fades in over --dur-fade; nothing slides. The
  // first render shows the book as it is.
  const keys = movements.map((movement) => movement.key).join('\n')
  useLayoutEffect(() => {
    const before = known.current
    known.current = new Set(keys === '' ? [] : keys.split('\n'))
    const table = tableRef.current
    if (before === null || table === null) return
    for (const row of table.querySelectorAll<HTMLElement>('[data-movement]')) {
      if (!before.has(row.dataset.movement ?? '')) fadeIn(row)
    }
  }, [keys])

  // After "Brought forward": focus stays on it while earlier movements remain, else it moves to
  // the first line, so it never drops to the page. It runs after every render and acts only when
  // the tap asked for it.
  useLayoutEffect(() => {
    const table = tableRef.current
    if (!refocus.current || table === null) return
    refocus.current = false
    const target = table.querySelector<HTMLElement>('[data-forward]') ?? table.querySelector<HTMLElement>('[data-movement] button')
    if (target !== null && document.activeElement !== target) target.focus()
  })

  if (movements.length === 0) {
    return (
      <Section title="Passbook" data-testid="wallet-passbook">
        <EmptyState
          icon="wallet"
          title="Your wallet fills up when a month closes"
          message="Whatever you don't spend lands here, and an overspent month takes the difference out."
          action={
            <Button variant="secondary" onClick={openSettings} data-testid="wallet-opening-cta">
              Set an opening balance
            </Button>
          }
          data-testid="wallet-empty"
        />
      </Section>
    )
  }

  const shownCount = movements.length > LONG_BOOK ? Math.min(movements.length, pages * PAGE) : movements.length
  const hidden = movements.length - shownCount
  const forward = hidden > 0 ? movements[hidden - 1] : undefined
  const first = movements[0]
  const closing = movements.at(-1)
  // Movements are in date order, so the book spans years when its ends do.
  const spansYears = first !== undefined && closing !== undefined && first.date.slice(0, 4) !== closing.date.slice(0, 4)

  const rows: ReactNode[] = []
  if (forward !== undefined) {
    rows.push(
      <ForwardRow
        key="forward"
        balance={forward.balance}
        onShowMore={() => {
          refocus.current = true
          setPages((count) => count + 1)
        }}
      />,
    )
  }
  let year = ''
  for (const movement of movements.slice(hidden)) {
    const movementYear = movement.date.slice(0, 4)
    if (spansYears && movementYear !== year) rows.push(<YearRow key={`year-${movementYear}`} year={movementYear} />)
    year = movementYear
    const text = movementText(movement, startDay, locale)
    rows.push(
      <MovementRow
        key={movement.key}
        movement={movement}
        text={text}
        label={movementLabel(money, movement, text, locale, spansYears)}
        closing={movement === closing}
        locale={locale}
        withYear={spansYears}
      />,
    )
  }

  return (
    <Section title="Passbook" footer={FOOTER} data-testid="wallet-passbook">
      <div className={styles.book}>
        <div ref={tableRef} role="table" aria-label="Passbook" className={styles.table}>
          <div role="row" className={styles.head}>
            <span role="columnheader">Date</span>
            <span role="columnheader">Entry</span>
            <span role="columnheader" className={styles.headAmount}>
              Amount
            </span>
            <span role="columnheader" className={styles.headBalance}>
              Balance
            </span>
          </div>
          {rows}
          {/* The column rule before the balances, as on passbook paper. */}
          <i className={styles.rule} aria-hidden="true" />
        </div>
      </div>
    </Section>
  )
}

/** A figure without the unit ("+122,40", "−200,00"), or "•••" named "Amount hidden". */
function Figure({ cents, signed = false }: { cents: Cents; signed?: boolean }) {
  const money = useMoneyFormat()
  if (money.masked) return <Money cents={cents} />
  return <>{bookFigure(money, cents, signed)}</>
}

interface MovementRowProps {
  movement: WalletMovement
  text: string
  label: string
  /** The last line: today's balance, closed by the double rule. */
  closing: boolean
  locale: string
  withYear: boolean
}

function MovementRow({ movement, text, label, closing, locale, withYear }: MovementRowProps) {
  const date = bookDate(movement.date, locale)
  const short = closing && movement.balance < 0
  return (
    <div
      role="row"
      className={cx(styles.row, closing && styles.closing)}
      data-movement={movement.key}
      data-testid="wallet-row"
      data-kind={movement.kind}
      data-id={movement.key}
    >
      <span role="cell" className={cx(styles.date, movement.kind === 'month' && styles.stamp)}>
        {movement.kind === 'month' ? (
          <>
            {/* The stamp: the month settled this line, which is why it cannot be edited here. */}
            <Engraving kind="seal" size={20} className={styles.seal} />
            <span className="visually-hidden">{spokenDate(movement.date, locale, withYear)}</span>
          </>
        ) : date.dayFirst ? (
          <>
            <span className={styles.day}>{date.day}</span> {date.month}
          </>
        ) : (
          <>
            {date.month} <span className={styles.day}>{date.day}</span>
          </>
        )}
      </span>
      <span role="cell" className={styles.entry}>
        <button type="button" className={styles.rowButton} aria-label={label} onClick={() => openMovement(movement)}>
          {text}
        </button>
      </span>
      <span role="cell" className={styles.amount}>
        <Figure cents={movement.amount} signed />
      </span>
      <span role="cell" className={cx(styles.balance, short && styles.short)}>
        <Figure cents={movement.balance} />
      </span>
    </div>
  )
}

/** "Brought forward": the balance before the lines shown; a tap shows 24 earlier ones. */
function ForwardRow({ balance, onShowMore }: { balance: Cents; onShowMore(): void }) {
  const money = useMoneyFormat()
  return (
    <div role="row" className={cx(styles.row, styles.forward)} data-testid="wallet-row" data-kind="forward">
      <span role="cell" className={styles.date} />
      <span role="cell" className={styles.entry}>
        <button
          type="button"
          className={styles.rowButton}
          aria-label={broughtForwardLabel(money, balance)}
          onClick={onShowMore}
          data-forward=""
        >
          Brought forward
        </button>
      </span>
      <span role="cell" className={styles.amount} />
      <span role="cell" className={styles.balance}>
        <Figure cents={balance} />
      </span>
    </div>
  )
}

/** The year at its first movement, in a book that spans years. */
function YearRow({ year }: { year: string }) {
  return (
    <div role="row" className={styles.year} data-testid="wallet-year">
      <span role="cell" aria-colspan={4}>
        {year}
      </span>
    </div>
  )
}
