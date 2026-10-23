import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import styles from '@/ui/charts/ChartTooltip.module.css'
import { MaskedText } from '@/ui/MaskedText'
import { type Box, coversColumn, placeAbovePlot, placeTooltip } from '@/ui/charts/scale'

/**
 * 'beside': inside the chart, beside the column at the top of the plot. 'above': above the plot,
 * centred on the column, covering only what is above the chart.
 */
export type TooltipPlacement = 'beside' | 'above'

export interface ChartTooltipProps {
  /** Centre of the tapped column, in the plot's coordinates (from its left edge). */
  x: number
  /** Half the column's width. */
  halfWidth: number
  /** Size of the chart (plot and axis band): a tooltip beside the column stays inside it. */
  boxWidth: number
  boxHeight: number
  /** Labels on the plot a tooltip beside the column should leave readable. */
  avoid?: readonly Box[]
  /**
   * 'beside' (default; the Daily columns): when neither side of the column has room for it, the
   * tooltip goes above the plot instead, so it never covers the column. 'above': always (the trend,
   * docs/DESIGN.md §9.22).
   */
  placement?: TooltipPlacement
  /**
   * Closes the tooltip (clears the selection). A tooltip above the plot is fixed to the screen,
   * so it calls this when the page scrolls or the window resizes under it, rather than drift away
   * from its column.
   */
  onDismiss?(): void
  children: ReactNode
}

/** What a placement needs from the page, measured before the first paint. */
interface Measured {
  width: number
  height: number
  /** The plot (the tooltip's containing block: plot and axis band), in viewport coordinates. */
  plot: Box
  /** The visible part of the chart's scroll container, in viewport coordinates. */
  visible: Box
  /** Where left 0, top 0 of a fixed element lands: the viewport's corner unless an ancestor is transformed. */
  originX: number
  originY: number
}

/** The measuring pass: in the plot's corner, invisible. */
const MEASURING: Readonly<CSSProperties> = Object.freeze<CSSProperties>({ left: 0, top: 0, visibility: 'hidden' })

/**
 * The tap tooltip of the column charts (docs/DESIGN.md §9.22): raised paper with a soft shadow. It
 * measures itself and the page while React commits, so it paints in place:
 * - beside the column at the top of the plot (scale.ts placeTooltip), inside the chart, so a group
 *   that clips its content never cuts it;
 * - or above the plot (scale.ts placeAbovePlot) when asked, or when no side has room: then it is
 *   fixed to the screen, which no group's clipping applies to, and it closes on scroll.
 * It never covers the selected column. It repeats what the hidden table gives assistive
 * technology, so it is hidden from it and takes no pointer events. Give it a `key` per column, so
 * each column's tooltip measures afresh.
 */
