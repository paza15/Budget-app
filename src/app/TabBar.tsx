import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'
import { newExpenseRoute, useNav, type TabId } from '@/app/nav'
import type { MoneyFormat } from '@/domain/money'
import { addQuickAdd } from '@/features/daily/quickAdd'
import { getData } from '@/store/appStore'
import { chooseDialog, Icon, useMoneyFormatContext, type UiIconName } from '@/ui'
import styles from './TabBar.module.css'

interface TabDefinition {
  tab: TabId
  label: string
  icon: UiIconName
}

/** Tabs left and right of the add button (docs/SPEC.md §3: Home · Daily · (+) · Fixed · Wallet). */
const LEFT_TABS: readonly TabDefinition[] = [
  { tab: 'home', label: 'Home', icon: 'home' },
  { tab: 'daily', label: 'Daily', icon: 'daily' },
]
const RIGHT_TABS: readonly TabDefinition[] = [
  { tab: 'fixed', label: 'Fixed', icon: 'fixed' },
  { tab: 'wallet', label: 'Wallet', icon: 'wallet' },
]

/** A press this long on the add button offers the quick adds (DESIGN.md §9.1). */
const LONG_PRESS_MS = 500

function selectTab(tab: TabId): void {
  useNav.getState().setTab(tab)
}

function TabButton({ tab, label, icon, active }: TabDefinition & { active: boolean }) {
  return (
    <button
      type="button"
      className={styles.tab}
      aria-current={active ? 'page' : undefined}
      data-testid={`tab-${tab}`}
      onClick={() => selectTab(tab)}
    >
      <Icon name={icon} weight={active ? 'fill' : 'regular'} size={25} />
      <span className={styles.label}>{label}</span>
    </button>
  )
}

/** A new expense, in the category on screen (newExpenseRoute, docs/SPEC.md §3.4). */
function openNewExpense(): void {
  useNav.getState().openSheet(newExpenseRoute())
}

/**
 * The quick adds as an action sheet; the chosen one is added at once, dated today, like a tap on
 * Daily's quick-add strip, with the same toast and Undo (docs/SPEC.md §3, §3.3, §3.4). Without
 * quick adds the long press opens a new expense instead, so it never does nothing.
 */
async function offerQuickAdds(money: MoneyFormat): Promise<void> {
  const quickAdds = getData().quickAdds.toSorted((a, b) => a.order - b.order)
  if (quickAdds.length === 0) {
    openNewExpense()
    return
  }
  const choice = await chooseDialog({
    title: 'Quick add',
    // Glyph, label and amount, like the native menu of DESIGN.md §9.1; the glyph is decorative.
    options: quickAdds.map((q) => ({
      value: q.id,
      label: money.masked ? q.label : `${q.label}, ${money.format(q.amount)}`,
      icon: q.icon,
    })),
  })
  // Read again after the answer: the data may have changed while the menu was open.
  const quickAdd = getData().quickAdds.find((q) => q.id === choice)
  if (quickAdd === undefined) return
  // Daily's own quick add: the same expense, toast and Undo as a tap on its strip.
  await addQuickAdd(quickAdd, money)
}

/**
 * The centre (+), "Add expense": a tap opens a new expense; a 500 ms press (or the context menu)
 * offers the quick adds. It scales to 0.94 while pressed.
 */
function AddButton() {
  const money = useMoneyFormatContext()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** The press became a long press, so the click that ends it must not open the sheet as well. */
  const longPress = useRef(false)
  const menuOpen = useRef(false)

  const cancelTimer = (): void => {
    clearTimeout(timer.current)
    timer.current = undefined
  }

  // A press still running when the bar goes away must not open the menu later. The ref holds the
  // timer of the latest press, which is the one to cancel.
  useEffect(() => () => clearTimeout(timer.current), [])

  const longPressed = (): void => {
    longPress.current = true
    cancelTimer()
    if (menuOpen.current) return
    menuOpen.current = true
    offerQuickAdds(money)
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        menuOpen.current = false
      })
  }

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    longPress.current = false
    cancelTimer()
    timer.current = setTimeout(longPressed, LONG_PRESS_MS)
  }

  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    // detail 0: activated from the keyboard or by VoiceOver, never the end of a long press.
    if (longPress.current && event.detail !== 0) {
      longPress.current = false
      return
    }
    longPress.current = false
    openNewExpense()
  }

  return (
    <button
      type="button"
      className={styles.add}
      aria-label="Add expense"
      data-testid="tab-add"
      onPointerDown={onPointerDown}
      onPointerUp={cancelTimer}
      onPointerLeave={cancelTimer}
      onPointerCancel={cancelTimer}
      onContextMenu={(event) => {
        // Android and desktop long presses arrive as a context menu; iOS suppresses its callout.
        event.preventDefault()
        longPressed()
      }}
      onClick={onClick}
    >
      <Icon name="plus" weight="bold" size={24} />
    </button>
  )
}

/**
 * The floating glass tab bar (DESIGN.md §9.1): Home, Daily, the add button, Fixed and Wallet, over
 * a fade to --bg so content never collides with the glass. Tapping the active tab pops it to its
 * root. Settings are not a tab: they open from the monogram on Home (docs/SPEC.md §3), which also
 * carries the backup reminder dot.
 */
export function TabBar() {
  const active = useNav((s) => s.tab)
  return (
    <>
      <div className={styles.fade} aria-hidden="true" />
      <nav aria-label="Tabs" className={styles.bar}>
        {LEFT_TABS.map((t) => (
          <TabButton key={t.tab} {...t} active={t.tab === active} />
        ))}
        <AddButton />
        {RIGHT_TABS.map((t) => (
          <TabButton key={t.tab} {...t} active={t.tab === active} />
        ))}
      </nav>
    </>
  )
}
