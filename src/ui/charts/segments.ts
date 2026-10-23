import type { CategoryColor } from '@/domain/types'

export interface StackedBarSegment {
  key: string
  value: number
  /** A category colour, or 'other' for the folded "{n} more" segment. */
  color: CategoryColor | 'other'
  label: string
}

/** Key of the folded "{n} more" segment that foldSegments adds. */
export const FOLD_KEY = '__more__'

/** Custom property holding a segment's colour: --cat-<color>, or --cat-other for the fold. */
export function segmentColorVar(color: CategoryColor | 'other'): string {
  return `--cat-${color}`
}

/**
 * Where it went (docs/SPEC.md §3.1, docs/DESIGN.md §14.5): segments sorted by value, largest
 * first, with the tail after `limit` folded into one neutral segment (key FOLD_KEY, colour
 * 'other', label "{n} more") when it holds two or more segments. A single remaining segment keeps
 * its own name. Segments without a positive value are left out. Ties keep their input order.
 */
export function foldSegments(
  segments: readonly StackedBarSegment[],
  o: { limit?: number; foldLabel?: (count: number) => string } = {},
): StackedBarSegment[] {
  const limit = Math.max(1, o.limit ?? 5)
  const sorted = segments.filter((segment) => segment.value > 0).toSorted((a, b) => b.value - a.value)
  if (sorted.length <= limit + 1) return sorted
  const tail = sorted.slice(limit)
  return [
    ...sorted.slice(0, limit),
    {
      key: FOLD_KEY,
      value: tail.reduce((sum, segment) => sum + segment.value, 0),
      color: 'other',
      label: (o.foldLabel ?? ((count: number) => `${count} more`))(tail.length),
    },
  ]
}
