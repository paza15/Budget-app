import { useLayoutEffect, useRef, useState } from 'react'
import type { SheetProps } from '@/app/nav'
import { withUndo } from '@/app/undo'
import { CATEGORY_ICONS, EMOJI_CHOICES } from '@/domain/catalog'
import { MAX_CENTS, MAX_LENGTHS } from '@/domain/constants'
import { localDateOf } from '@/domain/dates'
import type { Cents, IconRef, SavingsGoal } from '@/domain/types'
import styles from '@/features/wallet/GoalSheet.module.css'
import { goalSheetFooter, moneyText, shortDate } from '@/features/wallet/walletText'
import { actions } from '@/store/actions'
import { useData, useMoneyFormat, useWallet } from '@/store/hooks'
import { useToday } from '@/store/today'
import {
  AmountField,
  CategoryIcon,
  Coin,
  COIN_GLYPH_SIZE,
  EmptyState,
  IconPicker,
  isEmojiIcon,
  ListRow,
  Section,
  SheetHeader,
  TextField,
  toast,
} from '@/ui'

/**
 * A savings goal (docs/SPEC.md §3.14, DESIGN.md §9.26 "The goal sheet"): name (max 24), icon
 * (IconPicker, in the sheet's own second view), target (1..MAX_CENTS). An existing goal also has
 * "Mark as done" (it leaves the fill order and waits under Done) and "Delete goal", both through
 * withUndo; deleting a goal never deletes money, so it asks nothing first.
 */

interface GoalForm {
  name: string
  icon: IconRef
  /** null while the field is empty. */
  target: Cents | null
}

/** A new goal starts with the piggy bank (DESIGN.md §9.26). */
const NEW_GOAL_ICON = 'piggy-bank'

function isDirty(form: GoalForm, initial: GoalForm): boolean {
  return form.name.trim() !== initial.name.trim() || form.icon !== initial.icon || form.target !== initial.target
}

/** What VoiceOver hears for the chosen symbol: the icon's name, or the emoji. */
function iconName(icon: IconRef): string {
  if (isEmojiIcon(icon)) return icon
  return CATEGORY_ICONS.find((option) => option.key === icon)?.name ?? icon
}

function showError(): void {
  toast({ message: "Couldn't save this goal. Check its name and target, then try again.", tone: 'critical' })
}

function showDeleteError(): void {
  toast({ message: "Couldn't delete this goal. Open it again from the Wallet and try once more.", tone: 'critical' })
}

export function GoalSheet({ route, onClose, setDirty }: SheetProps<'goal'>) {
  const goals = useData((d) => d.wallet.goals)
  const goal = route.id === undefined ? null : (goals.find((item) => item.id === route.id) ?? null)
  // A goal deleted while its sheet is open (an Undo from the toast) leaves nothing to edit.
  if (route.id !== undefined && goal === null) return <MissingGoal onClose={onClose} />
  return <GoalEditor key={goal?.id ?? 'new'} goal={goal} onClose={onClose} setDirty={setDirty} />
}

interface GoalEditorProps {
  goal: SavingsGoal | null
  onClose(): void
  setDirty(dirty: boolean): void
}

