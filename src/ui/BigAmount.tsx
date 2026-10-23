import { useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MASKED, type MoneyFormat } from '@/domain/money'
import type { Cents } from '@/domain/types'
import styles from '@/ui/BigAmount.module.css'
import { MASKED_LABEL } from '@/ui/Money'
import { useMoneyFormatContext } from '@/ui/MoneyFormatContext'
import { cx, withTrueMinus } from '@/ui/text'
import type { TestIdProps } from '@/ui/types'
import { useReducedMotion } from '@/ui/useReducedMotion'

export interface BigAmountProps extends TestIdProps {
  cents: Cents
  /** 'critical' sets the figure and its unit in --critical-ink (over budget). Default 'default'. */
  tone?: 'default' | 'critical'
  /**
   * Roll the digits when `cents` changes (the odometer, docs/DESIGN.md §3.3). Pass true only for
   * changes the user caused (add, edit, delete, undo, quick add); a value that arrives with animate
   * false, or on a fresh mount, simply replaces the old one. A change made while the screen is
   * hidden (an inactive tab, whose effects React defers) rolls when it shows again, once.
   */
  animate?: boolean
  /** Shows cents. Default: the user's "Show cents in the big number" (MoneyFormat.showCents). */
  showCents?: boolean
  className?: string
}

/** The smallest size the figure shrinks to before it drops the cents (docs/DESIGN.md §5.4). */
const MIN_SIZE = 34

/**
 * The roll needs the Web Animations API and text measurement; without them (jsdom) the value
 * changes at once.
 */
const CAN_ROLL =
  typeof Element !== 'undefined' &&
  typeof Element.prototype.animate === 'function' &&
  typeof Range !== 'undefined' &&
  typeof Range.prototype.getBoundingClientRect === 'function'

interface Figure {
  /** The number with its sign (a true minus) and the locale's grouping, without the unit. */
  number: string
  symbol: string
  symbolFirst: boolean
  /** The space Intl puts between number and unit; kept in the text, not drawn (the unit has a margin). */
  gap: string
  /** The amount as one string, the way assistive technology reads it. */
  text: string
  hasCents: boolean
}

function figureOf(money: MoneyFormat, cents: Cents, showCents: boolean): Figure {
  const parts = money.parts(cents, { showCents, unmasked: true })
  const full = money.format(cents, { showCents, unmasked: true })
  const inner = parts.symbolFirst
    ? full.slice(parts.symbol.length, full.length - parts.number.length)
    : full.slice(parts.number.length, full.length - parts.symbol.length)
  const rebuilt = parts.symbolFirst ? parts.symbol + inner + parts.number : parts.number + inner + parts.symbol
  const gap = rebuilt === full && /^\s*$/.test(inner) ? inner : ''
  return {
    number: withTrueMinus(parts.number),
    symbol: parts.symbol,
    symbolFirst: parts.symbolFirst,
    gap,
    text: withTrueMinus(full),
    hasCents: money.digits === 2 && parts.number.includes(money.decimalSeparator),
  }
}

/** One odometer run: the drums of the digits that differ between `from` and `to` roll. */
interface Roll {
  from: string
  to: string
  /** The value rose: drums roll upwards (the new digit enters from below). */
  up: boolean
}

const isDigit = (c: string | undefined): c is string => c !== undefined && c >= '0' && c <= '9'

/** Same length, digits where digits were, and the same separators: only then can drums roll. */
function sameShape(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]
    const y = b[i]
    if (isDigit(x) !== isDigit(y) || (!isDigit(x) && x !== y)) return false
  }
  return true
}

/** The digits a drum passes: 9 → 4 falling passes 8, 7, 6, 5; 2 → 7 falling wraps through 1, 0, 9, 8. */
function digitsBetween(from: number, to: number, up: boolean): number[] {
  const steps = up ? (to - from + 10) % 10 : (from - to + 10) % 10
  return Array.from({ length: steps + 1 }, (_, k) => (up ? from + k : from - k + 10) % 10)
}

