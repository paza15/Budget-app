import { useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/ui/Button'
import { CategoryIcon } from '@/ui/CategoryIcon'
import styles from '@/ui/ConfirmHost.module.css'
import {
  answerDialog,
  currentDialog,
  focusOrigin,
  openModalLayer,
  removeDialog,
  subscribeDialogs,
  transitionMs,
  type ChooseOptions,
  type ConfirmOptions,
  type DialogAnswer,
  type DialogRequest,
} from '@/ui/dialogs'
import { cx } from '@/ui/text'
import { useVisualViewport } from '@/ui/useVisualViewport'

function noDialog(): null {
  return null
}

/** An option's glyph: light, a little larger than the 17px Body label it leads, like a menu image. */
const OPTION_GLYPH_SIZE = 20

/**
 * Renders the dialog opened by confirmDialog or chooseDialog (docs/DESIGN.md §9.17), one at a time
 * in the order they were asked. Mounted once, by App; it renders into document.body.
 */
export function ConfirmHost() {
  const request = useSyncExternalStore(subscribeDialogs, currentDialog, noDialog)
  if (request === null) return null
  return createPortal(<DialogLayer key={request.id} request={request} />, document.body)
}

function DialogLayer({ request }: { request: DialogRequest }) {
  const layerRef = useRef<HTMLDivElement>(null)
  const { top, height, keyboard } = useVisualViewport()
  const { id, closing } = request
  const cancelAnswer: DialogAnswer = request.kind === 'confirm' ? false : null

  // While it waits for an answer the dialog is the top modal layer: everything under it is inert,
  // Escape cancels and Tab stays inside. Focus starts on Cancel when the action is destructive.
  useLayoutEffect(() => {
    const element = layerRef.current
    if (closing || element === null) return
    const close = openModalLayer({
      element,
      opener: focusOrigin(element),
      onEscape: () => answerDialog(id, cancelAnswer),
    })
    element.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
    return close
  }, [closing, id, cancelAnswer])

  // Once answered it fades out, then makes way for the next dialog in the queue.
  useEffect(() => {
    const element = layerRef.current
    if (!closing || element === null) return
    let done = false
    const finish = () => {
      if (done) return
      done = true
      removeDialog(id)
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === element) finish()
    }
    element.addEventListener('transitionend', onEnd)
    const timer = window.setTimeout(finish, transitionMs(element) + 50)
    return () => {
      done = true
      element.removeEventListener('transitionend', onEnd)
      window.clearTimeout(timer)
    }
  }, [closing, id])

  // While the keyboard is up the layer is the visual viewport, so a dialog asked then stays visible.
  const keyboardUp = keyboard > 0
  const frame = keyboardUp ? ({ '--vv-top': `${top}px`, '--vv-height': `${height}px` } as CSSProperties) : undefined
  const answer = (value: DialogAnswer) => answerDialog(id, value)

  return (
    <div
      ref={layerRef}
      className={styles.layer}
      data-kind={request.kind}
      data-state={closing ? 'closing' : 'open'}
      data-keyboard={keyboardUp || undefined}
      style={frame}
    >
      {/* Tapping outside cancels, like Escape. Keyboard and VoiceOver users have the Cancel button. */}
      <div className={styles.scrim} aria-hidden="true" data-dialog-scrim="" onClick={() => answer(cancelAnswer)} />
      {request.kind === 'confirm' ? (
        <AlertCard options={request.options} onAnswer={answer} />
      ) : (
        <ActionSheetCard options={request.options} onAnswer={answer} />
      )}
    </div>
  )
}

export interface AlertCardProps {
  options: ConfirmOptions
  onAnswer(confirmed: boolean): void
  /** A static preview inside the page (gallery): no modal semantics, no animation. */
  inline?: boolean
}

/** The confirmDialog card: an iOS alert with Cancel and the confirm button side by side. */
export function AlertCard({ options, onAnswer, inline = false }: AlertCardProps) {
  const titleId = useId()
  const messageId = useId()
  const { title, message, confirmLabel, cancelLabel = 'Cancel', destructive = false } = options
  return (
    <div
      role={inline ? 'group' : 'alertdialog'}
      aria-modal={inline ? undefined : true}
      aria-labelledby={titleId}
      aria-describedby={message ? messageId : undefined}
      tabIndex={inline ? undefined : -1}
      className={cx(styles.alert, inline && styles.inline)}
    >
      <h2 id={titleId} className={styles.alertTitle}>
        {title}
      </h2>
      {message ? (
        <p id={messageId} className={styles.alertMessage}>
          {message}
        </p>
      ) : null}
      <div className={styles.alertButtons}>
        <Button
          variant="secondary"
          className={styles.alertButton}
          data-autofocus={destructive || undefined}
          onClick={() => onAnswer(false)}
        >
          {cancelLabel}
        </Button>
        {/* Destructive: a --critical fill (Button's filled destructive). */}
        <Button
          variant={destructive ? 'destructive' : 'primary'}
          filled={destructive}
          className={styles.alertButton}
          data-autofocus={destructive ? undefined : true}
          onClick={() => onAnswer(true)}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}

export interface ActionSheetCardProps {
  options: ChooseOptions<string>
  /** The chosen value, or null for Cancel. */
  onAnswer(value: string | null): void
  /** A static preview inside the page (gallery): no modal semantics, no animation. */
  inline?: boolean
}

/** The chooseDialog card: an iOS action sheet with its options in one group and Cancel apart. */
export function ActionSheetCard({ options, onAnswer, inline = false }: ActionSheetCardProps) {
  const titleId = useId()
  const messageId = useId()
  const { title, message, options: choices, cancelLabel = 'Cancel' } = options
  // With a destructive choice on offer, focus starts on the safe way out.
  const focusCancel = choices.some((choice) => choice.destructive === true)
  return (
    <div
      role={inline ? 'group' : 'dialog'}
      aria-modal={inline ? undefined : true}
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : 'Choose an option'}
      aria-describedby={message ? messageId : undefined}
      tabIndex={inline ? undefined : -1}
      className={cx(styles.actionSheet, inline && styles.inline)}
    >
      <div className={styles.group}>
        {title || message ? (
          <div className={styles.head}>
            {title ? (
              <h2 id={titleId} className={styles.headTitle}>
                {title}
              </h2>
            ) : null}
            {message ? (
              <p id={messageId} className={styles.headMessage}>
                {message}
              </p>
            ) : null}
          </div>
        ) : null}
        {choices.map((choice, index) => (
          <button
            key={choice.value}
            type="button"
            className={cx(styles.option, choice.icon && styles.withGlyph, choice.destructive && styles.destructiveOption)}
            data-autofocus={!focusCancel && index === 0 ? true : undefined}
            onClick={() => onAnswer(choice.value)}
          >
            {choice.icon ? (
              <>
                <CategoryIcon icon={choice.icon} size={OPTION_GLYPH_SIZE} className={styles.glyph} />
                <span>{choice.label}</span>
              </>
            ) : (
              choice.label
            )}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={cx(styles.group, styles.cancel)}
        data-autofocus={focusCancel || undefined}
        onClick={() => onAnswer(null)}
      >
        {cancelLabel}
      </button>
    </div>
  )
}
