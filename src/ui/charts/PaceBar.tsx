import { type RefObject, useLayoutEffect, useRef } from 'react'
import type { Cents } from '@/domain/types'
import { ChartTable } from '@/ui/charts/ChartTable'
import { classNames } from '@/ui/charts/classNames'
import { MaskedText } from '@/ui/MaskedText'
import styles from '@/ui/charts/PaceBar.module.css'
import {
  PACE,
  paceDayText,
  paceGeometry,
  type PaceInput,
  type PaceSegment,
  paceSentence,
} from '@/ui/charts/paceGeometry'
import { FALLBACK_WIDTH, round2, snap } from '@/ui/charts/scale'
import { useChartBox } from '@/ui/charts/useChartBox'
import { useMoneyFormatContext } from '@/ui/MoneyFormatContext'
import type { TestIdProps } from '@/ui/types'

export interface PaceBarProps extends TestIdProps {
  /** Daily spending so far. */
  spent: Cents
  /** What there is for daily life this month. */
  available: Cents
  /** Share of the period gone (the "today" notch), or null for past periods. */
  timeRatio: number | null
  status: 'ok' | 'ahead' | 'over'
  /**
   * Days in the period (summary.days): draws a tick per day boundary and the caption's
   * "Day 18 of 31", or "30 days" when timeRatio is null. Without it there are no ticks.
   */
  days?: number
  /** The caption under the bar: "Spent 336,40 € of 571,12 €" and the day. Default true. */
  caption?: boolean
  className?: string
}

const PART_CLASS: Record<PaceSegment['part'], string | undefined> = {
  fill: styles.fill,
  ahead: styles.ahead,
  over: styles.over,
  nub: styles.over,
}

/**
 * Spending against the money for daily life, drawn as the month's ruler (docs/DESIGN.md §9.5):
 * a 6px track with the ink fill, a tick per day boundary (every fifth longer, the days from
 * today on paler), a notch for today, a warning part beyond the notch when spending runs ahead,
 * and the full critical bar with a 2px gap and an overflow nub when over budget. The fill grows
 * when an entry changes `spent` (not with Reduce Motion).
 */
