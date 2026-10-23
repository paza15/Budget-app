import { parseISODate } from '@/domain/dates'
import type { ISODate } from '@/domain/types'

/**
 * Local midnight at the start of `date` (from useToday), in epoch ms. Components may not read the
 * clock during render, so rules measured in days (the backup reminder and nudge) use this as
 * "now": they then switch at most a day late, at the midnight useToday re-renders on.
 */
export function startOfDayMs(date: ISODate): number {
  const { y, m, d } = parseISODate(date)
  return new Date(y, m - 1, d).getTime()
}
