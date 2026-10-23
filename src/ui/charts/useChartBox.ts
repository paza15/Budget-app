import { useCallback, useState } from 'react'
import { FALLBACK_FONT_SIZE } from '@/ui/charts/scale'

export interface ChartBox {
  /** Content width in CSS px. */
  width: number
  /** Computed font size in px; the column charts set their root to the caption style. */
  fontSize: number
}

/**
 * Measures a chart's box, so its SVG is drawn 1:1 in CSS pixels and sized by its container.
 *
 * The first measurement runs in the ref callback, while React commits, so the update renders
 * before the first paint and never flashes a wrong width; a ResizeObserver follows later changes.
 * A box that measures 0 (inside a hidden tab) keeps its last size. Null until measured: charts
 * then draw at FALLBACK_WIDTH, which only jsdom and the render before the first commit use.
 */
export function useChartBox<T extends HTMLElement>(): [
  ref: (element: T | null) => (() => void) | undefined,
  box: ChartBox | null,
] {
  const [box, setBox] = useState<ChartBox | null>(null)
  const ref = useCallback((element: T | null) => {
    if (element === null) return undefined
    const measure = () => {
      const width = Math.round(element.getBoundingClientRect().width * 100) / 100
      if (!(width > 0)) return
      const measured = Number.parseFloat(getComputedStyle(element).fontSize)
      const fontSize = measured > 0 ? measured : FALLBACK_FONT_SIZE
      setBox((previous) =>
        previous !== null && previous.width === width && previous.fontSize === fontSize
          ? previous
          : { width, fontSize },
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, box]
}
