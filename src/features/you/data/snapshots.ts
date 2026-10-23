import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDate, localDateOf } from '@/domain/dates'
import { dailySnapshotDate } from '@/store/db'
import { listSnapshots, type SnapshotInfo } from '@/store/persistence'
import { entriesPhrase } from '@/features/you/data/importMessage'

/** The automatic copies on this iPhone (docs/SPEC.md §3.7, §5.4 persistence rule 6). */

export type SnapshotsState =
  | { status: 'loading' }
  | { status: 'ready'; copies: SnapshotInfo[] }
  | { status: 'failed' }

const LOADING: SnapshotsState = Object.freeze({ status: 'loading' })
const FAILED: SnapshotsState = Object.freeze({ status: 'failed' })

/**
 * The copies, newest first, read from storage when the screen mounts, and `reload` to read them
 * again from an event handler (after an import or a restore has added a copy). A reload keeps the
 * list on screen until the new one arrives, so the rows never flash.
 */
export function useSnapshots(): { snapshots: SnapshotsState; reload(): void } {
  const [snapshots, setSnapshots] = useState<SnapshotsState>(LOADING)
  // Answers that arrive after the screen has gone are dropped.
  const mounted = useRef(false)

  const reload = useCallback((): void => {
    listSnapshots().then(
      (copies) => {
        if (mounted.current) setSnapshots({ status: 'ready', copies })
      },
      () => {
        if (mounted.current) setSnapshots(FAILED)
      },
    )
  }, [])

  useEffect(() => {
    mounted.current = true
    reload()
    return () => {
      mounted.current = false
    }
  }, [reload])

  return { snapshots, reload }
}

/**
 * A copy's row: "End of Fri 17 Oct" for a daily copy (its label names the day), "Before import,
 * 18 Oct" for the others, with "214 entries" under it.
 */
export function snapshotTitle(copy: SnapshotInfo, numberLocale: string): string {
  if (dailySnapshotDate(copy.key) !== null) return copy.label
  return `${copy.label}, ${formatDate(localDateOf(copy.savedAt), numberLocale, 'short')}`
}

export function snapshotSubtitle(copy: SnapshotInfo): string {
  const phrase = entriesPhrase(copy.transactions)
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}`
}