export function ChartTooltip({
  x,
  halfWidth,
  boxWidth,
  boxHeight,
  avoid,
  placement = 'beside',
  onDismiss,
  children,
}: ChartTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const originRef = useRef<HTMLSpanElement>(null)
  const [measured, setMeasured] = useState<Measured | null>(null)
  /** Scrolled away from: gone even if a controlled parent keeps the column selected. */
  const [dismissed, setDismissed] = useState(false)

  const measure = useCallback(() => {
    const tooltip = tooltipRef.current
    const origin = originRef.current
    const plot = tooltip?.parentElement
    if (tooltip === null || origin === null || plot === null || plot === undefined) return
    const size = tooltip.getBoundingClientRect()
    const corner = origin.getBoundingClientRect()
    const next: Measured = {
      width: size.width,
      height: size.height,
      plot: boxOf(plot.getBoundingClientRect()),
      visible: visibleArea(plot),
      originX: corner.left,
      originY: corner.top,
    }
    setMeasured((previous) => (previous !== null && sameMeasured(previous, next) ? previous : next))
  }, [])

  // Measure before the first paint; again when the content changes size (the tooltip keeps its own
  // width wherever it goes, so its size never depends on where it is put) and when the chart is
  // resized, which moves the plot.
  useLayoutEffect(() => {
    measure()
    const tooltip = tooltipRef.current
    const plot = tooltip?.parentElement
    if (tooltip === null || plot === null || plot === undefined || typeof ResizeObserver === 'undefined') {
      return undefined
    }
    const observer = new ResizeObserver(() => measure())
    observer.observe(tooltip)
    observer.observe(plot)
    return () => observer.disconnect()
  }, [measure])

  let mode: TooltipPlacement | null = null
  let style = MEASURING
  if (measured !== null) {
    const { width, height } = measured
    const beside =
      placement === 'beside' ? placeTooltip({ x, halfWidth, boxWidth, boxHeight, avoid, width, height }) : null
    if (beside !== null && !coversColumn({ left: beside.left, width, x, halfWidth })) {
      mode = 'beside'
      style = { left: beside.left, top: beside.top }
    } else {
      // In the fixed element's own coordinates: the viewport's, unless an ancestor is transformed.
      const above = placeAbovePlot({ x, plot: measured.plot, visible: measured.visible, width, height })
      mode = 'above'
      style = { left: above.left - measured.originX, top: above.top - measured.originY }
    }
  }

  // Fixed to the screen, the tooltip would stay put while its chart scrolls away: close it.
  const dismiss = useEffectEvent(() => {
    setDismissed(true)
    onDismiss?.()
  })
  const fixed = mode === 'above'
  useEffect(() => {
    const tooltip = tooltipRef.current
    if (!fixed || tooltip === null) return undefined
    const onScroll = (event: Event) => {
      const target = event.target
      if (target === document || (target instanceof Node && target.contains(tooltip))) dismiss()
    }
    const onResize = () => dismiss()
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onResize)
    }
  }, [fixed])

  if (dismissed) return null
  return (
    <>
      <span ref={originRef} className={styles.origin} aria-hidden="true" />
      <div
        ref={tooltipRef}
        className={styles.tooltip}
        aria-hidden="true"
        data-chart-tooltip=""
        data-placement={mode ?? undefined}
        style={style}
      >
        {children}
      </div>
    </>
  )
}

function boxOf(rect: DOMRect): Box {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

function sameBox(a: Box, b: Box): boolean {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom
}

function sameMeasured(a: Measured, b: Measured): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.originX === b.originX &&
    a.originY === b.originY &&
    sameBox(a.plot, b.plot) &&
    sameBox(a.visible, b.visible)
  )
}

const SCROLLS = /auto|scroll|overlay/

function pixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * The part of the viewport that shows the scrolling content around `element`: its nearest
 * scrolling ancestor (or the whole viewport), less its scroll padding and a sticky bar at its top,
 * such as a screen's navigation bar, which content scrolls under.
 */
function visibleArea(element: Element): Box {
  const root = document.documentElement
  const area: Box = { left: 0, top: 0, right: root.clientWidth || window.innerWidth, bottom: window.innerHeight }
  for (let node = element.parentElement; node !== null && node !== root && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (!SCROLLS.test(style.overflowY)) continue
    const rect = node.getBoundingClientRect()
    area.left = Math.max(area.left, rect.left)
    area.right = Math.min(area.right, rect.right)
    area.top = Math.max(area.top, rect.top + pixels(style.scrollPaddingTop))
    area.bottom = Math.min(area.bottom, rect.bottom - pixels(style.scrollPaddingBottom))
    for (const child of node.children) {
      if (getComputedStyle(child).position !== 'sticky') continue
      const bar = child.getBoundingClientRect()
      if (bar.top <= area.top + 1 && bar.bottom > area.top) area.top = bar.bottom
    }
    break
  }
  return area
}

export interface TooltipRow {
  key: string
  /** Series name; omit for a single value. */
  label?: string
  /** Custom property of the series colour: keys the name with a short stroke of it. */
  cssVar?: string
  value: string
}

/**
 * Standard tooltip content: the column's name in Footnote 600, then its values in the figures
 * font, each series named in --ink-2 after a short stroke of its colour.
 */
export function TooltipContent({ title, rows }: { title: string; rows: readonly TooltipRow[] }) {
  return (
    <>
      <p className={styles.title}>{title}</p>
      <dl className={styles.rows}>
        {rows.map((row) => (
          <div key={row.key} className={styles.row}>
            {row.label !== undefined && (
              <dt className={styles.label}>
                {row.cssVar !== undefined && (
                  <span className={styles.key} style={{ background: `var(${row.cssVar})` }} />
                )}
                {row.label}
              </dt>
            )}
            <dd className={styles.value}>
              <MaskedText text={row.value} />
            </dd>
          </div>
        ))}
      </dl>
    </>
  )
}
