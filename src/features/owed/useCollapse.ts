import { useEffectEvent, useLayoutEffect, useRef, type RefObject } from 'react'

/** A time token ("320ms", "0.2s") in ms, or the fallback when it is missing. */
function timeOf(value: string, fallback: number): number {
  const text = value.trim()
  const amount = Number.parseFloat(text)
  if (!Number.isFinite(amount)) return fallback
  return text.endsWith('ms') ? amount : text.endsWith('s') ? amount * 1000 : fallback
}

/**
 * Collapses `element` (docs/design/EXTRAS.md §2.9): its height, vertical padding, top margin and
 * opacity go to 0 over --dur-grow with --ease-out, so what follows rises into its place (boxes are
 * border-box, so the padding has to go too). With Reduce Motion it only fades in --dur-fade and
 * the layout jumps afterwards. Null without the Web Animations API (jsdom).
 */
export function startCollapse(element: HTMLElement): Animation | null {
  if (typeof element.animate !== 'function') return null
  const style = getComputedStyle(element)
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: timeOf(style.getPropertyValue('--dur-fade'), 200),
      fill: 'forwards',
    })
  }
  return element.animate(
    [
      {
        height: `${element.offsetHeight}px`,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        marginTop: style.marginTop,
        opacity: 1,
      },
      { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', opacity: 0 },
    ],
    {
      duration: timeOf(style.getPropertyValue('--dur-grow'), 320),
      easing: style.getPropertyValue('--ease-out').trim() || 'ease-out',
      fill: 'forwards',
    },
  )
}

/**
 * While `leaving`, collapses the element the returned ref is attached to, then calls `onLeft` (the
 * owner removes it). Coming back (Undo) cancels the collapse and the element is whole again. The
 * element should be inert while it leaves and clip its content (data-leaving in the CSS).
 */
export function useCollapse<T extends HTMLElement>(leaving: boolean, onLeft: () => void): RefObject<T | null> {
  const ref = useRef<T>(null)
  const left = useEffectEvent(onLeft)
  useLayoutEffect(() => {
    const element = ref.current
    if (!leaving || element === null) return undefined
    const animation = startCollapse(element)
    if (animation === null) {
      left()
      return undefined
    }
    let active = true
    animation.finished.then(
      () => {
        if (active) left()
      },
      () => {
        // Cancelled: the element came back, or it unmounted.
      },
    )
    return () => {
      active = false
      animation.cancel()
    }
  }, [leaving])
  return ref
}
