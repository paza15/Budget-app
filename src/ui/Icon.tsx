import styles from '@/ui/Icon.module.css'
import { UI_ICONS } from '@/ui/icons/generated'
import type { IconWeight, UiIconName } from '@/ui/icons/manifest'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface IconProps extends TestIdProps {
  name: UiIconName
  /**
   * Phosphor weight. Default: the icon's design weight (docs/DESIGN.md §8), which is also drawn
   * when the asked weight was not generated (see src/ui/icons/manifest.ts).
   */
  weight?: IconWeight
  /** Width and height in px; keep it a whole number. Default 24. */
  size?: number
  /** Gives the icon a name and role="img". Without one it is decorative and hidden from assistive technology. */
  label?: string
  className?: string
}

/** A Phosphor icon drawn from the generated path data (docs/SPEC.md §5.8), in currentColor. */
export function Icon({
  name,
  weight,
  size = 24,
  label,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: IconProps) {
  const glyph = UI_ICONS[name]
  const d = (weight === undefined ? undefined : glyph.paths[weight]) ?? glyph.paths[glyph.weight]
  return (
    <svg
      viewBox={glyph.viewBox}
      width={size}
      height={size}
      fill="currentColor"
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cx(styles.icon, className)}
      data-icon={name}
      data-testid={testId}
      data-id={dataId}
    >
      <path d={d} fillRule={glyph.fillRule} />
    </svg>
  )
}
