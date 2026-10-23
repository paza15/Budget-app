import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useNav } from '@/app/nav'
import { localDateOf } from '@/domain/dates'
import type { SavingsGoal } from '@/domain/types'
import type { GoalState } from '@/domain/wallet'
import { cx } from '@/features/wallet/classes'
import styles from '@/features/wallet/Goals.module.css'
import { movedGoalOrder } from '@/features/wallet/goalOrder'
import { cssEasing, cssTime, fadeIn, play } from '@/features/wallet/motion'
import {
  doneGoalSubtitle,
  goalLabel,
  goalPhase,
  goalPhaseWords,
  moveAnnouncement,
  type GoalPhase,
} from '@/features/wallet/walletText'
import { actions } from '@/store/actions'
import { getData } from '@/store/appStore'
import { useData, useMoneyFormat } from '@/store/hooks'
import { useToday } from '@/store/today'
import { CategoryIcon, Coin, COIN_GLYPH_SIZE, Engraving, Icon, IconButton, ListRow, Meter, Money, Section, useReducedMotion } from '@/ui'

/**
 * The Wallet's goals (docs/SPEC.md §3.14, DESIGN.md §9.26 "Goals"): the balance fills them from the
 * top, so each row shows what it holds, a meter and where it stands, with buttons that move it up
 * or down the fill order; "Add a goal" ends the group. Done goals wait in a collapsed group with
 * "Put back", which returns a goal to the place it had.
 */

type Direction = 'up' | 'down'

/** A move in progress: what to focus once the list has re-rendered, and where each row was. */
interface PendingMove {
  id: string
  direction: Direction
  tops: Map<string, number>
}

/** Where focus goes after "Put back" took a row away. */
type PendingFocus = { kind: 'putBack'; id: string } | { kind: 'goal'; id: string }

export interface GoalsSectionProps {
  /** Active goals in fill order (walletSummary). */
  goals: GoalState[]
  /** Done goals, most recently done first (walletSummary). */
  doneGoals: SavingsGoal[]
}

function openGoal(id?: string): void {
  useNav.getState().openSheet(id === undefined ? { name: 'goal' } : { name: 'goal', id })
}

/** The goal rows inside `root`, in document order. */
function goalRows(root: HTMLElement | null): HTMLElement[] {
  return root === null ? [] : [...root.querySelectorAll<HTMLElement>('[data-goal-row]')]
}

