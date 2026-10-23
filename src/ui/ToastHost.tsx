import { useSyncExternalStore, type CSSProperties, type FocusEvent } from 'react'
import { Icon } from '@/ui/Icon'
import { cx } from '@/ui/text'
import styles from '@/ui/ToastHost.module.css'
import { currentToast, dismissToast, pauseToast, resumeToast, subscribeToast, type ToastState } from '@/ui/toast'
import { useVisualViewport } from '@/ui/useVisualViewport'

function noToast(): null {
  return null
}

/**
 * Renders the current toast (test id 'toast') inside a status live region (docs/DESIGN.md §9.18).
 * Mounted once, by App. The region is always in the page, so VoiceOver announces each new toast.
 */
export function ToastHost() {
  const current = useSyncExternalStore(subscribeToast, currentToast, noToast)
  const { top, height, keyboard } = useVisualViewport()
  // Above the tab bar, or above the keyboard while it is up (then the frame is the visual viewport).
  const keyboardUp = keyboard > 0
  const frame = keyboardUp ? ({ '--vv-top': `${top}px`, '--vv-height': `${height}px` } as CSSProperties) : undefined
  return (
    <div className={styles.frame} style={frame} data-keyboard={keyboardUp || undefined}>
      {/* <output> is a status live region (role=status, polite). */}
      <output className={styles.region} aria-live="polite" aria-atomic="true">
        {current ? <ToastView key={current.id} toast={current} /> : null}
      </output>
    </div>
  )
}

export interface ToastViewProps {
  toast: ToastState
  /** A static preview inside the page (gallery): no enter animation. */
  inline?: boolean
}

/** The toast pill: the message and an optional action such as Undo. */
export function ToastView({ toast, inline = false }: ToastViewProps) {
  const { id, message, action, tone, leaving } = toast
  // Hold the toast while a finger or the pointer rests on it or focus is inside it.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) resumeToast(id)
  }
  return (
    <div
      className={cx(styles.toast, inline && styles.inline)}
      data-testid={inline ? undefined : 'toast'}
      data-tone={tone}
      data-state={leaving ? 'leaving' : 'shown'}
      data-action={action ? '' : undefined}
      onPointerEnter={() => pauseToast(id)}
      onPointerLeave={() => resumeToast(id)}
      onFocus={() => pauseToast(id)}
      onBlur={onBlur}
    >
      {/* Status shows as a shape, not a colour: the pill's ink is the only one with contrast on it. */}
      {tone === 'success' ? <Icon name="check" size={16} className={styles.icon} /> : null}
      {tone === 'critical' ? <Icon name="critical" size={16} className={styles.icon} /> : null}
      <span className={styles.message}>{message}</span>
      {action ? (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            dismissToast(id)
            action.onClick()
          }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
