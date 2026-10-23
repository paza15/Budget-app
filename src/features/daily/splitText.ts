import type { MoneyFormat } from '@/domain/money'
import type { Split, Transaction } from '@/domain/types'
import { shownAmount, spokenAmount } from '@/features/daily/format'

/** Line 2 of a split expense in a list (docs/design/EXTRAS.md §2.5), shown and spoken. */
export interface SplitLine {
  /** "Split, Max owes 9,00 €", "Split with 2 people" or "Split with Lea and Max, settled". */
  text: string
  /** The same for VoiceOver, ending in a full stop, with "amount hidden" for a masked amount. */
  spoken: string
}

/** "Max", "Lea and Max", "Lea, Max and Jonas". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
}

/**
 * What a split expense's row says under its title (EXTRAS.md §2.5), or null when the expense is
 * not split or every split was forgiven (the row is an ordinary expense again):
 * - one person still owes: "Split, Max owes 9,00 €";
 * - two or more still owe: "Split with 2 people" (only the people still owing count);
 * - everyone paid back: "Split with Max, settled", "Split with Lea and Max, settled".
 */
export function splitLine(tx: Transaction, money: MoneyFormat): SplitLine | null {
  const counted: Split[] = tx.splits.filter((split) => split.status !== 'forgiven')
  if (counted.length === 0) return null
  const open = counted.filter((split) => split.status === 'open')
  const only = open.length === 1 ? open[0] : undefined
  if (only !== undefined) {
    const person = only.person.trim()
    return {
      text: `Split, ${person} owes ${shownAmount(money, only.amount)}`,
      spoken: `Split, ${person} owes ${spokenAmount(money, only.amount)}.`,
    }
  }
  if (open.length > 1) {
    const text = `Split with ${open.length} people`
    return { text, spoken: `${text}.` }
  }
  const text = `Split with ${joinNames(counted.map((split) => split.person.trim()))}, settled`
  return { text, spoken: `${text}.` }
}
