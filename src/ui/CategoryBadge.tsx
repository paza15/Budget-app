import type { CategoryColor, IconRef } from '@/domain/types'
import { CategoryIcon } from '@/ui/CategoryIcon'
import { COIN_GLYPH_SIZE } from '@/ui/Coin'
import coin from '@/ui/Coin.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface CategoryBadgeProps extends TestIdProps {
  icon: IconRef
  /**
   * The category's colour, or null (Uncategorized). It never tints the badge (docs/DESIGN.md §9.9);
   * it is only exposed as data-color, and charts use it for their marks.
   */
  color: CategoryColor | null
  /** 'sm' 26px, 'md' 34px (default), 'lg' 56px with the inner rim. */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/**
 * A category as a monochrome engraved coin: a hairline ring and a light glyph (or the emoji) in
 * --ink. Decorative: the row around it names the category.
 */
export function CategoryBadge({
  icon,
  color,
  size = 'md',
  className,
  'data-testid': testId,
  'data-id': dataId,
}: CategoryBadgeProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(coin.coin, coin[size], className)}
      data-color={color ?? 'none'}
      data-size={size}
      data-testid={testId}
      data-id={dataId}
    >
      <CategoryIcon icon={icon} size={COIN_GLYPH_SIZE[size]} />
    </span>
  )
}