export function PaceBar({
  spent,
  available,
  timeRatio,
  status,
  days,
  caption = true,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: PaceBarProps) {
  const [boxRef, box] = useChartBox<HTMLDivElement>()
  const width = box?.width ?? FALLBACK_WIDTH
  const money = useMoneyFormatContext()
  const input: PaceInput = { width, spent, available, timeRatio, status, days }
  const geometry = paceGeometry(input)
  const growRef = useRef<SVGRectElement>(null)
  useGrowOnEntry(growRef, input)

  const spentText = money.format(spent)
  const availableText = money.format(available)
  const dayText = paceDayText(geometry.dayIndex, days)
  const sentence = paceSentence({ spent, available, status, dayIndex: geometry.dayIndex, days })

  return (
    <div
      ref={boxRef}
      className={classNames(styles.root, className)}
      data-status={status}
      data-testid={testId}
      data-id={dataId}
    >
      <svg
        className={styles.svg}
        width="100%"
        height={PACE.height}
        viewBox={`0 0 ${round2(width)} ${PACE.height}`}
        // An inline SVG chart cannot be an <img>; role="img" names the picture (DESIGN.md §9.22).
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="img"
        aria-label={sentence}
      >
        <rect
          className={styles.track}
          x={0}
          y={PACE.trackY}
          width={round2(width)}
          height={PACE.trackHeight}
          rx={PACE.radius}
        />
        {geometry.segments.map((segment) => (
          <Segment key={segment.part} segment={segment} growRef={segment.grows ? growRef : undefined} />
        ))}
        {geometry.ticks.map((tick) => (
          <rect
            key={tick.day}
            className={styles.tick}
            data-past={tick.past ? '' : undefined}
            x={snap(tick.x - 0.5)}
            y={PACE.tickY}
            width={1}
            height={tick.long ? PACE.tickLongHeight : PACE.tickHeight}
          />
        ))}
        {geometry.notchX !== null && (
          // No knockout around the notch: a fill even 1px past it still shows (§9.5).
          <rect
            className={styles.notch}
            data-part="notch"
            x={snap(geometry.notchX - PACE.notchWidth / 2)}
            y={PACE.notchY}
            width={PACE.notchWidth}
            height={PACE.notchHeight}
            rx={1}
          />
        )}
      </svg>
      {caption && (
        // The hidden table below carries the same values for VoiceOver.
        <p className={styles.caption} aria-hidden="true" data-part="caption">
          <span>
            Spent <MaskedText text={spentText} /> of <MaskedText text={availableText} />
          </span>
          {dayText !== null && <span>{dayText}</span>}
        </p>
      )}
      <ChartTable
        caption="Spending pace"
        rows={[
          { key: 'spent', header: 'Spent', cells: [{ key: 'value', text: spentText }] },
          { key: 'available', header: 'Money for daily life', cells: [{ key: 'value', text: availableText }] },
          ...(dayText === null ? [] : [{ key: 'day', header: 'Period', cells: [{ key: 'value', text: dayText }] }]),
        ]}
      />
    </div>
  )
}

function Segment({ segment, growRef }: { segment: PaceSegment; growRef?: RefObject<SVGRectElement | null> }) {
  const className = PART_CLASS[segment.part]
  return (
    <>
      <rect
        ref={growRef}
        className={className}
        data-part={segment.part}
        x={round2(segment.x)}
        y={PACE.trackY}
        width={round2(segment.width)}
        height={PACE.trackHeight}
        rx={PACE.radius}
      />
      {!segment.roundStart && (
        // The ahead part starts square right after the notch: cover its rounded start.
        <rect
          className={className}
          x={round2(segment.x)}
          y={PACE.trackY}
          width={round2(Math.min(PACE.radius, segment.width))}
          height={PACE.trackHeight}
        />
      )}
    </>
  )
}

/** Width of the part that grows after an entry, or null when nothing grows. */
function growingWidth(input: PaceInput): number | null {
  return paceGeometry(input).segments.find((segment) => segment.grows)?.width ?? null
}

/** Only an entry grows the bar: the same period and width, a different amount spent. */
function isEntry(before: PaceInput, after: PaceInput): boolean {
  return (
    before.spent !== after.spent &&
    before.available === after.available &&
    before.timeRatio === after.timeRatio &&
    before.days === after.days &&
    before.status === after.status &&
    before.width === after.width
  )
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A CSS time such as "320ms" or "0.32s" in milliseconds. */
function durationMs(value: string, fallback: number): number {
  const match = /^\s*(\d*\.?\d+)(ms|s)\s*$/.exec(value)
  if (match === null) return fallback
  const amount = Number(match[1])
  return match[2] === 's' ? amount * 1000 : amount
}

/**
 * After an entry the fill grows from its old length in --dur-grow with --ease-out (§9.5). The
 * render already has the new length; a Web Animation on the CSS width plays the change before
 * the first paint. A month switch, a resize or Reduce Motion changes the bar at once.
 */
function useGrowOnEntry(ref: RefObject<SVGRectElement | null>, input: PaceInput) {
  const previous = useRef<PaceInput | null>(null)
  const { width, spent, available, timeRatio, status, days } = input
  useLayoutEffect(() => {
    const before = previous.current
    const after: PaceInput = { width, spent, available, timeRatio, status, days }
    previous.current = after
    const element = ref.current
    if (before === null || element === null || !isEntry(before, after)) return
    if (typeof element.animate !== 'function' || prefersReducedMotion()) return
    const to = growingWidth(after)
    const from = growingWidth(before) ?? 0
    if (to === null || to === from) return
    const style = getComputedStyle(element)
    element.animate([{ width: `${from}px` }, { width: `${to}px` }], {
      duration: durationMs(style.getPropertyValue('--dur-grow'), 320),
      easing: style.getPropertyValue('--ease-out').trim() || 'ease-out',
    })
  }, [ref, width, spent, available, timeRatio, status, days])
}
