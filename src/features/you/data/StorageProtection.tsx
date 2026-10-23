import { StatusRow } from '@/features/you/data/StatusRow'
import { useStorageStatus } from '@/store/persistence'

/**
 * Whether iOS may clear the app's storage when the iPhone runs low (docs/SPEC.md §3.7): persisted
 * storage is "Protected from automatic cleanup". Unknown (no storage API, as outside https) counts
 * as not protected, because nothing confirms the protection.
 */
export function StorageProtection() {
  const persisted = useStorageStatus((s) => s.persisted)
  return persisted === true ? (
    <StatusRow tone="good">Protected from automatic cleanup</StatusRow>
  ) : (
    <StatusRow tone="warning" lead="Not protected:">
      {"iOS may remove the app's data when storage runs low. Keep a recent backup."}
    </StatusRow>
  )
}