export function GoalsSection({ goals, doneGoals }: GoalsSectionProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const pendingMove = useRef<PendingMove | null>(null)
  const pendingFocus = useRef<PendingFocus | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const reduceMotion = useReducedMotion()

  const move = (state: GoalState, direction: Direction) => {
    const index = goals.indexOf(state)
    const ids = movedGoalOrder(getData().wallet.goals, goals, state.goal.id, direction)
    if (index < 0 || ids === null) return
    const tops = new Map<string, number>()
    for (const row of goalRows(rootRef.current)) tops.set(row.dataset.goalRow ?? '', row.getBoundingClientRect().top)
    pendingMove.current = { id: state.goal.id, direction, tops }
    actions.reorderGoals(ids)
    // The goal now above it: two places up after a move up, the neighbour it passed after a move down.
    const above = direction === 'up' ? goals[index - 2] : goals[index + 1]
    const text = moveAnnouncement(state.goal.name, above?.goal.name)
    // The same words twice in a row would not be read again, so the second copy differs invisibly.
    setAnnouncement((previous) => (previous === text ? `${text} ` : text))
  }

  const putBack = (goal: SavingsGoal) => {
    const index = doneGoals.indexOf(goal)
    const neighbour = doneGoals[index + 1] ?? doneGoals[index - 1]
    pendingFocus.current = neighbour ? { kind: 'putBack', id: neighbour.id } : { kind: 'goal', id: goal.id }
    actions.setGoalDone(goal.id, false)
  }

  // After a move: focus stays on the button used; when the move took the goal to an end, where
  // that button is gone, it goes to the goal's other button. The two rows trade places with a
  // transform over --dur-fade (none with Reduce Motion). Like the effect below, it runs after
  // every render and acts only when a handler left it something to do.
  useLayoutEffect(() => {
    const pending = pendingMove.current
    const root = rootRef.current
    if (pending === null || root === null) return
    pendingMove.current = null
    const rows = goalRows(root)
    const row = rows.find((element) => element.dataset.goalRow === pending.id)
    const button =
      row?.querySelector<HTMLElement>(`[data-direction="${pending.direction}"]`) ?? row?.querySelector<HTMLElement>('[data-direction]')
    if (button && document.activeElement !== button) button.focus()
    if (reduceMotion) return
    const duration = cssTime(root, '--dur-fade', 200)
    const easing = cssEasing(root, '--ease-standard')
    for (const element of rows) {
      const before = pending.tops.get(element.dataset.goalRow ?? '')
      if (before === undefined) continue
      const shift = before - element.getBoundingClientRect().top
      if (Math.abs(shift) < 0.5) continue
      play(element, [{ transform: `translateY(${shift}px)` }, { transform: 'none' }], { duration, easing })
    }
  })

  // After "Put back": the next done goal's "Put back", or the goal itself back in the list.
  useLayoutEffect(() => {
    const pending = pendingFocus.current
    const root = rootRef.current
    if (pending === null || root === null) return
    pendingFocus.current = null
    const selector = pending.kind === 'putBack' ? '[data-put-back]' : '[data-goal-open]'
    const target = [...root.querySelectorAll<HTMLElement>(selector)].find(
      (element) => (pending.kind === 'putBack' ? element.dataset.putBack : element.dataset.goalOpen) === pending.id,
    )
    target?.focus()
  })

  return (
    <div ref={rootRef}>
      <Section
        title="Goals"
        footer={goals.length > 0 ? 'Your wallet fills goals from the top.' : 'Saving for something? Add it here and your wallet fills it.'}
        data-testid="wallet-goals"
      >
        {goals.length > 0 && (
          // An explicit role: Safari drops list semantics from lists styled without bullets.
          // oxlint-disable-next-line jsx-a11y/no-redundant-roles
          <ul role="list" aria-label="Goals, filled from the top" className={styles.list}>
            {goals.map((state, index) => (
              <GoalRow
                key={state.goal.id}
                state={state}
                phase={goalPhase(goals, index)}
                first={index === 0}
                last={index === goals.length - 1}
                onMove={move}
              />
            ))}
          </ul>
        )}
        <button type="button" className={styles.add} onClick={() => openGoal()} data-testid="goal-add">
          <Icon name="plus-circle" size={22} className={styles.addIcon} />
          <span>Add a goal</span>
        </button>
      </Section>
      {doneGoals.length > 0 && <DoneGoals goals={doneGoals} onPutBack={putBack} />}
      {/* Polite: "New bike fills first now" after a move. */}
      <output className="visually-hidden">{announcement}</output>
    </div>
  )
}

interface GoalRowProps {
  state: GoalState
  phase: GoalPhase
  first: boolean
  last: boolean
  onMove(state: GoalState, direction: Direction): void
}

