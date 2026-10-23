import type { ReactNode } from 'react'
import { Engraving } from '@/ui/Engraving'
import { Icon } from '@/ui/Icon'
import styles from '@/ui/Monogram.module.css'
import { cx, firstGrapheme } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface MonogramProps extends TestIdProps {
  name: string
  /** settings.avatar: an emoji, or '' for the initial of `name`. */
  avatar: string
  /** 'sm' 26px, 'md' 32px (default; the Home nav row), 'lg' 64px (You). */
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/** The person glyph for each medallion: 16 at 32 (docs/design/EXTRAS.md §3.1, §5), scaled for 26 and 64. */
const PERSON_SIZE = { sm: 13, md: 16, lg: 28 } as const

/**
 * The profile picture as an engraved medallion (docs/DESIGN.md §3.1, §9.9): the guilloché rim around
 * the initial of the name in SF Pro 600, or the chosen emoji. Without a name or emoji the medallion
 * holds the light person glyph in --ink (EXTRAS.md §3.1). Decorative: the greeting or the row next
 * to it carries the name.
 */
export function Monogram({ name, avatar, size = 'md', className, 'data-testid': testId, 'data-id': dataId }: MonogramProps) {
  const initial = firstGrapheme(name.trim()).toLocaleUpperCase()
  let face: ReactNode
  if (avatar !== '') face = <span className={styles.emoji}>{avatar}</span>
  else if (initial !== '') face = <span className={styles.initial}>{initial}</span>
  else face = <Icon name="person" weight="light" size={PERSON_SIZE[size]} className={styles.person} />
  return (
    <span
      aria-hidden="true"
      className={cx(styles.medal, styles[size], className)}
      data-size={size}
      data-testid={testId}
      data-id={dataId}
    >
      <Engraving kind="medallion" className={styles.rim} />
      {face}
    </span>
  )
}
