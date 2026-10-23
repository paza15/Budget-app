import type { CSSProperties } from 'react'
import type { IconRef } from '@/domain/types'
import styles from '@/ui/CategoryIcon.module.css'
import { CATEGORY_ICON_PATHS } from '@/ui/icons/generated'
import { CATEGORY_ICON_WEIGHTS } from '@/ui/icons/manifest'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

/** Phosphor keys are kebab-case ASCII ('shopping-cart'); any other IconRef is an emoji. */
const PHOSPHOR_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** What an unknown key draws: the icon that normalisation repairs invalid icons to (docs/SPEC.md §4.7). */
const FALLBACK_KEY = 'circle'

export interface CategoryIconProps extends TestIdProps {
  icon: IconRef
  /** Width and height in px; keep it a whole number. Default 24. */
  size?: number
  className?: string
}

/** True when the IconRef is an emoji rather than a Phosphor key. */
export function isEmojiIcon(icon: IconRef): boolean {
  return !PHOSPHOR_KEY.test(icon)
}

/**
 * A category or quick-add symbol: a light Phosphor glyph by key (docs/DESIGN.md §8), or an emoji
 * drawn at the same size. Decorative: the control around it names the category.
 */
export function CategoryIcon({ icon, size = 24, className, 'data-testid': testId, 'data-id': dataId }: CategoryIconProps) {
  if (isEmojiIcon(icon)) {
    return (
      <span
        aria-hidden="true"
        className={cx(styles.emoji, className)}
        style={{ '--size': `${size}px` } as CSSProperties}
        data-testid={testId}
        data-id={dataId}
      >
        {icon}
      </span>
    )
  }
  const key = CATEGORY_ICON_PATHS[icon] === undefined ? FALLBACK_KEY : icon
  const paths = CATEGORY_ICON_PATHS[key]
  return (
    <svg
      viewBox="0 0 256 256"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cx(styles.glyph, className)}
      // The key drawn, like Icon's data-icon, so tests can tell glyphs apart.
      data-icon={key}
      data-testid={testId}
      data-id={dataId}
    >
      <path d={paths?.[CATEGORY_ICON_WEIGHTS[0]]} />
    </svg>
  )
}
