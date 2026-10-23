import { useId } from 'react'
import styles from '@/ui/Engraving.module.css'
import { ENGRAVINGS } from '@/ui/icons/generated'
import type { EngravingKind } from '@/ui/icons/manifest'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export type { EngravingKind }

export interface EngravingProps extends TestIdProps {
  kind: EngravingKind
  /** Width and height in px. Without it the engraving fills its container's width, square. */
  size?: number
  /** Gives the engraving a name and role="img" (the Closed seal). Otherwise it is decorative. */
  label?: string
  className?: string
}

/**
 * One of the static guilloché engravings of docs/DESIGN.md §3.1, drawn from docs/design/engraving-*.svg
 * (extracted by scripts/build-icons.mjs): the rosette (lock, welcome) in --engrave, the Closed seal
 * in --brass, the medallion rim of the monogram in --ink. Strokes do not scale, so the hairline is
 * the same at every size. Engravings never move. Inline each one once per screen: ids are prefixed
 * per instance, so a second copy in the same document stays valid.
 */
export function Engraving({ kind, size, label, className, 'data-testid': testId, 'data-id': dataId }: EngravingProps) {
  const engraving = ENGRAVINGS[kind]
  // useId gives "_r_1_" in React 19.3; keep only characters that are safe in an id and a URL fragment.
  const prefix = `eg${useId().replace(/[^A-Za-z0-9_-]/g, '')}-`
  return (
    <svg
      viewBox={engraving.viewBox}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cx(styles.engraving, styles[kind], size === undefined && styles.fill, className)}
      data-engraving={kind}
      data-testid={testId}
      data-id={dataId}
    >
      <defs>
        {engraving.paths.map((path) => (
          <path key={path.id} id={prefix + path.id} d={path.d} vectorEffect="non-scaling-stroke" />
        ))}
      </defs>
      {engraving.uses.map((use, index) => (
        <use
          // The list is static data, so the index is a stable key.
          key={index}
          href={`#${prefix}${use.id}`}
          transform={use.rotate === 0 ? undefined : `rotate(${use.rotate})`}
        />
      ))}
    </svg>
  )
}
