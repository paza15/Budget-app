import type { ButtonHTMLAttributes } from 'react'
import styles from '@/ui/Button.module.css'
import { Icon } from '@/ui/Icon'
import type { UiIconName } from '@/ui/icons/manifest'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, TestIdProps {
  /**
   * Default 'primary' (docs/DESIGN.md §9.12):
   * - primary: --accent fill, --on-accent label.
   * - secondary: --surface-2 fill, --accent-ink label.
   * - plain: --accent-ink label, no fill.
   * - destructive: --critical-ink label, no fill; with `filled` a --critical fill (confirmations).
   * - glass: the header and sheet-header capsule (§9.2): glass, Body label in --ink; with `tinted`
   *   the label is --accent-ink 600 ("Save"), with `critical` --critical-ink ("Delete", §9.26), and
   *   `selected` draws an --accent fill with an --on-accent 600 label (an open disclosure such as
   *   "Split", EXTRAS.md §2.1). Disabled, the label turns --ink-disabled at full opacity.
   */
  variant?: 'primary' | 'secondary' | 'plain' | 'destructive' | 'glass'
  /** lg 54 tall (Headline), md 44 (Subhead 600), sm 32 with a 44 hit area. Default 'md'. Glass is always 44. */
  size?: 'lg' | 'md' | 'sm'
  /** Icon before the label, in its design weight. */
  icon?: UiIconName
  /** Stretch to the container's width. */
  block?: boolean
  /** destructive only: a --critical fill instead of a plain label. */
  filled?: boolean
  /** glass only: the tinted label of the confirming action. */
  tinted?: boolean
  /** glass only: the --critical-ink label of a destructive action. */
  critical?: boolean
  /** glass only: the selected look, e.g. an open disclosure. Pair it with aria-expanded or aria-pressed. */
  selected?: boolean
}

const ICON_SIZE = { lg: 18, md: 18, sm: 16 } as const

/** A text button. `type` defaults to "button"; every other button attribute passes through. */
export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  block = false,
  filled = false,
  tinted = false,
  critical = false,
  selected = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        variant !== 'glass' && styles[size],
        block && styles.block,
        filled && variant === 'destructive' && styles.filled,
        tinted && variant === 'glass' && styles.tinted,
        critical && variant === 'glass' && styles.critical,
        selected && variant === 'glass' && styles.selected,
        className,
      )}
      data-variant={variant}
      data-size={size}
      data-block={block || undefined}
      {...rest}
    >
      {icon && <Icon name={icon} size={variant === 'glass' ? 17 : ICON_SIZE[size]} />}
      {children}
    </button>
  )
}