function GoalRow({ state, phase, first, last, onMove }: GoalRowProps) {
  const money = useMoneyFormat()
  const { goal, filled, reached } = state
  const sealRef = useRef<HTMLSpanElement>(null)
  const wasReached = useRef(reached)

  // A goal that becomes full shows its seal with a fade over --dur-stamp, never a scale
  // (engravings never move); on first render the seal is simply there.
  useLayoutEffect(() => {
    if (reached && !wasReached.current && sealRef.current !== null) fadeIn(sealRef.current, '--dur-stamp')
    wasReached.current = reached
  }, [reached])

  const words = goalPhaseWords(phase)
  return (
    <li className={styles.goal} data-goal-row={goal.id} data-testid="goal-row" data-id={goal.id} data-phase={phase.kind}>
      {/* The row is one button (coin, lines and meter) under the order column; its name carries the words. */}
      <button
        type="button"
        className={styles.open}
        aria-label={goalLabel(money, state, phase)}
        onClick={() => openGoal(goal.id)}
        data-goal-open={goal.id}
        data-testid="goal-open"
      />
      <Coin size="md" className={styles.coin}>
        <CategoryIcon icon={goal.icon} size={COIN_GLYPH_SIZE.md} />
      </Coin>
      <div className={styles.main} aria-hidden="true">
        <span className={styles.line1}>
          <span className={styles.name}>{goal.name}</span>
          <Money cents={filled} className={styles.held} />
        </span>
        <Meter value={filled} max={goal.target} status="ok" label={`${goal.name} goal`} showStatus={false} />
        <span className={styles.line3}>
          <span className={styles.state}>
            {phase.kind === 'reached' && (
              <span ref={sealRef} className={styles.seal}>
                <Engraving kind="seal" size={22} />
              </span>
            )}
            {phase.kind === 'filling' ? (
              <span>
                <Money cents={phase.toGo} /> to go
              </span>
            ) : (
              <span className={styles.stateText}>{words}</span>
            )}
          </span>
          <span className={styles.of}>
            of <Money cents={goal.target} />
          </span>
        </span>
      </div>
      <div className={styles.order}>
        {first ? (
          <span />
        ) : (
          <IconButton
            icon="arrow-up"
            iconSize={17}
            label={`Fill ${goal.name} sooner`}
            className={cx(styles.orderButton, styles.up)}
            onClick={() => onMove(state, 'up')}
            data-direction="up"
            data-testid="goal-up"
          />
        )}
        {last ? (
          <span />
        ) : (
          <IconButton
            icon="arrow-down"
            iconSize={17}
            label={`Fill ${goal.name} later`}
            className={cx(styles.orderButton, styles.down)}
            onClick={() => onMove(state, 'down')}
            data-direction="down"
            data-testid="goal-down"
          />
        )}
      </div>
    </li>
  )
}

interface DoneGoalsProps {
  goals: SavingsGoal[]
  onPutBack(goal: SavingsGoal): void
}

/** "Done" (DESIGN.md §9.26): collapsed when it appears; open, each done goal with "Put back". */
function DoneGoals({ goals, onPutBack }: DoneGoalsProps) {
  const money = useMoneyFormat()
  const locale = useData((d) => d.settings.locale)
  const today = useToday()
  const [open, setOpen] = useState(false)
  const listId = useId()
  return (
    <Section className={styles.doneSection} data-testid="wallet-done">
      <ListRow
        title="Done"
        detail={goals.length}
        chevron="down"
        expanded={open}
        controls={open ? listId : undefined}
        label={`Done, ${goals.length}`}
        onClick={() => setOpen((value) => !value)}
        data-testid="goals-done"
      />
      {open && (
        // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari drops list semantics without bullets
        <ul role="list" id={listId} aria-label="Done goals" className={styles.doneList}>
          {goals.map((goal) => (
            <li key={goal.id} className={styles.doneItem} data-testid="goal-done-row" data-id={goal.id}>
              <Coin size="md">
                <CategoryIcon icon={goal.icon} size={COIN_GLYPH_SIZE.md} />
              </Coin>
              <span className={styles.doneMain}>
                <span className={styles.doneName}>{goal.name}</span>
                <span className={styles.doneSub}>
                  {doneGoalSubtitle(money, goal, localDateOf(goal.doneAt ?? goal.createdAt), today, locale)}
                </span>
              </span>
              <button
                type="button"
                className={styles.putBack}
                aria-label={`Put back ${goal.name}`}
                onClick={() => onPutBack(goal)}
                data-put-back={goal.id}
                data-testid="goal-put-back"
              >
                Put back
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
