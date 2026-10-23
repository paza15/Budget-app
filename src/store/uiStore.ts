import { create } from 'zustand'

/** Ephemeral UI state shared across features (docs/SPEC.md §5.4). Never persisted. */

export interface UiState {
  /** The user showed hidden amounts with the eye button. Reset when the app is hidden or locked. */
  amountsRevealed: boolean
  setAmountsRevealed(v: boolean): void
  /**
   * A system sheet started by the app (share sheet, file picker, Face ID) is open. While it is,
   * the auto-lock ignores the page going hidden and visible again.
   */
  systemSheetOpen: boolean
  setSystemSheetOpen(v: boolean): void
}

export const useUiStore = create<UiState>()((set) => ({
  amountsRevealed: false,
  setAmountsRevealed: (v) => set({ amountsRevealed: v }),
  systemSheetOpen: false,
  setSystemSheetOpen: (v) => set({ systemSheetOpen: v }),
}))
