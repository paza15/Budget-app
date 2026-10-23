/**
 * Chart geometry (docs/DESIGN.md §9.5, §9.22): pure functions from values and a measured width to
 * SVG coordinates in CSS pixels. Charts draw at 1:1, so marks keep their exact sizes (1px ticks,
 * 6px columns, 2px gaps) at every width instead of being stretched by a viewBox.
 */

/** Width a chart draws with before its box is measured: only jsdom and the first render use it. */
export const FALLBACK_WIDTH = 320

/** Caption size at the default text size; used until the chart's own font size is measured. */
export const FALLBACK_FONT_SIZE = 12

/** Space between touching marks: stacked segments and stacked column parts (SPEC §6). */
export const SURFACE_GAP = 2

/** Radius of the data end of columns and stacked bars (--radius-data). */
export const DATA_RADIUS = 4

/** Positive values never draw thinner than this, so a small amount never looks like nothing. */
export const MIN_MARK = 2

/** Bars never get thicker than this (SPEC §6). */
export const MAX_BAR_WIDTH = 24

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Two decimals keep SVG attributes short; anything finer is invisible. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function devicePixelRatio(): number {
  return typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
}

/** Snaps a coordinate to the device pixel grid, so a 1px mark covers whole device pixels. */
export function snap(value: number, pixelRatio = devicePixelRatio()): number {
  return round2(Math.round(value * pixelRatio) / pixelRatio)
}

// ---------------------------------------------------------------------------------------------
// Bands and values

export interface BandScale {
  count: number
  /** Width of one column's slot. */
  slot: number
  /** Centre of slot `index`. */
  center(index: number): number
  /** The slot under x. Outside the plot it snaps to the first or last slot; -1 without slots. */
  indexAt(x: number): number
}

/** `count` equal slots across `width`, one per column. */
export function bandScale(count: number, width: number): BandScale {
  const slot = count > 0 && width > 0 ? width / count : 0
  return {
    count,
    slot,
    center: (index) => (index + 0.5) * slot,
    indexAt: (x) => {
      if (count === 0) return -1
      if (slot === 0 || !Number.isFinite(x)) return 0
      return clamp(Math.floor(x / slot), 0, count - 1)
    },
  }
}

/**
 * Top of the value axis: the largest value reaches `fill` of the plot height, which leaves a
 * little air above the tallest column. At least 1, so empty or all-zero data never divides by 0.
 */
export function valueDomainMax(values: Iterable<number>, fill = 0.95): number {
  let max = 0
  for (const value of values) if (Number.isFinite(value) && value > max) max = value
  return max > 0 ? max / fill : 1
}

/** Gap between a line's label and the line (docs/DESIGN.md §9.22: "6 above the line's end"). */
export const LABEL_OFFSET = 6

/** Ascent, cap height and descent of SF Pro as shares of the font size, rounded up. */
const ASCENT = 0.8
const CAP_HEIGHT = 0.7
const DESCENT = 0.25

/** Height a line's label needs above the line: the caption's ascent, the offset and 2px of air. */
export function labelHeadroom(fontSize: number): number {
  return fontSize * ASCENT + LABEL_OFFSET + 2
}

/**
 * Top of the value axis for columns with lines over them (a reference, income): columns reach
 * at most `fill` of the plot, and every line sits at least `headroom` px below the top, so its
 * label fits above it instead of crossing the columns.
 */
export function valueDomainWithLines(
  columnValues: Iterable<number>,
  lineValues: Iterable<number>,
  o: { plotHeight: number; headroom: number; fill?: number },
): number {
  const columns = valueDomainMax(columnValues, o.fill)
  let lineMax = 0
  for (const value of lineValues) if (Number.isFinite(value) && value > lineMax) lineMax = value
  if (!(lineMax > 0)) return columns
  const room = Math.max(0.5, 1 - o.headroom / Math.max(1, o.plotHeight))
  return Math.max(columns, lineMax / room)
}

