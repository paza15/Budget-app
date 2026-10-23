import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon } from '@/ui/Icon'
import styles from '@/ui/IconButton.module.css'
import type { IconWeight, UiIconName } from '@/ui/icons/manifest'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>, TestIdProps {
  icon: UiIconName
  /** Accessible name. */
  label: string
  /**
   * Default 'plain' (--ink glyph, no fill). 'tinted': --accent-ink glyph. 'filled': --accent
   * circle with an --on-accent glyph. 'glass': the header control of docs/DESIGN.md §9.2, a glass
   * circle with a regular glyph in --ink (eye, search, add).
   */
  variant?: 'plain' | 'tinted' | 'filled' | 'glass'
  /** 'md' (default): 44pt circle, 21px glyph. 'lg': 50pt circle, 24px glyph. */
  size?: 'md' | 'lg'
  /** Overrides the icon's design weight. */
  weight?: IconWeight
  /** Overrides the glyph size in px. */
  iconSize?: number
}

/** A button that shows only an icon; `label` is its accessible name. Touch target at least 44 × 44. */
export function IconButton({
  icon,
  label,
  variant = 'plain',
  size = 'md',
  weight,
  iconSize,
  type = 'button',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx(styles.button, styles[variant], styles[size], className)}
      data-variant={variant}
      data-size={size}
      {...rest}
    >
      <Icon name={icon} weight={weight} size={iconSize ?? (size === 'lg' ? 24 : 21)} />
    </button>
  )
}

export interface GlassGroupProps extends TestIdProps {
  /** Accessible name of the group, e.g. "Month". */
  label: string
  className?: string
  children?: ReactNode
}

/**
 * A glass capsule holding plain IconButtons side by side without dividers, like the month stepper
 * (docs/DESIGN.md §9.3): 44 tall, one 44 × 44 cell per button.
 */
export function GlassGroup({ label, className, children, 'data-testid': testId, 'data-id': dataId }: GlassGroupProps) {
  return (
    <fieldset aria-label={label} className={cx(styles.groupBox, className)} data-testid={testId} data-id={dataId}>
      <div className={styles.group}>{children}</div>
    </fieldset>
  )
}
