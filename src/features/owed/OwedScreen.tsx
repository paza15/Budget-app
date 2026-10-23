import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNav, type NavState, type RouteProps, type TabId } from '@/app/nav'
import { withUndo } from '@/app/undo'
import { formatDate } from '@/domain/dates'
import type { MoneyFormat } from '@/domain/money'
import { categoryDisplay } from '@/domain/queries'
import type { Category, Cents, Transaction } from '@/domain/types'
import {
  focusAfterItem,
  focusAfterPerson,
  owedSentence,
  owedView,
  settledItems,
  settledText,
  withoutItem,
  withoutPerson,
  type FocusKey,
  type OwedPersonView,
  type OwedRowView,
  type SettledItem,
} from '@/features/owed/owedModel'
import styles from '@/features/owed/OwedScreen.module.css'
import { PersonCoin } from '@/features/owed/PersonCoin'
import { useCollapse } from '@/features/owed/useCollapse'
import { actions } from '@/store/actions'
import { useCategoryMap, useData, useMoneyFormat, useOwed, useSettings } from '@/store/hooks'
import {
  CategoryBadge,
  confirmDialog,
  EmptyState,
  ListRow,
  Money,
  Screen,
  TotalFigure,
  withTrueMinus,
} from '@/ui'

/** The roots' titles, for the back capsule of a screen pushed straight onto a tab. */
const TAB_TITLES: Readonly<Record<TabId, string>> = { home: 'Home', daily: 'Daily', fixed: 'Fixed', wallet: 'Wallet' }

/**
 * The title of the screen under this one, for "‹ Home" or "‹ Settings" (EXTRAS.md §2.7). Read once
 * when the screen mounts: it is on top then, and what lies under it never changes while it lives.
 */
function backLabelOf(nav: NavState): string {
  const stack = nav.stacks[nav.tab]
  const index = stack.findLastIndex((route) => route.name === 'owed')
  const below = index > 0 ? stack[index - 1] : undefined
  if (below === undefined) return TAB_TITLES[nav.tab]
  return below.name === 'you' ? 'Settings' : 'Back'
}

function goBack(): void {
  useNav.getState().pop()
}

function renderMoney(cents: Cents): ReactNode {
  return <Money cents={cents} />
}

function renderTotal(cents: Cents): ReactNode {
  return <TotalFigure cents={cents} />
}

/** An amount as VoiceOver says it: the formatted amount, or "amount hidden". */
function spoken(money: MoneyFormat, cents: Cents): string {
  return money.masked ? 'amount hidden' : withTrueMinus(money.format(cents))
}

/**
 * "Owed to you" (route 'owed', docs/SPEC.md §3.16, docs/design/EXTRAS.md §2.7): what people still
 * owe you from split bills, grouped by person, largest total first, newest bill first within a
 * person. Each item can be marked "Paid back" or forgiven (after a confirmation); "Mark all as paid"
 * settles a person at once. Every change offers Undo. Settled splits wait, collapsed, under
 * "Settled". Items that leave collapse in place while the totals change. With the route's `person`
 * (a person row of the Home card) it opens scrolled to that person.
 */
