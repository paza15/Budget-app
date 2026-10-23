/** Text fields whose Return key the iOS keyboard labels "done" or "search" in these pages. */
const TEXT_TYPES: ReadonlySet<string> = new Set(['text', 'search'])

/** Return in a text field: put the keyboard away. */
function onKeyDown(event: KeyboardEvent): void {
  const target = event.target
  if (event.key !== 'Enter' || event.isComposing) return
  if (!(target instanceof HTMLInputElement) || !TEXT_TYPES.has(target.type)) return
  event.preventDefault()
  target.blur()
}

/**
 * A ref callback for a page or sheet body: Return in one of its text fields (the keyboard's
 * "done" or "search" key, enterKeyHint) puts the keyboard away instead of doing nothing, so the
 * sheet settles back to the bottom (docs/SPEC.md §7). React 19 calls the returned cleanup.
 */
export function blurOnEnter(element: HTMLElement | null): (() => void) | undefined {
  if (element === null) return undefined
  element.addEventListener('keydown', onKeyDown)
  return () => element.removeEventListener('keydown', onKeyDown)
}
