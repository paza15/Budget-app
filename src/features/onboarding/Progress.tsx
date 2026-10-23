import styles from '@/features/onboarding/Progress.module.css'

export interface ProgressProps {
  /** 0-based position of the current step among `count`. */
  index: number
  count: number
}

/** Space between ticks, in px. */
const PITCH = 10
/** Height of the ruler, in px: the notch spans it; ticks stand on the baseline. */
const HEIGHT = 16
const TICK_TOP = 7
const BASELINE = 12

/**
 * Onboarding progress as a small ruler, like the pace bar (docs/DESIGN.md §9.25): a tick per step
 * on a hairline baseline, done steps in --ink-3, steps ahead in --mark, and the current step a 2px
 * --ink notch. No numbers on screen; VoiceOver reads "Step 2 of 7".
 */
export function Progress({ index, count }: ProgressProps) {
  const width = (count - 1) * PITCH + 2
  return (
    <span className={styles.progress}>
      <svg
        className={styles.ruler}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        aria-hidden="true"
        focusable="false"
      >
        <rect className={styles.baseline} x={0} y={BASELINE} width={width} height={1} />
        {Array.from({ length: count }, (_, step) => {
          const centre = step * PITCH + 1
          if (step === index) {
            return <rect key={step} className={styles.current} x={centre - 1} y={1} width={2} height={HEIGHT - 2} rx={1} />
          }
          return (
            <rect
              key={step}
              className={step < index ? styles.done : styles.ahead}
              x={centre - 0.5}
              y={TICK_TOP}
              width={1}
              height={BASELINE - TICK_TOP}
            />
          )
        })}
      </svg>
      <span className="visually-hidden">{`Step ${index + 1} of ${count}`}</span>
    </span>
  )
}
