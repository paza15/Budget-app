import type { ReactNode } from 'react'
import styles from '@/ui/Banner.module.css'
import { Engraving } from '@/ui/Engraving'
import { Icon } from '@/ui/Icon'
import type { UiIconName } from '@/ui/icons/manifest'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface BannerAction {
  label: string
  onClick(): void
}

export type BannerTone = 'info' | 'warning' | 'critical' | 'statement'

export interface BannerProps extends TestIdProps {
  /**
   * info: --accent-soft (update ready). warning: --warning-soft (backup nudge, install hint).
   * critical: --critical-soft (storage errors). statement: --surface, statement paper with the
   * brass Closed seal (the month-end review banner, docs/design/EXTRAS.md §1.6).
   */
  tone: BannerTone
  /** The message in Subhead --ink. A leading sentence in <strong> is set in 600 ("October is closed."). */
  children?: ReactNode
  /** The main action, Subhead 600 in the tone's ink (--accent-ink for info and statement). */
  action?: BannerAction
  /** Shows the dismiss action ("Not now"). */
  onDismiss?(): void
  /** Default "Not now". The review banner says "Dismiss": it does not come back. */
  dismissLabel?: string
  /**
   * Default: reload (info), warning (warning), critical (critical). The backup nudge uses 'backup'.
   * Ignored by 'statement', which always carries the 22px Closed seal.
   */
  icon?: UiIconName
  /**
   * Names the banner, which makes it a region (a landmark) instead of a live region, e.g. the
   * review banner "October is closed" (EXTRAS.md §1.8). Unnamed, a critical banner is an alert and
   * the others are status messages.
   */
  label?: string
  className?: string
}

const ICONS: Readonly<Record<Exclude<BannerTone, 'statement'>, UiIconName>> = {
  info: 'reload',
  warning: 'warning',
  critical: 'critical',
}

function roleOf(tone: BannerTone, label: string | undefined): 'region' | 'alert' | 'status' {
  if (label) return 'region'
  return tone === 'critical' ? 'alert' : 'status'
}

/**
 * A message in the content flow under the header, never floating (docs/DESIGN.md §9.19): radius 22,
 * a 22px icon in the tone's colour, Subhead text in --ink, and the actions 8 below, 18 apart. The
 * statement tone is a card of statement paper whose icon is the brass Closed seal, decorative
 * because its words say the month is closed (EXTRAS.md §1.6, §1.8).
 */
export function Banner({
  tone,
  children,
  action,
  onDismiss,
  dismissLabel = 'Not now',
  icon,
  label,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: BannerProps) {
  return (
    <div
      role={roleOf(tone, label)}
      aria-label={label || undefined}
      className={cx(styles.banner, styles[tone], className)}
      data-tone={tone}
      data-testid={testId}
      data-id={dataId}
    >
      {tone === 'statement' ? (
        <Engraving kind="seal" size={22} className={styles.icon} />
      ) : (
        <Icon name={icon ?? ICONS[tone]} size={22} className={styles.icon} />
      )}
      <div className={styles.body}>
        <div className={styles.text}>{children}</div>
        {(action || onDismiss) && (
          <div className={styles.actions}>
            {action && (
              <button type="button" className={styles.action} onClick={action.onClick}>
                {action.label}
              </button>
            )}
            {onDismiss && (
              <button type="button" className={cx(styles.action, styles.dismiss)} onClick={onDismiss}>
                {dismissLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
