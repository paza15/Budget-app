import { isValidElement, type ReactNode } from 'react'
import styles from '@/ui/Section.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

/** A text link at the end of a section heading ("See all", "Edit"). */
export interface SectionLink {
  label: string
  onClick(): void
}

export interface SectionProps extends TestIdProps {
  /** Group heading. */
  title?: ReactNode
  /** A control at the end of the heading: a link object ("See all"), or any node. */
  action?: ReactNode | SectionLink
  /** A serif money figure at the end of the heading ("336,40 €"), --ink-2 (docs/DESIGN.md §9.7). */
  meta?: ReactNode
  /** Explanation under the group: Footnote --ink-2, indented to the content. */
  footer?: ReactNode
  /**
   * Heading style (docs/DESIGN.md §9.7, §9.8):
   * - 'card' (default): Title 3, 36 above (Home sections).
   * - 'form': Footnote 600 --ink-2, 26 above and 7 below, indented to the content (form groups).
   * - 'day': Headline, 24 above (Daily day headers), the meta aligned with the row amounts.
   */
  variant?: 'card' | 'form' | 'day'
  /** 'screen' (default): --surface groups 20 from the edges. 'sheet': --surface-raised, 16 from the edges, 48pt form rows. */
  context?: 'screen' | 'sheet'
  /** Renders the children without the inset group (charts with their own group, chip rows). */
  bare?: boolean
  className?: string
  children?: ReactNode
}

function isLink(action: SectionProps['action']): action is SectionLink {
  return typeof action === 'object' && action !== null && !isValidElement(action) && 'onClick' in action
}

/**
 * A titled group of rows: a flat inset group of paper with no border or shadow; rows inside carry
 * their own hairlines.
 */
export function Section({
  title,
  action,
  meta,
  footer,
  variant = 'card',
  context = 'screen',
  bare = false,
  className,
  children,
  'data-testid': testId,
  'data-id': dataId,
}: SectionProps) {
  const hasHeader = title !== undefined || action !== undefined || meta !== undefined
  return (
    <section
      className={cx(styles.section, styles[variant], styles[context], !hasHeader && styles.untitled, className)}
      data-testid={testId}
      data-id={dataId}
    >
      {hasHeader && (
        <div className={styles.header}>
          {title !== undefined && <h2 className={styles.title}>{title}</h2>}
          {meta !== undefined && <span className={styles.meta}>{meta}</span>}
          {isLink(action) ? (
            <button type="button" className={styles.link} onClick={action.onClick}>
              {action.label}
            </button>
          ) : (
            action !== undefined && <div className={styles.action}>{action}</div>
          )}
        </div>
      )}
      {bare ? children : <div className={styles.group}>{children}</div>}
      {footer !== undefined && <p className={styles.footer}>{footer}</p>}
    </section>
  )
}