/** y of a line label: LABEL_OFFSET above the line, or below it when there is no room above. */
export function lineLabelY(lineY: number, fontSize: number): number {
  const ascent = fontSize * ASCENT
  return lineY - LABEL_OFFSET - ascent >= 0 ? lineY - LABEL_OFFSET : lineY + LABEL_OFFSET + ascent
}

/** Baseline that centres a label's figures on a horizontal line, as a gridline's value beside it. */
export function besideLineY(lineY: number, fontSize: number): number {
  return lineY + (fontSize * CAP_HEIGHT) / 2
}

/** y of `value` on a plot `plotHeight` tall whose top is `max` (0 is the top edge). */
export function valueY(value: number, max: number, plotHeight: number): number {
  const ratio = max > 0 && Number.isFinite(value) ? value / max : 0
  return plotHeight - clamp(ratio, 0, 1) * plotHeight
}

/** The smallest step of 1, 2, 2.5 or 5 × 10ⁿ that is at least `rough`; 1 when there is nothing. */
export function niceStep(rough: number): number {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1
  const power = 10 ** Math.floor(Math.log10(rough))
  const factor = [1, 2, 2.5, 5].find((candidate) => candidate * power >= rough) ?? 10
  return factor * power
}

/**
 * Values of the horizontal gridlines on a value axis whose top is `max`: one to three clean steps
 * above 0 (the baseline is its own rule), none in the top 4%, where a line would touch the edge.
 */
export function gridValues(max: number): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return []
  const step = niceStep(max / 4)
  const values: number[] = []
  for (let index = 1; index * step < max * 0.96; index += 1) values.push(round2(index * step))
  return values
}

/**
 * Height of a column, proportional to value / max. Zero, negative and invalid values draw nothing;
 * a positive value draws at least MIN_MARK and at most the plot height.
 */
export function columnHeight(value: number, max: number, plotHeight: number): number {
  if (!(value > 0) || !(max > 0) || !(plotHeight > 0)) return 0
  return clamp((value / max) * plotHeight, Math.min(MIN_MARK, plotHeight), plotHeight)
}

export interface ColumnBox {
  index: number
  /** Centre of the column and of its slot. */
  center: number
  /** Left edge and width of the drawn column. */
  x: number
  width: number
  /** Drawn height; 0 draws nothing. */
  height: number
  /** The column's tap target: its whole slot, whatever its height (zero columns stay tappable). */
  hitX: number
  hitWidth: number
}

/**
 * Columns centred in equal slots across `width`. Each is `barWidth` wide (at most MAX_BAR_WIDTH
 * and always leaving 2px between neighbours) and as tall as its value.
 */
export function layoutColumns(
  values: readonly number[],
  o: { width: number; plotHeight: number; barWidth: number; max: number },
): ColumnBox[] {
  const band = bandScale(values.length, o.width)
  const width = Math.max(1, Math.min(o.barWidth, MAX_BAR_WIDTH, band.slot - SURFACE_GAP))
  return values.map((value, index) => {
    const center = band.center(index)
    return {
      index,
      center,
      x: center - width / 2,
      width,
      height: columnHeight(value, o.max, o.plotHeight),
      hitX: index * band.slot,
      hitWidth: band.slot,
    }
  })
}

// ---------------------------------------------------------------------------------------------
// Stacks

export interface StackPiece {
  /** Index of the value this piece draws. */
  index: number
  y: number
  height: number
  /** Only the top piece carries the rounded data end. */
  roundTop: boolean
}

/**
 * Stacks positive values bottom first from the baseline. Every piece above another starts `gap`
 * higher, leaving a surface gap between them, and only the top piece is rounded (SPEC §6).
 */