/**
 * The number while it rolls. Every character is a cell, so each keeps the advance it has in the
 * text (kerning included) and the figure neither grows nor shrinks when the roll starts or ends.
 * The cells of changed digits are drums: a hidden copy of the new digit gives the cell its
 * baseline, and a strip of the digits it passes slides through it.
 */
function rollingNumber(roll: Roll): ReactNode[] {
  const { from, to, up } = roll
  const changed: number[] = []
  for (let i = 0; i < to.length; i += 1) {
    if (isDigit(to[i]) && from[i] !== to[i]) changed.push(i)
  }
  // The figure is ASCII digits and single-unit separators (latn numbering), so i indexes both.
  return Array.from(to, (target, i) => {
    const rank = changed.indexOf(i)
    if (rank < 0) {
      return (
        <span key={i} className={styles.cell} data-cell="">
          {target}
        </span>
      )
    }
    const passed = digitsBetween(Number(from.charAt(i)), Number(target), up)
    const steps = passed.length - 1
    // Falling: the strip is stacked new-to-old and slides down; rising: old-to-new and slides up.
    const stacked = up ? passed : passed.toReversed()
    return (
      <span
        key={i}
        className={cx(styles.cell, styles.drum)}
        data-cell=""
        data-drum=""
        data-from={from.charAt(i)}
        data-to={target}
        // Drums start from the right, the cents first.
        data-order={changed.length - 1 - rank}
        data-start={up ? 0 : -steps}
        data-end={up ? -steps : 0}
      >
        <span className={styles.ghost}>{target}</span>
        <span className={styles.strip} data-strip="" style={{ transform: `translateY(${up ? -steps : 0}em)` }}>
          {stacked.map((digit, k) => (
            // Digits repeat within a strip; the position is the identity.
            <span key={k} className={styles.glyph}>
              {digit}
            </span>
          ))}
        </span>
      </span>
    )
  })
}

/** A CSS time token ("640ms", "0.2s") in ms, or the fallback when it is missing. */
function timeOf(value: string, fallback: number): number {
  const text = value.trim()
  const amount = Number.parseFloat(text)
  if (!Number.isFinite(amount)) return fallback
  return text.endsWith('ms') ? amount : text.endsWith('s') ? amount * 1000 : fallback
}

/**
 * The advance of each character of `text` set in the number's own font, as the text lays it out:
 * kerning, letter-spacing and proportional figures included. Measured once with a hidden span
 * before a roll starts (docs/DESIGN.md §3.3), never during it.
 */
function advancesOf(number: HTMLElement, text: string): number[] {
  const ruler = document.createElement('span')
  ruler.className = styles.ruler ?? ''
  ruler.setAttribute('aria-hidden', 'true')
  ruler.textContent = text
  number.append(ruler)
  const node = ruler.firstChild
  const range = document.createRange()
  const starts: number[] = []
  let end = 0
  if (node) {
    for (let i = 0; i < text.length; i += 1) {
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      starts.push(range.getBoundingClientRect().left)
    }
    range.setStart(node, 0)
    range.setEnd(node, text.length)
    end = range.getBoundingClientRect().right
  }
  ruler.remove()
  return starts.map((start, i) => Math.max(0, (starts[i + 1] ?? end) - start))
}

/**
 * The hero figure (docs/DESIGN.md §2, §5.4): Source Serif 4 at 76px with proportional figures and
 * the currency unit at half size in --ink-2. It shrinks 1px at a time while it overflows its width,
 * never below 34px, and then drops the cents. Honours showCents and masking ("•••", named "Amount
 * hidden"). With `animate`, value changes roll like a counting machine (§3.3): only changed digits
 * become drums, cents first, 45ms apart, each for --dur-value with --ease-counter, clipped with
 * clip-path; a change in the number of digits crossfades instead, and Reduce Motion shows the new
 * value at once. The figure is not a live region: it always exposes the final value as text.
 */