function GoalEditor({ goal, onClose, setDirty }: GoalEditorProps) {
  const money = useMoneyFormat()
  const wallet = useWallet()
  const locale = useData((d) => d.settings.locale)
  const today = useToday()
  const [initial] = useState<GoalForm>(() =>
    goal === null ? { name: '', icon: NEW_GOAL_ICON, target: null } : { name: goal.name, icon: goal.icon, target: goal.target },
  )
  const [form, setForm] = useState(initial)
  /** While the icon picker shows: the icon from before it opened, which Cancel puts back. */
  const [iconBefore, setIconBefore] = useState<IconRef | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  /** Where focus goes once the view has switched (set by the handlers that switch it). */
  const focusNext = useRef<'picker' | 'icon' | null>(null)
  const picking = iconBefore !== null

  const name = form.name.trim()
  const target = form.target
  const valid = name !== '' && target !== null && target >= 1 && target <= MAX_CENTS
  const dirty = isDirty(form, initial)

  const update = (next: GoalForm) => {
    setForm(next)
    setDirty(isDirty(next, initial))
  }

  const openPicker = () => {
    focusNext.current = 'picker'
    setIconBefore(form.icon)
  }

  const closePicker = (keep: boolean) => {
    if (!keep && iconBefore !== null) update({ ...form, icon: iconBefore })
    focusNext.current = 'icon'
    setIconBefore(null)
  }

  // A view switch starts at the top of the sheet, with focus on the chosen icon (picker) or back
  // on the Icon row (form), so neither keyboard nor VoiceOver users are dropped. It runs after
  // every render and acts only when a switch asked for it.
  useLayoutEffect(() => {
    const view = viewRef.current
    const next = focusNext.current
    if (next === null || view === null) return
    focusNext.current = null
    view.scrollIntoView?.({ block: 'start' })
    // The picker's last checked radio is the chosen glyph or emoji (the first is its Icons | Emoji tab).
    const focusTarget =
      next === 'picker'
        ? ([...view.querySelectorAll<HTMLElement>('input[type="radio"]:checked')].at(-1) ?? view.querySelector<HTMLElement>('input, button'))
        : view.querySelector<HTMLElement>('[data-testid="goal-icon"] button')
    focusTarget?.focus({ preventScroll: true })
    // The chosen glyph may sit further down the grid: bring it just into view.
    if (next === 'picker') focusTarget?.closest('label')?.scrollIntoView?.({ block: 'nearest' })
  })

  const save = () => {
    if (!valid || target === null) return
    try {
      if (goal === null) actions.addGoal({ name, icon: form.icon, target })
      else actions.updateGoal(goal.id, { name, icon: form.icon, target })
    } catch {
      showError()
      return
    }
    onClose()
  }

  const markDone = () => {
    if (goal === null) return
    const label = valid ? name : goal.name
    // Edits made before "Mark as done" are kept with it, and one Undo takes both back.
    withUndo(`Marked ${label} as done`, () => {
      if (dirty && valid && target !== null) actions.updateGoal(goal.id, { name, icon: form.icon, target })
      actions.setGoalDone(goal.id, true)
    }).catch(showError)
    onClose()
  }

  const putBack = () => {
    if (goal !== null) actions.setGoalDone(goal.id, false)
  }

  const remove = () => {
    if (goal === null) return
    withUndo(`Deleted ${goal.name}`, () => actions.deleteGoal(goal.id)).catch(showDeleteError)
    onClose()
  }

  if (picking) {
    return (
      <div ref={viewRef}>
        <SheetHeader title="Icon" onCancel={() => closePicker(false)} action={{ label: 'Done', onClick: () => closePicker(true) }} />
        <div className={styles.picker}>
          <IconPicker
            value={form.icon}
            onChange={(icon) => update({ ...form, icon })}
            icons={CATEGORY_ICONS}
            emojis={EMOJI_CHOICES}
            data-testid="goal-icon-picker"
          />
        </div>
      </div>
    )
  }

  const index = goal === null ? -1 : wallet.goals.findIndex((state) => state.goal.id === goal.id)
  const footer =
    goal === null
      ? 'New goals fill last. Move them up on the Wallet.'
      : goal.doneAt !== null
        ? `Done on ${shortDate(localDateOf(goal.doneAt), today, locale)}. It takes no money until you put it back.`
        : goalSheetFooter(money, wallet.goals, index)
  const targetError = target === 0 ? `The target must be above ${moneyText(money, 0)}. Enter a larger amount.` : undefined

  return (
    <div ref={viewRef}>
      <SheetHeader
        title={goal === null ? 'New goal' : goal.name}
        onCancel={onClose}
        action={{ label: goal === null ? 'Add' : 'Save', onClick: save, disabled: !valid, 'data-testid': 'sheet-save' }}
      />
      <Section context="sheet" className={styles.first} footer={footer}>
        <TextField
          variant="form"
          label="Name"
          value={form.name}
          onChange={(value) => update({ ...form, name: value })}
          maxLength={MAX_LENGTHS.name}
          placeholder="Required"
          enterKeyHint="done"
          data-testid="goal-name"
        />
        <ListRow
          title="Icon"
          detail={
            <Coin size="sm" className={styles.iconCoin}>
              <CategoryIcon icon={form.icon} size={COIN_GLYPH_SIZE.sm} />
            </Coin>
          }
          chevron
          label={`Icon, ${iconName(form.icon)}`}
          onClick={openPicker}
          data-testid="goal-icon"
        />
        <AmountField
          label="Target"
          value={target}
          onChange={(value) => update({ ...form, target: value })}
          error={targetError}
          data-testid="goal-target"
        />
      </Section>
      {goal !== null && goal.doneAt === null && (
        <Section
          context="sheet"
          className={styles.next}
          footer="For when you have reached it or bought it. It stops taking money and moves to Done."
        >
          <ListRow title="Mark as done" tinted onClick={markDone} />
        </Section>
      )}
      {goal !== null && goal.doneAt !== null && (
        <Section context="sheet" className={styles.next} footer="It fills again from the place it had in your goals.">
          <ListRow title="Put back" tinted onClick={putBack} />
        </Section>
      )}
      {goal !== null && (
        <Section context="sheet" className={styles.next}>
          <ListRow title="Delete goal" destructive onClick={remove} />
        </Section>
      )}
    </div>
  )
}

/** The edited goal is gone (deleted elsewhere, or an Undo took it back). */
function MissingGoal({ onClose }: { onClose(): void }) {
  return (
    <>
      <SheetHeader title="Goal" onCancel={onClose} cancelLabel="Close" />
      <EmptyState icon="wallet" title="This goal was deleted" message="There is nothing left to edit. Your wallet's money is untouched." />
    </>
  )
}