export function OwedScreen({ person: scrollTo }: RouteProps<'owed'>) {
  const owed = useOwed()
  const transactions = useData((d) => d.transactions)
  const categoryMap = useCategoryMap()
  const { locale } = useSettings()
  const money = useMoneyFormat()
  const [backLabel] = useState(() => backLabelOf(useNav.getState()))
  const [settledOpen, setSettledOpen] = useState(false)
  // What is drawn: the open splits plus those that just left, still collapsing. useOwed returns a
  // new object after any change; the view follows it during render.
  const [view, setView] = useState(() => ({ source: owed, people: owedView(owed.people) }))
  if (view.source !== owed) setView({ source: owed, people: owedView(owed.people, view.people) })
  const people = view.people

  const byId = useMemo(() => new Map(transactions.map((tx) => [tx.id, tx])), [transactions])
  const settled = useMemo(() => settledItems(transactions), [transactions])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // Opened from a person on the Home card: start at that person (EXTRAS.md §2.6). A screen's route
  // never changes, so this runs once, before the first paint.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const content = contentRef.current
    if (scrollTo === undefined || scroller === null || content === null) return
    const section = [...content.querySelectorAll<HTMLElement>('[data-person]')].find((el) => el.dataset.person === scrollTo)
    if (section === undefined) return
    // The nav row stays pinned at the top of the scroller (Screen's sticky header).
    const nav = scroller.querySelector<HTMLElement>(':scope > header')
    const gap = Number.parseFloat(getComputedStyle(section).marginTop) || 0
    const offset = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top - (nav?.offsetHeight ?? 0) - gap
    scroller.scrollTop = Math.max(0, scroller.scrollTop + offset)
  }, [scrollTo])

  /** Moves focus once the change has been drawn (the dialog of Forgive has given it back by then). */
  const focusLater = (key: FocusKey) => {
    requestAnimationFrame(() => {
      const targets = contentRef.current?.querySelectorAll<HTMLElement>('[data-focus-key]') ?? []
      for (const target of targets) {
        if (target.dataset.focusKey === key) {
          target.focus()
          return
        }
      }
    })
  }

  const paidBack = (person: OwedPersonView, row: OwedRowView) => {
    const target = focusAfterItem(people, person.key, row.key)
    const { transactionId, splitId, amount } = row.item
    withUndo(`${person.person} paid back ${money.format(amount)}`, () =>
      actions.setSplitStatus(transactionId, splitId, 'paid'),
    ).then(
      () => focusLater(target),
      // The split went meanwhile (an Undo elsewhere): nothing to do.
      () => {},
    )
  }

  const forgive = (person: OwedPersonView, row: OwedRowView) => {
    const target = focusAfterItem(people, person.key, row.key)
    const { transactionId, splitId, amount } = row.item
    const words = money.format(amount)
    // Primary, not destructive: nothing is deleted, and Undo follows (EXTRAS.md §2.7).
    confirmDialog({
      title: `Forgive ${words}?`,
      message: 'It counts as your own spending again.',
      confirmLabel: 'Forgive',
      cancelLabel: 'Cancel',
    })
      .then(async (confirmed) => {
        if (!confirmed) return
        await withUndo(`Forgave ${person.person} ${words}`, () => actions.setSplitStatus(transactionId, splitId, 'forgiven'))
        focusLater(target)
      })
      .catch(() => {})
  }

  const markAll = (person: OwedPersonView) => {
    const rows = person.items.filter((row) => !row.leaving)
    const target = focusAfterPerson(people, person.key)
    withUndo(`${person.person} paid back ${money.format(person.total)}`, () => {
      for (const row of rows) actions.setSplitStatus(row.item.transactionId, row.item.splitId, 'paid')
    }).then(
      () => focusLater(target),
      () => {},
    )
  }

  const personLeft = (personKey: string) => setView((v) => ({ ...v, people: withoutPerson(v.people, personKey) }))
  const itemLeft = (personKey: string, itemKey: string) =>
    setView((v) => ({ ...v, people: withoutItem(v.people, personKey, itemKey) }))

  const open = people.length > 0
  return (
    <Screen
      title="Owed to you"
      titleContent={
        <p className={styles.title} aria-hidden="true">
          Owed to you
        </p>
      }
      onBack={goBack}
      backLabel={backLabel}
      compactSubtitle={owed.total > 0 ? <Money cents={owed.total} /> : undefined}
      scrollRef={scrollerRef}
    >
      <div ref={contentRef}>
        {open ? (
          <>
            <div className={styles.summary}>
              <p className={styles.total} data-testid="owed-total">
                <span className="visually-hidden">{spoken(money, owed.total)}</span>
                <Crossfade value={owed.total} align="start" render={renderTotal} />
              </p>
              <p className={styles.sentence}>{owedSentence(owed.people)}</p>
            </div>
            {people.map((person) => (
              <PersonSection
                key={person.key}
                person={person}
                byId={byId}
                categoryMap={categoryMap}
                locale={locale}
                money={money}
                onPaidBack={paidBack}
                onForgive={forgive}
                onMarkAll={markAll}
                onPersonLeft={personLeft}
                onItemLeft={itemLeft}
              />
            ))}
          </>
        ) : (
          <div className={styles.empty} tabIndex={-1} data-focus-key="empty">
            <EmptyState
              icon="owed"
              title="Nobody owes you anything"
              message="When you split a bill, what others owe you shows up here."
            />
          </div>
        )}
        {settled.length > 0 && (
          <Settled
            items={settled}
            open={settledOpen}
            onToggle={() => setSettledOpen((value) => !value)}
            categoryMap={categoryMap}
            locale={locale}
          />
        )}
        {(open || settled.length > 0) && (
          <p className={styles.footer}>
            Your budget counts only your share. Forgiving a split counts it as your own spending again.
          </p>
        )}
      </div>
    </Screen>
  )
}

