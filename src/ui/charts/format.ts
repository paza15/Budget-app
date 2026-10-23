/** Percent formats by locale; building one costs far more than using it. */
const shareFormats = new Map<string, Intl.NumberFormat>()

function shareFormat(locale: string): Intl.NumberFormat {
  let format = shareFormats.get(locale)
  if (format === undefined) {
    format = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0, numberingSystem: 'latn' })
    shareFormats.set(locale, format)
  }
  return format
}

/**
 * A share as a whole percentage in the user's number locale, e.g. (0.3525, 'de-DE') → "35 %"
 * (Intl's own spacing). A share that rounds to 0 but is not 0 reads "<1 %", so a category with
 * some spending never claims 0 %. Shares are ratios, not amounts, so they are never masked.
 */
export function formatShare(ratio: number, locale: string): string {
  const format = shareFormat(locale)
  const safe = Number.isFinite(ratio) ? Math.max(0, ratio) : 0
  if (safe > 0 && safe < 0.005) return `<${format.format(0.01)}`
  return format.format(safe)
}
