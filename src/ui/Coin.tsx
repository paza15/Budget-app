import type { ReactNode } from 'react'
import styles from '@/ui/Coin.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export type CoinSize = 'sm' | 'md' | 'lg'

/** Glyph size in px for each coin size (docs/DESIGN.md §9.9): 26/15, 34/19, 56/28. */
export const COIN_GLYPH_SIZE: Readonly<Record<CoinSize, number>> = { sm: 15, md: 19, lg: 28 }

export interface CoinProps extends TestIdProps {
  /** Default 'md'. */
  size?: CoinSize
  /** 'ink' (default) for category glyphs, 'muted' (--ink-2) for empty states. */
  tone?: 'ink' | 'muted'
  className?: string
  children?: ReactNode
}

/**
 * The engraved coin: a circle with a hairline ring holding a light glyph, monochrome. 'lg' adds the
 * inner rim ring. Decorative; the surrounding control names what it shows.
 */
export function Coin({ size = 'md', tone = 'ink', className, children, 'data-testid': testId, 'data-id': dataId }: CoinProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.coin, styles[size], tone === 'muted' && styles.muted, className)}
      data-testid={testId}
      data-id={dataId}
    >
      {children}
    </span>
  )
}