interface CrossfadeProps {
  value: Cents
  /** Draws a value; the old and the new one are drawn the same way. */
  render(value: Cents): ReactNode
  /** Which edge the two values share: the start (the screen total) or the end (a person's total). */
  align: 'start' | 'end'
}

/**
 * A total that crossfades to its new value (EXTRAS.md §2.9): the old value fades out over
 * --dur-fade where it stood while the new one fades in on top of it. Nothing moves on the first
 * draw. Decorative: the screen says the amount in words beside it.
 *
 * The old value leaves when its fade ends, and also when the fade is cancelled: display: none (a
 * screen pushed over this one, another tab) stops a running animation without an animationend,
 * and the old value would otherwise stay, invisible, in the cell until the next change. React has
 * no animationcancel prop, so the outgoing value listens for it itself.
 */
function Crossfade({ value, render, align }: CrossfadeProps) {
  const [shown, setShown] = useState<{ value: Cents; previous: Cents | null; changes: number }>({
    value,
    previous: null,
    changes: 0,
  })
  if (shown.value !== value) setShown({ value, previous: shown.value, changes: shown.changes + 1 })
  const { changes } = shown
  const settle = useCallback(
    () => setShown((current) => (current.changes === changes ? { ...current, previous: null } : current)),
    [changes],
  )
  const onCancel = useCallback(
    (element: HTMLSpanElement | null) => {
      if (element === null) return undefined
      element.addEventListener('animationcancel', settle)
      return () => element.removeEventListener('animationcancel', settle)
    },
    [settle],
  )
  return (
    <span className={align === 'end' ? styles.crossfadeEnd : styles.crossfade} aria-hidden="true">
      {shown.previous !== null && (
        <span
          key={`out-${changes}`}
          ref={onCancel}
          className={styles.fadeOut}
          onAnimationEnd={settle}
          data-crossfade="out"
        >
          {render(shown.previous)}
        </span>
      )}
      <span key={`in-${changes}`} className={changes > 0 ? styles.fadeIn : undefined} data-crossfade="in">
        {render(value)}
      </span>
    </span>
  )
}

interface PersonSectionProps {
  person: OwedPersonView
  byId: ReadonlyMap<string, Transaction>
  categoryMap: Readonly<Record<string, Category>>
  locale: string
  money: MoneyFormat
  onPaidBack(person: OwedPersonView, row: OwedRowView): void
  onForgive(person: OwedPersonView, row: OwedRowView): void
  onMarkAll(person: OwedPersonView): void
  onPersonLeft(personKey: string): void
  onItemLeft(personKey: string, itemKey: string): void
}

/** One person: a section headed "Max, 17,00 €" with the bills they still owe for. */
function PersonSection({
  person,
  byId,
  categoryMap,
  locale,
  money,
  onPaidBack,
  onForgive,
  onMarkAll,
  onPersonLeft,
  onItemLeft,
}: PersonSectionProps) {
  const headingId = useId()
  const ref = useCollapse<HTMLElement>(person.leaving, () => onPersonLeft(person.key))
  const staying = person.items.filter((row) => !row.leaving)
  return (
    <section
      ref={ref}
      className={styles.person}
      aria-labelledby={headingId}
      inert={person.leaving}
      data-leaving={person.leaving || undefined}
      data-person={person.key}
      data-testid="owed-person-section"
      data-id={person.key}
    >
      {/* The heading's name is one string, "Max, 17,00 €" (EXTRAS.md §2.8): read from its flex
          children, Chromium would put a space before the comma. */}
      <h2
        id={headingId}
        className={styles.personHeader}
        aria-label={`${person.person}, ${spoken(money, person.total)}`}
        tabIndex={-1}
        data-focus-key={`person:${person.key}`}
      >
        <PersonCoin name={person.person} size="sm" />
        <span className={styles.personName}>{person.person}</span>
        <span className={styles.personTotal}>
          <Crossfade value={person.total} align="end" render={renderMoney} />
        </span>
      </h2>
      <div className={styles.group}>
        {person.items.map((row) => (
          <OwedItemRow
            key={row.key}
            row={row}
            person={person}
            tx={byId.get(row.item.transactionId)}
            categoryMap={categoryMap}
            locale={locale}
            money={money}
            onPaidBack={onPaidBack}
            onForgive={onForgive}
            onLeft={onItemLeft}
          />
        ))}
        {staying.length > 1 && (
          <button
            type="button"
            className={styles.markAll}
            data-row=""
            onClick={() => onMarkAll(person)}
            data-testid="owed-all"
          >
            Mark all as paid
          </button>
        )}
      </div>
    </section>
  )
}