export function stackColumn(
  values: readonly number[],
  o: { max: number; plotHeight: number; gap?: number },
): StackPiece[] {
  const gap = o.gap ?? SURFACE_GAP
  const pieces: StackPiece[] = []
  let base = o.plotHeight
  values.forEach((value, index) => {
    if (!(value > 0) || !(o.max > 0)) return
    const top = base - (value / o.max) * o.plotHeight
    const bottom = pieces.length > 0 ? base - gap : base
    // A sliver still shows: at least 1px of it stays visible above the gap.
    const drawnTop = Math.max(0, Math.min(top, bottom - 1))
    pieces.push({ index, y: drawnTop, height: Math.max(0, bottom - drawnTop), roundTop: false })
    base = drawnTop
  })
  const last = pieces.at(-1)
  if (last !== undefined) last.roundTop = true
  return pieces
}

/**
 * Side-by-side segments across `width`, proportional to their (positive) values, with `gap`
 * between neighbours. While there is room, no segment is narrower than `minWidth`: slivers are
 * lifted to it and the difference comes from the others in proportion.
 */
export function stackedBarLayout(
  values: readonly number[],
  width: number,
  gap = SURFACE_GAP,
  minWidth = MIN_MARK,
): { x: number; width: number }[] {
  const count = values.length
  if (count === 0) return []
  const room = Math.max(0, width - gap * (count - 1))
  const safe = values.map((value) => (value > 0 ? value : 0))
  const total = safe.reduce((sum, value) => sum + value, 0)
  if (!(total > 0) || room === 0) return safe.map(() => ({ x: 0, width: 0 }))

  const lifted = new Set<number>()
  let widths = safe.map((value) => (value / total) * room)
  if (minWidth * count <= room) {
    for (let pass = 0; pass < count; pass += 1) {
      const thin = widths.flatMap((w, i) => (!lifted.has(i) && w < minWidth ? [i] : []))
      if (thin.length === 0) break
      for (const i of thin) lifted.add(i)
      const freeTotal = safe.reduce((sum, value, i) => (lifted.has(i) ? sum : sum + value), 0)
      const freeRoom = room - minWidth * lifted.size
      widths = safe.map((value, i) =>
        lifted.has(i) ? minWidth : freeTotal > 0 ? (value / freeTotal) * freeRoom : 0,
      )
    }
  }

  let x = 0
  return widths.map((w) => {
    const box = { x, width: w }
    x += w + gap
    return box
  })
}

// ---------------------------------------------------------------------------------------------
// Paths

/** Two-decimal number for path data. */
const n = round2

/**
 * A column standing on `baseline`: square at the base, top corners rounded to `radius`, which is
 * clamped to half the width and to the height (a 6px column gets a 3px round top).
 */
export function columnPath(
  x: number,
  baseline: number,
  width: number,
  height: number,
  radius = DATA_RADIUS,
): string {
  if (!(width > 0) || !(height > 0)) return ''
  const r = Math.max(0, Math.min(radius, width / 2, height))
  const top = baseline - height
  if (r === 0) return `M${n(x)} ${n(baseline)}V${n(top)}H${n(x + width)}V${n(baseline)}Z`
  return (
    `M${n(x)} ${n(baseline)}V${n(top + r)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(top)}H${n(x + width - r)}` +
    `A${n(r)} ${n(r)} 0 0 1 ${n(x + width)} ${n(top + r)}V${n(baseline)}Z`
  )
}

/**
 * A horizontal bar with its start and/or end rounded to `radius` (clamped to half the height and
 * to the width). Drawn clockwise from the top-left corner.
 */
