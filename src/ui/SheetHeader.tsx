import { useId, type ReactNode } from 'react'
import { Button } from '@/ui/Button'
import styles from '@/ui/SheetHeader.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface SheetHeaderAction extends TestIdProps {
  label: string
  onClick(): void
  disabled?: boolean
  /**
   * The capsule's label: 'confirm' (default) the tinted --accent-ink 600 of "Save"; 'neutral' a
   * Body --ink label ("Split" with no split set); 'destructive' a Body --critical-ink label
   * ("Delete", docs/DESIGN.md §9.26).
   */
  tone?: 'confirm' | 'neutral' | 'destructive'
  /**
   * Makes the action a disclosure: aria-expanded, and while true the selected look, an --accent
   * fill with an --on-accent 600 label (the open split panel, docs/design/EXTRAS.md §2.1).
   */
  expanded?: boolean
  /** The id of the region the disclosure opens (aria-controls). */
  controls?: string
}

export interface SheetHeaderProps extends TestIdProps {
  title: string
  /**
   * A second centred line under the title, in Footnote --ink-2: the month-end review's range
   * "1 Oct – 31 Oct 2026" (docs/design/EXTRAS.md §1.1). Phrasing content. It also describes the
   * sheet's dialog for VoiceOver.
   */
  subtitle?: ReactNode
  /** Shows the cancel button at the start. */
  onCancel?(): void
  /** Default "Cancel". */
  cancelLabel?: string
  /**
   * Focus starts on the cancel button when the sheet opens, instead of on the dialog itself: the
   * month-end review's "Close" (docs/design/EXTRAS.md §1.8). Sheet looks for data-autofocus.
   */
  focusCancel?: boolean
  /** A button at the end, e.g. "Save". */
  action?: SheetHeaderAction
  className?: string
}

/**
 * Describes the dialog around the subtitle by it (aria-describedby; EXTRAS.md §1.8: the review is
 * "described by its range") for as long as the subtitle is on screen. A ref callback, not state:
 * it runs when the subtitle mounts and its cleanup when it goes. Sheet never sets the attribute.
 */
function describeDialog(subtitle: HTMLElement | null): (() => void) | undefined {
  const dialog = subtitle?.closest('dialog, [role="dialog"]')
  if (!subtitle || !dialog) return undefined
  dialog.setAttribute('aria-describedby', subtitle.id)
  return () => {
    if (dialog.getAttribute('aria-describedby') === subtitle.id) dialog.removeAttribute('aria-describedby')
  }
}

/**
 * The header row of a sheet (docs/DESIGN.md §9.16): a glass "Cancel" capsule at the start, the
 * centred title (and an optional subtitle under it) and an optional capsule at the end: tinted
 * "Save", a neutral or destructive one ("Delete"), or a disclosure ("Split"). It stays at the top while the sheet scrolls, on the sheet's own material, with a
 * scroll-edge fade under it once the content has scrolled; with the grab handle Sheet draws above
 * it, it drags the sheet down.
 */
export function SheetHeader({
  title,
  subtitle,
  onCancel,
  cancelLabel = 'Cancel',
  focusCancel = false,
  action,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: SheetHeaderProps) {
  const subtitleId = useId()
  return (
    <header className={cx(styles.header, className)} data-sheet-header="" data-testid={testId} data-id={dataId}>
      <div className={styles.start}>
        {onCancel ? (
          <Button variant="glass" onClick={onCancel} data-autofocus={focusCancel || undefined}>
            {cancelLabel}
          </Button>
        ) : null}
      </div>
      <div className={styles.titles}>
        <h2 className={styles.title}>{title}</h2>
        {subtitle ? (
          <p id={subtitleId} ref={describeDialog} className={styles.subtitle}>
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className={styles.end}>
        {action ? (
          <Button
            variant="glass"
            tinted={(action.tone ?? 'confirm') === 'confirm'}
            critical={action.tone === 'destructive'}
            selected={action.expanded === true}
            aria-expanded={action.expanded}
            aria-controls={action.controls}
            disabled={action.disabled}
            onClick={action.onClick}
            data-testid={action['data-testid']}
            data-id={action['data-id']}
          >
            {action.label}
          </Button>
        ) : null}
      </div>
    </header>
  )
}
