import { useCallback, type RefCallback } from 'react'
import figureStyles from '@/ui/LedgerFigure.module.css'

/** The custom property the hook writes; docs/DESIGN.md §9.6 names it. */
const LEDGER_COLUMN_PROPERTY = '--colw'

/** LedgerFigure's own class, which every figure carries whatever its tone or masking. */
const FIGURE_CLASS = figureStyles.figure ?? ''

/**
 * Spans a ledger's sum rule and double rule over its widest figure (docs/DESIGN.md §2, §9.6). Attach
 * the returned ref to the element that holds the ledger's rows: it writes the width of the widest
 * LedgerFigure inside it, in px, to that element's `--colw`, and the rules' CSS spans
 * `width: var(--colw)`, aligned right with the figure column.
 *
 * It measures again, before paint, whenever a figure changes size and whenever rows come and go: when
 * Source Serif 4 replaces the fallback font, the text size changes, an amount changes or amounts are
 * hidden or shown. A single measurement on mount would keep the fallback font's wider figures.
 */
export function useLedgerColumn<T extends HTMLElement = HTMLElement>(): RefCallback<T> {
  return useCallback((ledger: T | null) => {
    if (!ledger) return undefined
    // A live collection: it follows the rows React adds and removes. The hanging unit of the result
    // is positioned outside its figure's box, so each box spans the number only.
    const figures = ledger.getElementsByClassName(FIGURE_CLASS)
    const measure = () => {
      let widest = 0
      for (const figure of figures) widest = Math.max(widest, figure.getBoundingClientRect().width)
      ledger.style.setProperty(LEDGER_COLUMN_PROPERTY, `${Math.round(widest * 100) / 100}px`)
    }
    // Figures are inline-block, so a ResizeObserver sees their width change. Writing --colw resizes
    // only the rules, never a figure, so the observer cannot loop.
    const resizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    const observed = new Set<Element>()
    const track = () => {
      for (const figure of observed) {
        if (!ledger.contains(figure)) {
          observed.delete(figure)
          resizes?.unobserve(figure)
        }
      }
      for (const figure of figures) {
        if (!observed.has(figure)) {
          observed.add(figure)
          resizes?.observe(figure)
        }
      }
      measure()
    }
    const rows = typeof MutationObserver === 'undefined' ? null : new MutationObserver(track)
    rows?.observe(ledger, { childList: true, subtree: true })
    track()
    return () => {
      rows?.disconnect()
      resizes?.disconnect()
    }
  }, [])
}
