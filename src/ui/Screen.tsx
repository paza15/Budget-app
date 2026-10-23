import { useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'
import { Icon } from '@/ui/Icon'
import styles from '@/ui/Screen.module.css'
import { cx } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'

export interface ScreenProps extends TestIdProps {
  /** The screen's name: the large title (unless `titleContent` replaces it), the heading and the accessible name. */
  title: string
  /** Shown instead of the title text in the title row, e.g. the MonthTitle; `title` stays as a hidden heading. */
  titleContent?: ReactNode
  /**
   * The nav row's leading text ("Hi, Alex", "Daily spending"): Subhead 500 --ink-2. It hides in the
   * compact header, and ends in an ellipsis when the trailing controls need its room.
   */
  eyebrow?: ReactNode
  /** Shown before the eyebrow and kept in the compact header, e.g. the Monogram. */
  leading?: ReactNode
  /**
   * The title row holds `title` as a large title (or `titleContent`) and collapses into the compact
   * header when it scrolls under the nav row. Default false: without `titleContent` the title then
   * sits centred in the nav row.
   */
  largeTitle?: boolean
  /** Trailing controls of the nav row, 8 apart (glass IconButtons, the MonthStepper, glass Buttons). */
  headerRight?: ReactNode
  /** Shows the back capsule "‹ {backLabel}" at the leading end. */
  onBack?(): void
  /** The previous screen's title. Default "Back". */
  backLabel?: string
  /** Centred title of the compact header. Default `title`. */
  compactTitle?: ReactNode
  /** Footnote line under the compact title ("234,72 € left", "4 of 7 paid"). */
  compactSubtitle?: ReactNode
  /** 'month' sets the compact title in the serif month style (Home, Daily, Fixed). Default 'text'. */
  compactTitleVariant?: 'text' | 'month'
  /**
   * Where the app banners go: 'afterTitle' (default) under the title row, or 'beforeTitle' between
   * the nav row and the title row, for a title row that is the screen's hero (the Wallet).
   */
  bannerSlot?: 'afterTitle' | 'beforeTitle'
  /**
   * Moves focus to the screen's heading once, when it mounts, so VoiceOver announces the screen (an
   * onboarding step). Screens pushed in the shell get this from ScreenStack without asking.
   */
  focusTitle?: boolean
  /** Pads the end of the content to clear the floating tab bar. Default true. */
  tabBar?: boolean
  /** The scroll container, e.g. to scroll back to the top. */
  scrollRef?: Ref<HTMLDivElement>
  className?: string
  children?: ReactNode
}

/** How far the title row may still show under the nav row before the compact header takes over. */
const TITLE_SLACK = 6

/**
 * A full screen with its own scroll container (docs/DESIGN.md §9.2, docs/SPEC.md §7): a sticky nav
 * row (eyebrow or back capsule, trailing glass controls), an optional title row, and a compact
 * header that fades in on opaque --bg with an 18px scroll-edge fade once the title has scrolled
 * under the nav row, then the slot the shell's app banners go into (empty, it takes no space).
 * Respects the safe areas; the content clears the tab bar. The Screen fills its container, which
 * needs a definite height.
 *
 * Its heading (the large title, the hidden title beside `titleContent`, or the centred title) can
 * take focus from script but is not in the tab order, so the shell can move VoiceOver to a screen
 * it has just pushed or that `focusTitle` asks for.
 */
export function Screen({
  title,
  titleContent,
  eyebrow,
  leading,
  largeTitle = false,
  headerRight,
  onBack,
  backLabel = 'Back',
  compactTitle,
  compactSubtitle,
  compactTitleVariant = 'text',
  bannerSlot = 'afterTitle',
  focusTitle = false,
  tabBar = true,
  scrollRef,
  className,
  children,
  'data-testid': testId,
  'data-id': dataId,
}: ScreenProps) {
  const hasTitleRow = largeTitle || titleContent !== undefined
  const scrollerRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const titleRowRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [scroll, setScroll] = useState<{ scrolled: boolean; compact: boolean }>({ scrolled: false, compact: false })

  // Hand the scroll container to the caller's ref as well.
  useImperativeHandle(scrollRef, () => scrollerRef.current as HTMLDivElement, [])

  // Once, on mount: the screen's heading takes focus without scrolling anything.
  const focusHeadingOnMount = useEffectEvent(() => {
    if (focusTitle) headingRef.current?.focus({ preventScroll: true })
  })
  useEffect(() => {
    focusHeadingOnMount()
  }, [])

  // Watch the scroll position once per frame; state changes only when a threshold is crossed.
  useEffect(() => {
    const scroller = scrollerRef.current
    const nav = navRef.current
    if (!scroller || !nav) return undefined
    let frame = 0
    const measure = () => {
      frame = 0
      const titleRow = hasTitleRow ? titleRowRef.current : null
      const scrolled = scroller.scrollTop > 0
      const compact =
        titleRow !== null && titleRow.getBoundingClientRect().bottom - TITLE_SLACK <= nav.getBoundingClientRect().bottom
      setScroll((current) =>
        current.scrolled === scrolled && current.compact === compact ? current : { scrolled, compact },
      )
    }
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    frame = requestAnimationFrame(measure)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [hasTitleRow])

  const compact = hasTitleRow && scroll.compact
  const edge = hasTitleRow ? scroll.compact : scroll.scrolled
  const backName = backLabel === 'Back' ? undefined : `Back to ${backLabel}`

  const centerTitle = (
    <span className={cx(styles.centerTitle, compactTitleVariant === 'month' && styles.monthTitle)}>
      {compactTitle ?? title}
    </span>
  )

  // The app banners (storage errors, update ready, install hint, the month review, the backup
  // nudge) are portalled in here by the shell's AppBanners, which finds the slot by this attribute
  // (BANNER_SLOT_ATTRIBUTE; the kit may not import the shell). React renders nothing else into it.
  const slot = <div className={styles.bannerSlot} data-banner-slot="" />

  return (
    <section
      aria-label={title}
      className={cx(styles.screen, className)}
      data-compact={compact || undefined}
      data-edge={edge || undefined}
      data-testid={testId}
      data-id={dataId}
    >
      <div ref={scrollerRef} className={styles.scroller}>
        {/* While the compact title is hidden it leaves the row, so the trailing controls keep their
            width and the leading side gives way (Screen.module.css). */}
        <header ref={navRef} className={cx(styles.nav, hasTitleRow && !compact && styles.titleHidden)}>
          <div className={styles.leading}>
            {onBack && (
              <button type="button" className={styles.back} onClick={onBack} aria-label={backName}>
                <Icon name="chevron-left" size={17} />
                <span>{backLabel}</span>
              </button>
            )}
            {leading}
            {eyebrow !== undefined && <span className={styles.eyebrow}>{eyebrow}</span>}
          </div>
          {hasTitleRow ? (
            // A visual copy of the title for the scrolled state; the title row keeps the heading.
            <div className={styles.center} aria-hidden="true">
              {centerTitle}
              {compactSubtitle !== undefined && <span className={styles.centerSubtitle}>{compactSubtitle}</span>}
            </div>
          ) : (
            <div className={cx(styles.center, styles.always)}>
              <h1 ref={headingRef} tabIndex={-1} className={cx(styles.heading, styles.focusTarget)}>
                {centerTitle}
              </h1>
              {compactSubtitle !== undefined && <span className={styles.centerSubtitle}>{compactSubtitle}</span>}
            </div>
          )}
          <div className={styles.trailing}>{headerRight}</div>
        </header>
        {bannerSlot === 'beforeTitle' && slot}
        {hasTitleRow && (
          <div ref={titleRowRef} className={largeTitle ? styles.titleRow : styles.titleBlock}>
            {titleContent === undefined ? (
              <h1 ref={headingRef} tabIndex={-1} className={cx(styles.largeTitle, styles.focusTarget)}>
                {title}
              </h1>
            ) : (
              <>
                <h1 ref={headingRef} tabIndex={-1} className="visually-hidden">
                  {title}
                </h1>
                {titleContent}
              </>
            )}
          </div>
        )}
        {bannerSlot === 'afterTitle' && slot}
        <div className={cx(styles.content, tabBar && styles.clearTabBar)}>{children}</div>
      </div>
    </section>
  )
}
