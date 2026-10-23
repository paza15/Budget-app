import { create } from 'zustand'
import { createInitialData } from '@/domain/defaults'
import type { AppData } from '@/domain/types'

/**
 * The user's data (docs/SPEC.md §5.4). Components read it with the hooks in hooks.ts and change it
 * only through actions.ts; persistence.ts loads it and saves every change.
 */

export type LoadStatus = 'loading' | 'ready'

export interface AppState {
  data: AppData
  status: LoadStatus
}

/**
 * Until persistence.ts hydrates the store it holds createInitialData(0): default settings,
 * categories and quick adds, no entries. The loading gate keeps it off screen, and it is never
 * saved. When storage cannot be used (a blocking phase) the status turns 'ready' with this data
 * still in place, so the app gets past the loading gate to the storage screen.
 */
export const useAppStore = create<AppState>()(() => ({ data: createInitialData(0), status: 'loading' }))

/** The current data, for event handlers and actions (never during render). */
export function getData(): AppData {
  return useAppStore.getState().data
}
