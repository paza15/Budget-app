import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import styles from '@/features/you/data/SafeAreaProbe.module.css'

export interface SafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

function px(value: string): number {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : 0
}

function sameInsets(a: SafeAreaInsets, b: SafeAreaInsets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left
}

/**
 * Measures env(safe-area-inset-*) as iOS applies them (docs/SPEC.md §3.7 Diagnostics, §7): a
 * hidden fixed element padded by the four insets, read once it is in the page and again after
 * every resize or rotation. Returns the probe to render and the insets (null until measured).
 */
export function useSafeAreaInsets(): { probe: ReactElement; insets: SafeAreaInsets | null } {
  const ref = useRef<HTMLSpanElement>(null)
  const [insets, setInsets] = useState<SafeAreaInsets | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return undefined
    const measure = (): void => {
      const style = getComputedStyle(element)
      const next = {
        top: px(style.paddingTop),
        right: px(style.paddingRight),
        bottom: px(style.paddingBottom),
        left: px(style.paddingLeft),
      }
      setInsets((current) => (current !== null && sameInsets(current, next) ? current : next))
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [])

  return { probe: <span ref={ref} className={styles.probe} aria-hidden="true" />, insets }
}
