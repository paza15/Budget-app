/** Text helpers of the UI kit: true minus signs, graphemes and the emoji input rule. */

/**
 * Money shows a true minus (U+2212), never a hyphen (docs/DESIGN.md §5.4). Intl writes the
 * locale's minus, which is a hyphen-minus in most locales; no other hyphen occurs in an amount.
 */
export function withTrueMinus(text: string): string {
  return text.replaceAll('-', '−')
}

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/**
 * The first user-perceived character of `text` ('' when empty): a whole emoji with its skin tone,
 * flag pairs and ZWJ sequences ("👩‍👩‍👧"), or a letter with its accents.
 */
export function firstGrapheme(text: string): string {
  if (text === '') return ''
  if (segmenter) {
    for (const { segment } of segmenter.segment(text)) return segment
  }
  return Array.from(text)[0] ?? ''
}

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u
/** Emoji are pictographs, or flags (pairs of regional indicators). */
const PICTOGRAPHIC = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u

/**
 * The emoji input rule of the icon picker (docs/SPEC.md §5.8): keeps the first grapheme of what
 * was typed or pasted, and rejects it (null) when it contains a letter or digit or is not an emoji
 * at all (punctuation, "€", a lone skin tone). "😀abc" → "😀", "👍🏽" → "👍🏽", "🇩🇪" → "🇩🇪",
 * "a😀" → null, "1️⃣" → null.
 */
export function emojiFromInput(text: string): string | null {
  const grapheme = firstGrapheme(text.trimStart())
  if (grapheme === '' || LETTER_OR_DIGIT.test(grapheme) || !PICTOGRAPHIC.test(grapheme)) return null
  return grapheme
}

/** Joins class names, skipping empty ones. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}