export function barPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  ends: { start: boolean; end: boolean },
): string {
  if (!(width > 0) || !(height > 0)) return ''
  const rounded = (ends.start ? 1 : 0) + (ends.end ? 1 : 0)
  const r = rounded === 0 ? 0 : Math.max(0, Math.min(radius, height / 2, width / rounded))
  const right = x + width
  const bottom = y + height
  let d = `M${n(ends.start ? x + r : x)} ${n(y)}`
  d +=
    ends.end && r > 0
      ? `H${n(right - r)}A${n(r)} ${n(r)} 0 0 1 ${n(right)} ${n(y + r)}V${n(bottom - r)}` +
        `A${n(r)} ${n(r)} 0 0 1 ${n(right - r)} ${n(bottom)}`
      : `H${n(right)}V${n(bottom)}`
  d +=
    ends.start && r > 0
      ? `H${n(x + r)}A${n(r)} ${n(r)} 0 0 1 ${n(x)} ${n(bottom - r)}V${n(y + r)}` +
        `A${n(r)} ${n(r)} 0 0 1 ${n(x + r)} ${n(y)}`
      : `H${n(x)}V${n(y)}`
  return `${d}Z`
}

/**
 * A line through one level per slot, as horizontal steps joined by risers at the slot edges
 * (a constant series is one straight line across the plot). Null levels leave a gap.
 */
export function stepLinePath(levels: readonly (number | null)[], slot: number): string {
  let d = ''
  let drawing = false
  levels.forEach((y, index) => {
    if (y === null || !Number.isFinite(y)) {
      drawing = false
      return
    }
    const x0 = index * slot
    d += drawing ? `V${n(y)}` : `M${n(x0)} ${n(y)}`
    d += `H${n(x0 + slot)}`
    drawing = true
  })
  return d
}

// ---------------------------------------------------------------------------------------------
// Labels and tooltips

/**
 * Rough advance of `text` in SF Pro at `fontSize`, generous rather than exact. Only used to
 * decide which axis labels fit, so it never needs a measuring pass.
 */
export function estimateTextWidth(text: string, fontSize: number, weight = 400): number {
  let em = 0
  for (const char of text) {
    if (char === ' ') em += 0.28
    else if (char >= '0' && char <= '9') em += 0.6
    else if ('iljtfrI.,:;\'|!'.includes(char)) em += 0.32
    else if ('mwMW'.includes(char)) em += 0.86
    else if (char >= 'A' && char <= 'Z') em += 0.68
    else em += 0.56
  }
  return em * fontSize * (weight >= 600 ? 1.06 : 1)
}

export interface AxisLabel {
  key: string
  x: number
  anchor: 'start' | 'middle' | 'end'
  text: string
  /** The emphasised label: "Today" or the current month (600, --ink). */
  strong: boolean
}

/** Least space between two axis labels. */
const LABEL_GAP = 6

/**
 * The first and last labels at the plot's edges, plus the highlighted column's label centred
 * under it (docs/DESIGN.md §9.22: "1 Oct", "Today", "31 Oct"). An edge label that would touch
 * the highlighted one gives way to it.
 */
export function edgeAxisLabels(o: {
  keys: readonly string[]
  labels: readonly string[]
  width: number
  fontSize: number
  highlight?: { index: number; text: string }
}): AxisLabel[] {
  const count = o.keys.length
  const firstKey = o.keys[0]
  const lastKey = o.keys.at(-1)
  if (count === 0 || firstKey === undefined || lastKey === undefined) return []
  const first: AxisLabel = { key: firstKey, x: 0, anchor: 'start', text: o.labels[0] ?? '', strong: false }
  const last: AxisLabel = { key: lastKey, x: o.width, anchor: 'end', text: o.labels.at(-1) ?? '', strong: false }
  const highlight = o.highlight
  if (highlight === undefined || highlight.index < 0 || highlight.index >= count) {
    return count === 1 ? [first] : [first, last]
  }
  if (highlight.index === 0) {
    const strong = { ...first, text: highlight.text, strong: true }
    return count === 1 ? [strong] : [strong, last]
  }
  if (highlight.index === count - 1) return [first, { ...last, text: highlight.text, strong: true }]

  const half = estimateTextWidth(highlight.text, o.fontSize, 600) / 2
  const x = clamp(bandScale(count, o.width).center(highlight.index), half, Math.max(half, o.width - half))
  const middle: AxisLabel = { key: o.keys[highlight.index] ?? '', x, anchor: 'middle', text: highlight.text, strong: true }
  const labels: AxisLabel[] = []
  if (x - half >= estimateTextWidth(first.text, o.fontSize) + LABEL_GAP) labels.push(first)
  labels.push(middle)
  if (x + half <= o.width - estimateTextWidth(last.text, o.fontSize) - LABEL_GAP) labels.push(last)
  return labels
}

