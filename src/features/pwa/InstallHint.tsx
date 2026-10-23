import { useId, useState, type ReactNode } from 'react'
import { LS_KEYS } from '@/domain/constants'
import styles from '@/features/pwa/InstallHint.module.css'
import { isIOS, isStandalone, needsInstall } from '@/features/pwa/platform'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Section } from '@/ui/Section'
import { cx } from '@/ui/text'

export interface InstallHintProps {
  /** banner: Home in Safari; gate: onboarding's first step; inline: You → About. */
  variant: 'banner' | 'gate' | 'inline'
  /** gate: "Continue in Safari", after which onboarding goes on to Welcome (docs/SPEC.md §3.9). */
  onContinue?(): void
  /**
   * banner: called after "Don't show again" hid the hint, so the shell can give its place to the
   * next banner at once (EXTRAS.md §1.6), also when storage is blocked and the dismissal is not kept.
   */
  onDismiss?(): void
  className?: string
}

/**
 * Whether the banner variant would show: iOS outside the installed app, and not dismissed for
 * good. With storage blocked it shows (a dismissal then lasts until the hint mounts again).
 */
export function installHintPending(): boolean {
  return needsInstall() && !wasDismissed()
}

/**
 * How to add the app to the Home Screen (docs/SPEC.md §1, §3.9, §3.10, §3.7).
 * - gate: the whole first onboarding step, a full screen that handles the safe areas itself (test
 *   id install-gate). The caller shows it only where needsInstall() is true.
 * - banner: the dismissible hint on Home (test id banner-install). It renders only in iOS Safari,
 *   outside the installed app, until dismissed; the dismissal is kept in localStorage.
 * - inline: the install guide on You → About, with a line saying where the app runs now.
 */
export function InstallHint({ variant, onContinue, onDismiss, className }: InstallHintProps) {
  if (variant === 'gate') return <InstallGate onContinue={onContinue} className={className} />
  if (variant === 'banner') return <InstallBanner onDismiss={onDismiss} className={className} />
  return <InstallGuide className={className} />
}

function InstallGate({ onContinue, className }: Pick<InstallHintProps, 'onContinue' | 'className'>) {
  const titleId = useId()
  return (
    <section className={cx(styles.gate, className)} aria-labelledby={titleId} data-testid="install-gate">
      <div className={styles.gateScroll}>
        <div className={styles.gateBody}>
          <h1 id={titleId} className={styles.title}>
            Install On a Budget first
          </h1>
          <p className={styles.lead}>
            {
              "The app keeps your money data inside the Home Screen app. Anything you enter here in Safari stays in Safari, and Safari can clear it if you don't visit for a while."
            }
          </p>
          <InstallSteps />
        </div>
      </div>
      <div className={styles.gateActions}>
        <Button variant="secondary" size="lg" block onClick={onContinue}>
          Continue in Safari
        </Button>
      </div>
    </section>
  )
}

function InstallBanner({ onDismiss, className }: Pick<InstallHintProps, 'onDismiss' | 'className'>) {
  // Where the app runs cannot change while the page is open, so this is decided once per mount.
  const [hidden, setHidden] = useState(() => !installHintPending())
  if (hidden) return null
  const dismiss = (): void => {
    rememberDismissal()
    setHidden(true)
    onDismiss?.()
  }
  return (
    // Dismissing is for good (until the app's data is erased), so the label says so, not "Not now".
    <Banner
      tone="warning"
      onDismiss={dismiss}
      dismissLabel="Don't show again"
      className={className}
      data-testid="banner-install"
    >
      <p className={styles.bannerText}>
        Install On a Budget: tap <MoreButton /> (or Share), then Share, then Add to Home Screen. Entries made in
        Safari stay in Safari, and Safari may delete them after a week without use.
      </p>
      <p className={styles.bannerNote}>
        Already added entries here? Export a backup in Safari, then import it in the installed app.
      </p>
    </Banner>
  )
}

function InstallGuide({ className }: Pick<InstallHintProps, 'className'>) {
  const [where] = useState(currentPlace)
  return <InstallSteps footer={where} className={className} />
}

/** The four steps of docs/SPEC.md §1 (Safari on iOS 26) as a form group titled "How to install". */
function InstallSteps({ footer, className }: { footer?: ReactNode; className?: string }) {
  const titleId = useId()
  return (
    <Section variant="form" title={<span id={titleId}>How to install</span>} footer={footer} className={className}>
      {/* Safari drops list semantics from a list without bullets unless the role is restated. */}
      {/* oxlint-disable-next-line jsx-a11y/no-redundant-roles */}
      <ol role="list" aria-labelledby={titleId} className={styles.steps}>
        <Step number={1}>
          In Safari, tap <MoreButton /> next to the address bar, or <b>Share</b> if you see it.
        </Step>
        <Step number={2}>
          Tap <b>Share</b>, then <b>Add to Home Screen</b>. It may be under <b>View More</b>.
        </Step>
        <Step number={3}>
          Leave <b>Open as Web App</b> on and tap <b>Add</b>.
        </Step>
        <Step number={4}>
          Open <b>On a Budget</b> from your Home Screen.
        </Step>
      </ol>
    </Section>
  )
}

/**
 * A numbered row: the number in a hairline coin, then the instruction. The number stays readable:
 * VoiceOver does not announce positions in a list without markers.
 */
function Step({ number, children }: { number: number; children: ReactNode }) {
  return (
    <li className={styles.step}>
      <span className={styles.number}>{number}</span>
      <span className={styles.text}>{children}</span>
    </li>
  )
}

/** Safari's ••• button: drawn as dots, read as "More". */
function MoreButton() {
  return (
    <>
      <b aria-hidden="true">•••</b>
      <span className="visually-hidden">More</span>
    </>
  )
}

function currentPlace(): string {
  if (isStandalone()) return "You're using the installed app."
  if (isIOS()) return "You're in Safari now. Entries made here stay in Safari."
  return 'These steps are for Safari on iPhone.'
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(LS_KEYS.installHintDismissed) !== null
  } catch {
    return false // Storage is blocked: show the hint; dismissing then hides it until the next mount.
  }
}

function rememberDismissal(): void {
  try {
    localStorage.setItem(LS_KEYS.installHintDismissed, '1')
  } catch {
    // Storage is blocked or full: the hint stays hidden until it mounts again.
  }
}
