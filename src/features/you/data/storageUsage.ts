import { useEffect, useState } from 'react'

/** How much the app stores on this device, from navigator.storage.estimate() (docs/SPEC.md §3.7 About). */

/** English unit names (the UI is English); only the digits follow the number locale. */
const UNITS = ['bytes', 'kB', 'MB', 'GB'] as const

function numberFormat(numberLocale: string, digits: number): Intl.NumberFormat {
  const options: Intl.NumberFormatOptions = { maximumFractionDigits: digits }
  try {
    return new Intl.NumberFormat(numberLocale, options)
  } catch {
    // A locale the engine lacks (stored as listed, e.g. sq-AL): English digits instead.
    return new Intl.NumberFormat('en-GB', options)
  }
}

/**
 * Bytes as iOS counts storage, in steps of 1000 with the number locale's digits: "1 byte",
 * "512 bytes", "412 kB", "1.4 MB" ("1,4 MB" in de-DE). One decimal below 10 of a unit, whole
 * numbers above.
 */
export function formatBytes(bytes: number, numberLocale: string): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  const digits = unit > 0 && value < 10 ? 1 : 0
  const number = numberFormat(numberLocale, digits).format(value)
  return `${number} ${unit === 0 && value === 1 ? 'byte' : UNITS[unit]}`
}

/** navigator.storage.estimate, where the browser has it (it needs a secure context). */
function estimator(): (() => Promise<StorageEstimate>) | null {
  if (typeof navigator === 'undefined') return null
  const storage = navigator.storage as StorageManager | undefined
  return typeof storage?.estimate === 'function' ? () => storage.estimate() : null
}

/** Bytes in use, null when the browser cannot tell, undefined while it is being asked. */
export function useStorageUsage(): number | null | undefined {
  const [usage, setUsage] = useState<number | null | undefined>(() => (estimator() === null ? null : undefined))
  useEffect(() => {
    const estimate = estimator()
    if (estimate === null) return undefined
    let current = true
    estimate().then(
      (result) => {
        if (current) setUsage(typeof result.usage === 'number' && Number.isFinite(result.usage) ? result.usage : null)
      },
      () => {
        if (current) setUsage(null)
      },
    )
    return () => {
      current = false
    }
  }, [])
  return usage
}
