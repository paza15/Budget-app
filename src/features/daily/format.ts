import type { MoneyFormat } from '@/domain/money'
import type { Cents } from '@/domain/types'
import { MASKED_LABEL, withTrueMinus } from '@/ui'

/**
 * Money inside sentences and accessible names (docs/SPEC.md §4.1 masking): the formatted amount
 * with a true minus, or "•••" while amounts are hidden.
 */
export function shownAmount(money: MoneyFormat, cents: Cents): string {
  return withTrueMinus(money.format(cents))
}

/** The same amount as VoiceOver should say it: "amount hidden" instead of "•••". */
export function spokenAmount(money: MoneyFormat, cents: Cents): string {
  return money.masked ? MASKED_LABEL.toLowerCase() : shownAmount(money, cents)
}
