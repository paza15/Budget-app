import { withUndo } from '@/app/undo'
import type { MoneyFormat } from '@/domain/money'
import { categoryDisplay } from '@/domain/queries'
import type { QuickAdd } from '@/domain/types'
import { shownAmount } from '@/features/daily/format'
import { actions } from '@/store/actions'
import { getData } from '@/store/appStore'
import { getCategoryMap } from '@/store/selectors'
import { getToday } from '@/store/today'

/** "Added 3,50 € to Coffee & snacks", or "Added to Coffee & snacks" while amounts are hidden (§3.3). */
export function addedMessage(money: MoneyFormat, amount: number, where: string): string {
  return money.masked ? `Added to ${where}` : `Added ${shownAmount(money, amount)} to ${where}`
}

/**
 * A tap on a quick-add tile (docs/SPEC.md §3.3): adds the expense dated today, with the button's
 * label as its note, and toasts "Added 3,50 € to Coffee & snacks" with Undo. The tab bar's
 * long-press menu adds quick adds the same way. Call it from an event handler.
 */
export async function addQuickAdd(quickAdd: QuickAdd, money: MoneyFormat): Promise<void> {
  const category = categoryDisplay(quickAdd.categoryId, getCategoryMap(getData())).name
  await withUndo(addedMessage(money, quickAdd.amount, category), () => {
    actions.addTransaction({
      kind: 'expense',
      amount: quickAdd.amount,
      categoryId: quickAdd.categoryId,
      date: getToday(),
      note: quickAdd.label,
    })
  })
}
