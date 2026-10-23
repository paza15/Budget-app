import { HOME_CARDS } from '@/domain/catalog'
import type { AppData, HomeCardKey } from '@/domain/types'

/** Pure rules behind You's pages (docs/SPEC.md §3.7), kept apart so node tests reach them. */

const DEFAULT_ORDER: readonly HomeCardKey[] = HOME_CARDS.map(({ key }) => key)

/**
 * Home layout: every card in one list. The shown ones (settings.homeCards) keep their Home order;
 * each hidden one goes after the card that comes before it by default (or first), so a fresh visit
 * lists hidden cards near where they belong.
 */
export function fullOrder(shown: readonly HomeCardKey[]): HomeCardKey[] {
  const result = shown.filter((key, index) => DEFAULT_ORDER.includes(key) && shown.indexOf(key) === index)
  for (const [index, key] of DEFAULT_ORDER.entries()) {
    if (result.includes(key)) continue
    const before = DEFAULT_ORDER.slice(0, index).findLast((other) => result.includes(other))
    result.splice(before === undefined ? 0 : result.indexOf(before) + 1, 0, key)
  }
  return result
}

/**
 * Home layout as listed: `order` (every card, as arranged on this visit) with the shown cards in
 * the stored Home order. Settings keep only the shown cards, so a hidden card's place lives in
 * `order`, and a card switched off stays where it is instead of jumping away.
 */
export function arrange(order: readonly HomeCardKey[], shown: readonly HomeCardKey[]): HomeCardKey[] {
  const visible = new Set(shown)
  const queue = shown.filter((key) => order.includes(key))
  const missing = shown.filter((key) => !order.includes(key))
  const result = order.map((key) => (visible.has(key) ? (queue.shift() ?? key) : key))
  return [...result, ...missing]
}

/**
 * Month starts on: true when changing the start day moves something the user made, so it asks
 * first. Entries change month, and fixed costs, month adjustments and savings, and the wallet's
 * start are remapped (§4.3).
 */
export function hasPeriodData(d: AppData): boolean {
  return (
    d.transactions.length > 0 ||
    d.recurring.length > 0 ||
    Object.keys(d.months).length > 0 ||
    d.wallet.entries.length > 0 ||
    d.wallet.opening > 0 ||
    d.wallet.startMonth !== null
  )
}
