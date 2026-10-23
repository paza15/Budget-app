import { useRef, useState } from 'react'
import { useNav } from '@/app/nav'
import { formatPeriodName } from '@/domain/period'
import type { MonthKey } from '@/domain/types'
import { monthResult } from '@/domain/wallet'
import styles from '@/features/review/ReviewBanner.module.css'
import { actions } from '@/store/actions'
import { useMoneyFormat, useMonthSummary, useSettings, useUnreviewedMonth } from '@/store/hooks'
import { Banner, Money } from '@/ui'

/**
 * The "{month} is closed" banner on Home (docs/SPEC.md §3.15, docs/design/EXTRAS.md §1.6): the first
 * open after a period closed, until its review is opened or the banner dismissed. The shell's
 * AppBanners decides where and when it shows (the current period's Home, one non-critical banner
 * at a time); it renders nothing once the closed period has been reviewed.
 */
export function ReviewBanner() {
  const month = useUnreviewedMonth()
  if (month === null) return null
  // A new closed period starts with a banner of its own.
  return <ClosedMonthBanner key={month} month={month} />
}

/** "640ms", "0.2s" in ms; the fallback when the token is missing. */
function timeOf(value: string, fallback: number): number {
  const text = value.trim()
  const amount = Number.parseFloat(text)
  if (!Number.isFinite(amount)) return fallback
  return text.endsWith('ms') ? amount : text.endsWith('s') ? amount * 1000 : fallback
}

/**
 * Dismissing collapses the banner (EXTRAS.md §1.9): its height, its margins and its opacity go to 0
 * over --dur-grow with --ease-out, and the hero rises with it. The Screen's banner slot spaces its
 * banners with their own margins (2 above the first, 6 below the last, and the space between two),
 * so the collapse starts from the margins the slot gives this one: nothing snaps in the first frame,
 * and the spacing leaves with the banner, so nothing jumps when it is removed. With Reduce Motion
 * it only fades, in --dur-fade, and the layout jumps. Null without the Web Animations API.
 */
function collapse(element: HTMLElement): { animation: Animation; duration: number } | null {
  if (typeof element.animate !== 'function') return null
  const style = getComputedStyle(element)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced) {
    const duration = timeOf(style.getPropertyValue('--dur-fade'), 200)
    return { animation: element.animate([{ opacity: 1 }, { opacity: 0 }], { duration, fill: 'forwards' }), duration }
  }
  const duration = timeOf(style.getPropertyValue('--dur-grow'), 320)
  const easing = style.getPropertyValue('--ease-out').trim() || 'ease-out'
  const animation = element.animate(
    [
      {
        height: `${element.offsetHeight}px`,
        marginTop: style.marginTop || '0px',
        marginBottom: style.marginBottom || '0px',
        opacity: 1,
      },
      { height: '0px', marginTop: '0px', marginBottom: '0px', opacity: 0 },
    ],
    { duration, easing, fill: 'forwards' },
  )
  return { animation, duration }
}

function ClosedMonthBanner({ month }: { month: MonthKey }) {
  const { monthStartDay, locale } = useSettings()
  const summary = useMonthSummary(month)
  const money = useMoneyFormat()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [dismissing, setDismissing] = useState(false)
  const name = formatPeriodName(month, monthStartDay, locale)
  // income − fixed − daily (§4.8): what the closing moved into the wallet, or took out of it.
  const result = monthResult(summary)

  const openReview = () => {
    // The banner goes behind the sheet at once, without its collapse (EXTRAS.md §1.9).
    useNav.getState().openSheet({ name: 'monthReview', month })
    actions.markReviewed(month)
  }

  const dismiss = () => {
    if (dismissing) return
    const element = wrapRef.current
    const run = element === null ? null : collapse(element)
    if (run === null) {
      actions.markReviewed(month)
      return
    }
    setDismissing(true)
    let done = false
    const finish = () => {
      if (done) return
      done = true
      actions.markReviewed(month)
    }
    run.animation.finished.then(finish, finish)
    // A timeline that stalls (the app sent to the background) still records the dismissal.
    window.setTimeout(finish, run.duration + 500)
  }

  return (
    <div ref={wrapRef} className={styles.wrap} data-dismissing={dismissing || undefined} inert={dismissing}>
      <Banner
        tone="statement"
        label={`${name} is closed`}
        action={{ label: 'See the review', onClick: openReview }}
        onDismiss={dismiss}
        dismissLabel="Dismiss"
        data-testid="banner-review"
      >
        <strong>{name} is closed.</strong>
        {/* Hidden amounts leave the second sentence out (EXTRAS.md §1.6). */}
        {!money.masked && (
          <>
            {result < 0 ? ' Taken from your wallet: ' : ' Moved to your wallet: '}
            <Money cents={Math.abs(result)} />.
          </>
        )}
      </Banner>
    </div>
  )
}
