import { MASKED } from '@/domain/money'
import styles from '@/ui/MaskedText.module.css'

/**
 * Chart text with every masked amount ("•••") in --ink-3, as docs/DESIGN.md §5.4 sets masked
 * amounts, while the words around it keep their ink: "Spent ••• of •••".
 */
export function MaskedText({ text }: { text: string }) {
  const at = text.indexOf(MASKED)
  if (at === -1) return text
  return (
    <>
      {text.slice(0, at)}
      <span className={styles.masked}>{MASKED}</span>
      <MaskedText text={text.slice(at + MASKED.length)} />
    </>
  )
}

/** The same for SVG <text>: masked runs become tspans. */
export function MaskedTspans({ text }: { text: string }) {
  const at = text.indexOf(MASKED)
  if (at === -1) return text
  return (
    <>
      {text.slice(0, at)}
      <tspan className={styles.masked}>{MASKED}</tspan>
      <MaskedTspans text={text.slice(at + MASKED.length)} />
    </>
  )
}
