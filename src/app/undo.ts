import { actions } from '@/store/actions'
import { getData, useAppStore } from '@/store/appStore'
import { toast } from '@/ui'

export interface UndoOptions {
  /** How long the toast offers Undo. Default 6000 ms. */
  durationMs?: number
}

const DEFAULT_UNDO_MS = 6000

/**
 * Runs a change, then shows `message` with Undo (docs/SPEC.md §5.5). Undo restores the data from
 * before the change; the toast closes itself as soon as the data changes again, because Undo
 * would then throw away more than this change. Call it from an event handler. When `run` throws,
 * no toast appears and the promise rejects with that error.
 */
export async function withUndo(message: string, run: () => void | Promise<void>, o: UndoOptions = {}): Promise<void> {
  const durationMs = o.durationMs ?? DEFAULT_UNDO_MS
  const before = getData()
  await run()
  const after = getData()

  let watching = true
  let unsubscribe: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const stopWatching = (): void => {
    if (!watching) return
    watching = false
    unsubscribe?.()
    clearTimeout(timer)
  }

  const handle = toast({
    message,
    durationMs,
    action: {
      label: 'Undo',
      onClick: () => {
        stopWatching()
        // Only the data this change replaced comes back: any later change dismissed the toast.
        if (getData() === after) actions.restore(before)
      },
    },
  })

  const dismissIfChanged = (): void => {
    if (getData() === after) return
    stopWatching()
    handle.dismiss()
  }
  unsubscribe = useAppStore.subscribe(dismissIfChanged)
  // The toast has gone by then, so stop listening; a little slack covers its exit.
  timer = setTimeout(stopWatching, durationMs + 1000)
  dismissIfChanged()
}