/**
 * A label under every column (the trend's month names) when they all fit their slots; otherwise
 * the edge labels plus the highlighted one.
 */
export function columnAxisLabels(o: {
  keys: readonly string[]
  labels: readonly string[]
  width: number
  fontSize: number
  highlightIndex: number
}): AxisLabel[] {
  const band = bandScale(o.keys.length, o.width)
  const fits = o.labels.every(
    (text, index) => estimateTextWidth(text, o.fontSize, index === o.highlightIndex ? 600 : 400) <= band.slot - 4,
  )
  if (!fits) {
    const text = o.labels[o.highlightIndex]
    return edgeAxisLabels({
      ...o,
      highlight: text === undefined ? undefined : { index: o.highlightIndex, text },
    })
  }
  return o.keys.map((key, index) => ({
    key,
    x: band.center(index),
    anchor: 'middle',
    text: o.labels[index] ?? '',
    strong: index === o.highlightIndex,
  }))
}

export interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

/** The box a label `width` wide takes around its anchor point and baseline. */
export function labelBox(o: {
  x: number
  y: number
  width: number
  fontSize: number
  anchor: AxisLabel['anchor']
}): Box {
  const left = o.anchor === 'start' ? o.x : o.anchor === 'middle' ? o.x - o.width / 2 : o.x - o.width
  return { left, right: left + o.width, top: o.y - o.fontSize * ASCENT, bottom: o.y + o.fontSize * DESCENT }
}

/** True when a drawn column standing on `baseline` comes within `pad` px of `box`. */
export function columnsReach(
  columns: readonly Pick<ColumnBox, 'x' | 'width' | 'height'>[],
  baseline: number,
  box: Box,
  pad = 2,
): boolean {
  return columns.some(
    (column) =>
      column.height > 0 &&
      column.x < box.right + pad &&
      column.x + column.width > box.left - pad &&
      baseline - column.height < box.bottom + pad,
  )
}

/**
 * The free stretch of the axis band around its middle: from the labels left of the middle to
 * those right of it, LABEL_GAP away from each. Null when a label covers the middle.
 */
