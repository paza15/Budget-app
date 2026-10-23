/**
 * Helpers for sheets whose body turns into another page (the icon picker, the move-to list of a
 * deleted category; docs/SPEC.md §3.7). Call them from event handlers, after the new page has
 * rendered (flushSync).
 */

/** The nearest ancestor that scrolls: the sheet's content. */
function scroller(element: Element | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

/**
 * Shows a page that just replaced another from its top (the old page may have been scrolled to its
 * end, where its button was) and puts focus on `target`, since the control that was used has gone.
 */
export function showPageFrom(body: HTMLElement | null, target: HTMLElement | null | undefined): void {
  const content = scroller(body)
  if (content !== null) content.scrollTop = 0
  target?.focus({ preventScroll: true })
}

/** Back on the form: focus returns to the row that left it, scrolled into view. */
export function returnTo(target: HTMLElement | null | undefined): void {
  target?.focus()
  target?.scrollIntoView?.({ block: 'nearest' })
}
