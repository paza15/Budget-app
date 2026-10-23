import { Icon, ListRow } from '@/ui'
import styles from './AddRow.module.css'

export interface AddRowProps {
  label: string
  onClick(): void
  disabled?: boolean
}

/**
 * The last row of a list that adds to it ("Add category", "Add a button"), drawn like the Wallet's
 * "Add a goal" (DESIGN.md §9.26): plus-circle regular 22 centred in the coin column, the label in
 * Body --accent-ink.
 */
export function AddRow({ label, onClick, disabled }: AddRowProps) {
  return (
    <ListRow
      leading={
        <span className={styles.coin}>
          <Icon name="plus-circle" size={22} />
        </span>
      }
      title={label}
      tinted
      disabled={disabled}
      onClick={onClick}
    />
  )
}
