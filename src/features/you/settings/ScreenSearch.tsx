import { TextField } from '@/ui'
import { blurOnEnter } from './keyboard'
import styles from './ScreenSearch.module.css'

export interface ScreenSearchProps {
  /** Accessible name of the field ("Search currencies"). */
  label: string
  value: string
  onChange(value: string): void
}

/** The kit's search capsule under a settings page's large title, at the page gutter. */
export function ScreenSearch({ label, value, onChange }: ScreenSearchProps) {
  return (
    <div className={styles.bar} ref={blurOnEnter}>
      <TextField type="search" label={label} placeholder="Search" value={value} onChange={onChange} enterKeyHint="search" />
    </div>
  )
}
