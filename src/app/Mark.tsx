import { MARK_PATH, MARK_VIEWBOX } from '@/app/markPath'

export interface MarkProps {
  /** Width and height in px. Default 64 (loading screen, privacy cover, lock screen). */
  size?: number
  className?: string
}

/** The app mark in currentColor. Decorative: whatever shows it names the screen. */
export function Mark({ size = 64, className }: MarkProps) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path fillRule="evenodd" d={MARK_PATH} />
    </svg>
  )
}