export function freeAxisSpan(
  labels: readonly AxisLabel[],
  width: number,
  fontSize: number,
): { left: number; right: number } | null {
  const middle = width / 2
  let left = 0
  let right = width
  for (const label of labels) {
    const textWidth = estimateTextWidth(label.text, fontSize, label.strong ? 600 : 400)
    const box = labelBox({ x: label.x, y: 0, width: textWidth, fontSize, anchor: label.anchor })
    if (box.left <= middle && box.right >= middle) return null
    if (box.right < middle) left = Math.max(left, box.right + LABEL_GAP)
    else right = Math.min(right, box.left - LABEL_GAP)
  }
  return right > left ? { left, right } : null
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/**
 * Where a tooltip `width` × `height` goes for the column centred at `x`, `halfWidth` either side,
 * in a chart `boxWidth` × `boxHeight`. It never leaves the chart, so a group that clips its
 * content (overflow: hidden for the rounded corners) never cuts it, and it covers the faded
 * neighbours rather than the selected column. Its left edge is beside the column, on the side
 * with more room first; with no side wide enough, against the chart's edge on that side, where it
 * would cover the column (coversColumn: the tooltip then goes above the plot, placeAbovePlot).
 * Then:
 * 1. at the top of the plot, clear of the `avoid` boxes (labels such as "Income 1.450,00 €");
 * 2. just below the labels it would cover, while it still fits the chart's height;
 * 3. at the top, over the label.
 */
export function placeTooltip(o: {
  x: number
  halfWidth: number
  boxWidth: number
  boxHeight: number
  width: number
  height: number
  avoid?: readonly Box[]
  gap?: number
}): { left: number; top: number } {
  const gap = o.gap ?? 8
  const avoid = o.avoid ?? []
  const right = o.x + o.halfWidth + gap
  const left = o.x - o.halfWidth - gap - o.width
  const sides = o.boxWidth - right >= o.x - o.halfWidth - gap ? [right, left] : [left, right]
  const fitting = sides.filter((side) => side >= 0 && side + o.width <= o.boxWidth)
  const candidates = fitting.length > 0 ? fitting : [clamp(sides[0] ?? 0, 0, Math.max(0, o.boxWidth - o.width))]
  const box = (side: number, top: number): Box => ({ left: side, right: side + o.width, top, bottom: top + o.height })
  const clear = (side: number, top: number) => !avoid.some((label) => overlaps(box(side, top), label))

  for (const side of candidates) if (clear(side, 0)) return { left: side, top: 0 }
  for (const side of candidates) {
    const top = avoid.reduce(
      (lowest, label) => (overlaps(box(side, 0), label) ? Math.max(lowest, label.bottom + 4) : lowest),
      0,
    )
    if (top + o.height <= o.boxHeight && clear(side, top)) return { left: side, top }
  }
  return { left: candidates[0] ?? 0, top: 0 }
}

/**
 * True when a tooltip from `left`, `width` wide, crosses the column centred at `x`, `halfWidth`
 * either side: placeTooltip found no side with room, so beside the column it would cover it.
 */
export function coversColumn(o: { left: number; width: number; x: number; halfWidth: number }): boolean {
  return o.left < o.x + o.halfWidth && o.left + o.width > o.x - o.halfWidth
}

/** Space between a tooltip above or below a plot and the plot, and its least distance to the screen's edges. */
export const TOOLTIP_GAP = 8

/**
 * Where a tooltip `width` × `height` goes above a plot (docs/DESIGN.md §9.22: the trend's tooltip
 * sits above the plot), in viewport coordinates. It is centred on the column at `x` (from the
 * plot's left edge) and kept within the plot's width, then within the `visible` part of the screen,
 * TOOLTIP_GAP from its edges. Its bottom is TOOLTIP_GAP above the plot's top, so it covers no
 * column, line or label of the chart, only what is above the chart, as a popover does. When the
 * visible area has no room above the plot (the chart is at the top of the screen), it goes the
 * same distance under the plot instead; with room on neither side, on the side with more.
 */
export function placeAbovePlot(o: {
  x: number
  /** The plot with its axis band, in viewport coordinates. */
  plot: Box
  /** The part of the viewport that shows the chart's scrolling content. */
  visible: Box
  width: number
  height: number
}): { left: number; top: number; side: 'above' | 'below' } {
  const plotWidth = o.plot.right - o.plot.left
  const inPlot =
    o.width <= plotWidth
      ? clamp(o.plot.left + o.x - o.width / 2, o.plot.left, o.plot.right - o.width)
      : o.plot.left + (plotWidth - o.width) / 2
  const minLeft = o.visible.left + TOOLTIP_GAP
  const maxLeft = o.visible.right - TOOLTIP_GAP - o.width
  const left = maxLeft >= minLeft ? clamp(inPlot, minLeft, maxLeft) : minLeft
  const above = o.plot.top - TOOLTIP_GAP - o.height
  const below = o.plot.bottom + TOOLTIP_GAP
  if (above >= o.visible.top) return { left, top: above, side: 'above' }
  if (below + o.height <= o.visible.bottom) return { left, top: below, side: 'below' }
  return o.plot.top - o.visible.top >= o.visible.bottom - o.plot.bottom
    ? { left, top: above, side: 'above' }
    : { left, top: below, side: 'below' }
}