interface OwedItemRowProps {
  row: OwedRowView
  person: OwedPersonView
  /** The bill; missing only in damaged data. */
  tx: Transaction | undefined
  categoryMap: Readonly<Record<string, Category>>
  locale: string
  money: MoneyFormat
  onPaidBack(person: OwedPersonView, row: OwedRowView): void
  onForgive(person: OwedPersonView, row: OwedRowView): void
  onLeft(personKey: string, itemKey: string): void
}

/**
 * One bill a person owes for: the bill's coin, its note (or category) and what this person owes,
 * the date and "of {bill}", then "Paid back" and "Forgive". Both buttons keep their visible names
 * and are described by the item, so VoiceOver reads "Paid back, button, Bar with friends, 9,00 €".
 */
function OwedItemRow({ row, person, tx, categoryMap, locale, money, onPaidBack, onForgive, onLeft }: OwedItemRowProps) {
  const descriptionId = useId()
  const ref = useCollapse<HTMLDivElement>(row.leaving, () => onLeft(person.key, row.key))
  const category = categoryDisplay(tx?.categoryId ?? null, categoryMap)
  const title = row.item.note.trim() || category.name
  return (
    <div
      ref={ref}
      className={styles.item}
      data-row="coin"
      inert={row.leaving}
      data-leaving={row.leaving || undefined}
      data-testid="owed-item"
      data-id={row.key}
    >
      <CategoryBadge icon={category.icon} color={category.color} className={styles.itemCoin} />
      <div className={styles.itemMain}>
        <p className={styles.itemLine1}>
          <span className={styles.itemTitle}>{title}</span>
          <span className={styles.itemAmount}>
            <Money cents={row.item.amount} />
          </span>
        </p>
        <p className={styles.itemLine2}>
          <span>{formatDate(row.item.date, locale, 'medium')}</span>
          {tx !== undefined && (
            <span className={styles.of}>
              {'of '}
              <Money cents={tx.amount} />
            </span>
          )}
        </p>
        <span id={descriptionId} hidden>
          {`${title}, ${spoken(money, row.item.amount)}`}
        </span>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.paidBack}
            aria-describedby={descriptionId}
            onClick={() => onPaidBack(person, row)}
            data-focus-key={`paid:${row.key}`}
            data-testid="owed-paid"
          >
            Paid back
          </button>
          <button
            type="button"
            className={styles.forgive}
            aria-describedby={descriptionId}
            onClick={() => onForgive(person, row)}
            data-testid="owed-forgive"
          >
            Forgive
          </button>
        </div>
      </div>
    </div>
  )
}

interface SettledProps {
  items: SettledItem[]
  open: boolean
  onToggle(): void
  categoryMap: Readonly<Record<string, Category>>
  locale: string
}

/**
 * Splits that were paid back or forgiven, collapsed under one disclosure row (the same row as the
 * Wallet's "Done" goals). Open, each is a row without actions, its amount in --ink-2.
 */
function Settled({ items, open, onToggle, categoryMap, locale }: SettledProps) {
  const listId = useId()
  const count = items.length.toLocaleString(locale)
  return (
    <div className={styles.settled}>
      <ListRow
        title="Settled"
        detail={count}
        chevron="down"
        expanded={open}
        controls={open ? listId : undefined}
        label={`Settled, ${count}`}
        onClick={onToggle}
        data-testid="owed-settled"
      />
      {open && (
        <div id={listId} className={styles.settledList} data-row="">
          {items.map((item) => {
            const category = categoryDisplay(item.categoryId, categoryMap)
            return (
              <ListRow
                key={item.key}
                leading={<CategoryBadge icon={category.icon} color={category.color} />}
                title={item.note.trim() || category.name}
                value={<Money cents={item.amount} />}
                valueTone="muted"
                subtitle={settledText(item, locale)}
                note={
                  <>
                    {'of '}
                    <Money cents={item.bill} />
                  </>
                }
                className={styles.settledRow}
                data-testid="owed-settled-item"
                data-id={item.key}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
