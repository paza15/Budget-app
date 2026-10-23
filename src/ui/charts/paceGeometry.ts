import { clamp } from '@/ui/charts/scale'

/** The pace bar's measurements in CSS px (docs/DESIGN.md §9.5). */
export const PACE = {
  /** Height of the SVG: bar, notch and the longest ticks. */
  height: 26,
  trackY: 6,
  trackHeight: 6,
  radius: 3,
  tickY: 16,
  tickHeight: 4,
  /** Every fifth day boundary. */
  tickLongHeight: 8,
  notchY: 1,
  notchWidth: 2,
  notchHeight: 16,
  /** A fill never draws shorter than this, so a first coffee still shows. */
  minFill: 6,
  /** The overflow nub and the gap before it. */
  nub: 11,
  nubGap: 2,
} as const

export type PaceStatus = 'ok' | 'ahead' | 'over'

export interface PaceSegment {
  /**
   * fill: ink, the money spent. ahead: --warning-mark beyond the notch. over: the full critical
   * bar. nub: the overflow nub at the track end.
   */
  part: 'fill' | 'ahead' | 'over' | 'nub'
  x: number
  width: number
  /** False for the ahead segment, which starts square right after the notch. */
  roundStart: boolean
  /** The segment that grows when an entry is added. */
  grows: boolean
}

export interface PaceTick {
  /** The boundary after this day (1 … days − 1). */
  day: number
  /** Centre of the tick. */
  x: number
  long: boolean
  /** Before today (--ink-3); today and later are paler (--mark). Every tick of a past period is past. */
  past: boolean
}

export interface PaceGeometry {
  /** Spent over available, unclamped: above 1 when over budget. */
  ratio: number
  segments: PaceSegment[]
  /** Centre of the today notch, or null for a period that is not current. */
  notchX: number | null
  /** The day the notch marks (1-based), or null. */
  dayIndex: number | null
  ticks: PaceTick[]
}

export interface PaceInput {
  width: number
  spent: number
  available: number
  timeRatio: number | null
  status: PaceStatus
  days?: number
}

/** Share of the money for daily life that is spent; 1 when nothing was available but money went out. */
export function spendRatio(spent: number, available: number): number {
  if (available > 0) return Math.max(0, spent) / available
  return spent > 0 ? 1 : 0
}

/**
 * The pace bar's marks (docs/DESIGN.md §9.5):
 * - ok: ink from the start to the spent share, at least PACE.minFill, never past the track;
 * - ahead: ink up to 1px before the notch, then --warning-mark from 1px after it to the spent
 *   share with a rounded end;
 * - over: critical to 100% − 13px, a 2px gap, and an 11px nub at the end;
 * - a notch at the time share unless timeRatio is null, and a tick per day boundary when `days`
 *   is known.
 */
export function paceGeometry({ width, spent, available, timeRatio, status, days }: PaceInput): PaceGeometry {
  const ratio = spendRatio(spent, available)
  const time = timeRatio === null || !Number.isFinite(timeRatio) ? null : clamp(timeRatio, 0, 1)
  const notchX = time === null ? null : width * time
  const knownDays = days !== undefined && Number.isInteger(days) && days > 0 ? days : null
  const dayIndex = time !== null && knownDays !== null ? Math.round(time * knownDays) : null

  const segments: PaceSegment[] = []
  if (status === 'over') {
    const nubX = Math.max(0, width - PACE.nub)
    segments.push({ part: 'over', x: 0, width: Math.max(0, nubX - PACE.nubGap), roundStart: true, grows: false })
    segments.push({ part: 'nub', x: nubX, width: width - nubX, roundStart: true, grows: false })
  } else if (ratio > 0) {
    const end = clamp(width * ratio, Math.min(PACE.minFill, width), width)
    const half = PACE.notchWidth / 2
    if (status === 'ahead' && notchX !== null && end > notchX + half) {
      if (notchX - half > 0) {
        segments.push({ part: 'fill', x: 0, width: notchX - half, roundStart: true, grows: false })
      }
      segments.push({ part: 'ahead', x: notchX + half, width: end - notchX - half, roundStart: false, grows: true })
    } else {
      segments.push({ part: 'fill', x: 0, width: end, roundStart: true, grows: true })
    }
  }

  const ticks: PaceTick[] = []
  if (knownDays !== null) {
    for (let day = 1; day < knownDays; day += 1) {
      ticks.push({
        day,
        x: (width * day) / knownDays,
        long: day % 5 === 0,
        past: dayIndex === null || day < dayIndex,
      })
    }
  }

  return { ratio, segments, notchX, dayIndex, ticks }
}

/** "Day 18 of 31" in the current period, "30 days" otherwise; null when the length is unknown. */
export function paceDayText(dayIndex: number | null, days: number | undefined): string | null {
  if (days === undefined || !(days > 0)) return null
  return dayIndex === null ? `${days} days` : `Day ${dayIndex} of ${days}`
}

/**
 * VoiceOver sentence for the bar (docs/DESIGN.md §9.5): "Spent 59 percent of the money for daily
 * life on day 18 of 31". It names a share, never an amount, so it needs no masking.
 */
export function paceSentence(o: {
  spent: number
  available: number
  status: PaceStatus
  dayIndex: number | null
  days?: number
}): string {
  const when =
    o.days === undefined || !(o.days > 0)
      ? ''
      : o.dayIndex === null
        ? ` in ${o.days} days`
        : ` on day ${o.dayIndex} of ${o.days}`
  if (!(o.available > 0)) {
    return o.spent > 0 ? `Over budget: no money was left for daily life${when}` : `No money for daily life${when}`
  }
  const percent = Math.round((Math.max(0, o.spent) / o.available) * 100)
  const spent = `Spent ${percent} percent of the money for daily life${when}`
  if (o.status === 'over') return `Over budget: s${spent.slice(1)}`
  if (o.status === 'ahead') return `${spent}, more than planned by today`
  return spent
}
