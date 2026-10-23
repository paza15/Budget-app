import { useUiStore } from '@/store/uiStore'

/**
 * The share sheet and the file picker are system sheets the app opens itself. While one is open,
 * uiStore.systemSheetOpen tells the auto-lock to ignore the page going hidden and visible again
 * (docs/SPEC.md §3.8 lock triggers), so exporting or choosing a backup never locks the app.
 */

/**
 * How long the flag stays up after the sheet has closed. When a sheet goes away, the page can
 * report it becoming visible again just after the share promise settles or the picker reports its
 * file, so the flag outlives the sheet by a moment. Kept short: a hide in this window is ignored too.
 */
export const SYSTEM_SHEET_GRACE_MS = 500

/** Sheets open now: a release that arrives after another sheet has opened must not lower the flag. */
let holds = 0

/**
 * Raises systemSheetOpen until the returned function is called (more calls do nothing). Call it
 * right before the app opens a system sheet, and release it once the sheet has closed.
 */
export function holdSystemSheet(): () => void {
  holds += 1
  useUiStore.getState().setSystemSheetOpen(true)
  let released = false
  return () => {
    if (released) return
    released = true
    setTimeout(() => {
      holds = Math.max(0, holds - 1)
      if (holds === 0) useUiStore.getState().setSystemSheetOpen(false)
    }, SYSTEM_SHEET_GRACE_MS)
  }
}