export function BigAmount({
  cents,
  tone = 'default',
  animate = false,
  showCents,
  className,
  'data-testid': testId,
  'data-id': dataId,
}: BigAmountProps) {
  const money = useMoneyFormatContext()
  const reduceMotion = useReducedMotion()
  const wantCents = showCents ?? money.showCents
  const masked = money.masked

  // Fit to width: the font size is set on the element directly (no re-render); dropping the cents
  // is state, remembered for this exact amount and format so a new value starts with cents again.
  const fitKey = `${cents}|${wantCents}|${money.currency}|${money.locale}`
  const [noCents, setNoCents] = useState<{ key: string; widthAtMin: number } | null>(null)
  const dropCents = !masked && wantCents && noCents?.key === fitKey
  const figure = masked ? null : figureOf(money, cents, wantCents && !dropCents)
  const number = figure?.number ?? MASKED

  // Odometer: compare with what was shown last (state adjusted during render, React's pattern for
  // reacting to a changed prop). The roll runs in a layout effect, which React defers while the
  // screen is hidden, so a change made meanwhile rolls when the screen shows.
  const [shown, setShown] = useState({ cents, number, masked })
  const [roll, setRoll] = useState<Roll | null>(null)
  const [fade, setFade] = useState(0)
  if (shown.cents !== cents || shown.number !== number || shown.masked !== masked) {
    setShown({ cents, number, masked })
    const valueChanged = shown.cents !== cents
    if (valueChanged && animate && !masked && !shown.masked) {
      if (!sameShape(shown.number, number)) {
        setRoll(null)
        setFade((n) => n + 1)
      } else {
        setRoll(CAN_ROLL && !reduceMotion ? { from: shown.number, to: number, up: cents > shown.cents } : null)
      }
    } else {
      setRoll(null)
    }
  }

  const rootRef = useRef<HTMLSpanElement>(null)
  const numberRef = useRef<HTMLSpanElement>(null)
  const rollingRef = useRef(false)
  // The figure is re-created by a crossfade, so it is held in state: observing follows the node.
  const [figureEl, setFigureEl] = useState<HTMLSpanElement | null>(null)

  // Shrink to fit: from the token size, at once to the estimate, then 1px at a time while it
  // overflows, never below 34px; then the cents go. Reads the latest render's values.
  const fit = useEffectEvent(() => {
    const root = rootRef.current
    if (!root || !figureEl || masked || rollingRef.current) return
    const available = root.clientWidth
    if (available <= 0) return // hidden (an inactive tab): fit when it shows
    const needed = () => {
      const box = figureEl.getBoundingClientRect()
      // The figure starts 3px left of the box (optical side bearing); that space counts as room.
      return box.width + Math.min(0, box.left - root.getBoundingClientRect().left)
    }
    root.style.removeProperty('font-size')
    let size = Number.parseFloat(getComputedStyle(root).fontSize)
    let width = needed()
    if (width > available) {
      size = Math.max(MIN_SIZE, Math.min(size - 1, Math.floor((size * available) / width)))
      root.style.fontSize = `${size}px`
      width = needed()
      while (width > available && size > MIN_SIZE) {
        size -= 1
        root.style.fontSize = `${size}px`
        width = needed()
      }
    }
    if (!dropCents && figure?.hasCents === true && width > available) setNoCents({ key: fitKey, widthAtMin: width })
    else if (dropCents && noCents !== null && noCents.widthAtMin <= available) setNoCents(null)
  })

  // Fit whenever the width or the figure's size changes: a new value, fonts loading, rotation, or
  // an inactive tab showing again. Observation reports once at the start, before the first paint.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !figureEl || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => fit())
    observer.observe(root)
    observer.observe(figureEl)
    return () => observer.disconnect()
  }, [figureEl])

  // Run the drums with the Web Animations API, then fall back to plain text.
  useLayoutEffect(() => {
    const numberEl = numberRef.current
    if (!roll || !numberEl) return undefined
    const style = getComputedStyle(numberEl)
    const duration = timeOf(style.getPropertyValue('--dur-value'), 640)
    const stagger = timeOf(style.getPropertyValue('--dur-value-stagger'), 45)
    const easing = style.getPropertyValue('--ease-counter').trim() || 'ease-out'
    const before = advancesOf(numberEl, roll.from)
    const after = advancesOf(numberEl, roll.to)
    const cells = [...numberEl.querySelectorAll<HTMLElement>('[data-cell]')]
    const drums = cells.flatMap((cell, index) => (cell.dataset.drum === undefined ? [] : [index]))
    // A cell beside a drum may change its advance too (kerning): it moves with the nearest drum,
    // the one on its right when two are as near (cents first).
    const delayOf = (index: number) => {
      let nearest = drums[0] ?? index
      for (const drum of drums) if (Math.abs(drum - index) <= Math.abs(nearest - index)) nearest = drum
      return Number(cells[nearest]?.dataset.order ?? 0) * stagger
    }
    const animations: Animation[] = []
    cells.forEach((cell, index) => {
      const timing: KeyframeAnimationOptions = { duration, delay: delayOf(index), easing, fill: 'backwards' }
      const from = before[index] ?? 0
      const to = after[index] ?? 0
      // The final width stays once the animation ends; until it starts, the fill holds the old one.
      cell.style.width = `${to}px`
      if (cell.dataset.drum !== undefined || Math.abs(from - to) > 0.01) {
        animations.push(cell.animate([{ width: `${from}px` }, { width: `${to}px` }], timing))
      }
      const strip = cell.querySelector<HTMLElement>('[data-strip]')
      if (strip) {
        animations.push(
          strip.animate(
            [{ transform: `translateY(${cell.dataset.start}em)` }, { transform: `translateY(${cell.dataset.end}em)` }],
            timing,
          ),
        )
      }
    })
    rollingRef.current = true
    let active = true
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        if (!active) return
        rollingRef.current = false
        setRoll((current) => (current === roll ? null : current))
        // Sizes changed during the roll without a fit; the cells already have their final widths.
        fit()
      },
      () => {
        // Cancelled by a newer value or an unmount; that run cleans up after itself.
      },
    )
    return () => {
      active = false
      rollingRef.current = false
      for (const animation of animations) animation.cancel()
    }
  }, [roll])

  const classes = cx(styles.root, tone === 'critical' && styles.critical, className)

  if (masked || figure === null) {
    return (
      <span ref={rootRef} className={classes} data-tone={tone} data-testid={testId} data-id={dataId}>
        <span ref={setFigureEl} className={styles.figure}>
          {/* "•••" must read as words, and an <img> cannot hold text. */}
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
          <span role="img" aria-label={MASKED_LABEL} className={cx(styles.number, styles.masked)}>
            {MASKED}
          </span>
        </span>
      </span>
    )
  }

  const unit = (
    <span className={cx(styles.unit, figure.symbolFirst ? styles.unitBefore : styles.unitAfter)}>{figure.symbol}</span>
  )
  const gap = figure.gap ? <span className={styles.gap}>{figure.gap}</span> : null
  return (
    <span ref={rootRef} className={classes} data-tone={tone} data-testid={testId} data-id={dataId}>
      <span
        key={fade}
        ref={setFigureEl}
        className={cx(styles.figure, fade > 0 && styles.fadeIn)}
        aria-hidden={roll ? true : undefined}
      >
        {figure.symbolFirst && unit}
        {figure.symbolFirst && gap}
        <span ref={numberRef} className={styles.number}>
          {roll ? rollingNumber(roll) : figure.number}
        </span>
        {!figure.symbolFirst && gap}
        {!figure.symbolFirst && unit}
      </span>
      {roll && <span className="visually-hidden">{figure.text}</span>}
    </span>
  )
}
