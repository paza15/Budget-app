/** Pure helpers of the up/down reordering on You's pages (docs/SPEC.md §3.7). */

/** `keys` with the item at `index` moved one place up (−1) or down (+1); a copy, never in place. */
export function moveKey<K>(keys: readonly K[], index: number, delta: -1 | 1): K[] {
  const target = index + delta
  const next = [...keys]
  if (index < 0 || index >= keys.length || target < 0 || target >= keys.length) return next
  const [item] = next.splice(index, 1) as [K]
  next.splice(target, 0, item)
  return next
}

/** What VoiceOver hears after a move: "Recent is now first", "Rent is now 3 of 12". */
export function placeMessage(name: string, position: number, count: number): string {
  if (position === 1) return `${name} is now first`
  if (position === count) return `${name} is now last`
  return `${name} is now ${position} of ${count}`
}
