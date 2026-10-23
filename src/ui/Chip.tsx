import type { ReactNode } from 'react'
import type { IconRef } from '@/domain/types'
import { CategoryIcon } from '@/ui/CategoryIcon'
import styles from '@/ui/Chip.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface ChipProps extends TestIdProps {
  /** Pressed state; leave undefined for an action chip (suggestions). */
  selected?: boolean
  /** A category glyph (light, 17px) or emoji before the label. */
  icon?: IconRef
  /** Any other leading content, e.g. <Icon name="calendar" size={16} /> on a date chip. */
  leading?: ReactNode
  /** 'md' (default): 36 tall on --surface with a hairline ring. 'mini': 32 tall on --surface-2 (date chips). */
  size?: 'md' | 'mini'
  onClick?(): void
  disabled?: boolean
  /** Accessible name when the label alone is not enough. */
  label?: string
  className?: string
  children?: ReactNode
}

/**
 * A pill-shaped button (docs/DESIGN.md §9.10): Subhead 500 --ink with an optional glyph, selected in
 * --accent with --on-accent. Max 180px wide; long labels end in an ellipsis. 44pt hit area.
 */
export function Chip({
  selected,
  icon,
  leading,
  size = 'md',
  onClick,
  disabled,
  label,
  className,
  children,
  'data-testid': testId,
  'data-id': dataId,
}: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(styles.chip, size === 'mini' && styles.mini, selected && styles.selected, className)}
      data-testid={testId}
      data-id={dataId}
    >
      {icon !== undefined && <CategoryIcon icon={icon} size={size === 'mini' ? 16 : 17} />}
      {leading}
      <span className={styles.label}>{children}</span>
    </button>
  )
}
