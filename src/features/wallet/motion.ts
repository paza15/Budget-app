/**
 * The Wallet's small motions (docs/DESIGN.md §9.26 Motion): a reached goal's seal fading in, two
 * goal rows trading places, a new passbook row fading in. They run with the Web Animations API from
 * layout effects, timed by the motion tokens, so Reduce Motion (which shortens the tokens) applies.
 * Engines without the API (jsdom) simply show the end state.
 */

/** A CSS time token of `element` ("200ms", "0.2s") in ms, or `fallback` when it is missing. */
export function cssTime(element: Element, name: string, fallback: number): number {
  const text = getComputedStyle(element).getPropertyValue(name).trim()
  const amount = Number.parseFloat(text)
  if (!Number.isFinite(amount)) return fallback
  if (text.endsWith('ms')) return amount
  return text.endsWith('s') ? amount * 1000 : fallback
}

/** A CSS easing token of `element`, or `fallback`. */
export function cssEasing(element: Element, name: string, fallback = 'ease-out'): string {
  return getComputedStyle(element).getPropertyValue(name).trim() || fallback
}

/** Runs `keyframes` on `element` when the Web Animations API exists and the duration is above 0. */
export function play(element: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (typeof element.animate !== 'function') return null
  if (typeof options.duration === 'number' && options.duration <= 0) return null
  try {
    return element.animate(keyframes, options)
  } catch {
    // An easing the engine cannot parse: no motion, just the result.
    return null
  }
}

/** Fades `element` in over the token `durationToken` (--dur-fade by default), never moving it. */
export function fadeIn(element: Element, durationToken = '--dur-fade'): void {
  play(element, [{ opacity: 0 }, { opacity: 1 }], {
    duration: cssTime(element, durationToken, 200),
    easing: cssEasing(element, '--ease-standard'),
  })
}
