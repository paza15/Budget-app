import { useId, useState, type FormEvent } from 'react'
import { EMOJI_CHOICES } from '@/domain/catalog'
import { MAX_LENGTHS } from '@/domain/constants'
import { actions } from '@/store/actions'
import { useData } from '@/store/hooks'
import { EmojiPicker, Icon, Monogram, Section, TextField } from '@/ui'
import styles from './ProfileGroup.module.css'

/**
 * The avatar choices: the faces, animals and nature at the start of EMOJI_CHOICES, the part that
 * suits a profile picture (catalog.ts lists them first for that reason).
 */
const AVATAR_CHOICES: readonly string[] = EMOJI_CHOICES.slice(0, EMOJI_CHOICES.indexOf('🔥') + 1)

/** The choices, with an avatar chosen elsewhere (a restored backup) kept at the front. */
function avatarChoices(avatar: string): string[] {
  return avatar === '' || AVATAR_CHOICES.includes(avatar) ? [...AVATAR_CHOICES] : [avatar, ...AVATAR_CHOICES]
}

/** The keyboard's Done key submits the little form: it only puts the keyboard away. */
function onSubmit(event: FormEvent<HTMLFormElement>): void {
  event.preventDefault()
  const active = document.activeElement
  if (active instanceof HTMLElement) active.blur()
}

/**
 * You's profile (docs/SPEC.md §3.7, DESIGN.md §9.9): the 64px monogram medallion with the name in
 * Title 3 and "Name and monogram", one button that opens the editor in place: "Name" (max 24) and
 * the EmojiPicker with "Use my initial". Changes save as they are made, like iOS settings.
 */
export function ProfileGroup() {
  const name = useData((d) => d.settings.name)
  const avatar = useData((d) => d.settings.avatar)
  const [open, setOpen] = useState(false)
  // The name as typed. The store keeps it trimmed, so while the field has focus it shows the
  // draft (a space at the end survives); on blur it shows the stored name again.
  const [draft, setDraft] = useState<string | null>(null)
  const editorId = useId()
  const shownName = name.trim()

  const toggle = () => {
    setOpen((value) => !value)
    setDraft(null)
  }

  const changeName = (text: string) => {
    setDraft(text)
    actions.updateSettings({ name: text })
  }

  return (
    <Section className={styles.section} footer={open ? 'Your name and monogram show at the top of Home.' : undefined}>
      <button
        type="button"
        className={styles.profile}
        aria-expanded={open}
        aria-controls={editorId}
        onClick={toggle}
        data-row=""
      >
        {/* No name and no emoji: the Monogram holds the person glyph itself (EXTRAS.md §3.1). */}
        <Monogram name={name} avatar={avatar} size="lg" className={styles.medal} />
        <span className={styles.text}>
          <span className={styles.name}>{shownName === '' ? 'Add your name' : shownName}</span>
          <span className={styles.subtitle}>Name and monogram</span>
        </span>
        <Icon name="chevron-right" size={14} className={styles.chevron} />
      </button>
      {open && (
        <form id={editorId} className={styles.editor} onSubmit={onSubmit} data-row="">
          <TextField
            variant="form"
            label="Name"
            value={draft ?? name}
            onChange={changeName}
            onBlur={() => setDraft(null)}
            maxLength={MAX_LENGTHS.name}
            placeholder="Your name"
            enterKeyHint="done"
          />
          <div className={styles.picker} data-row="">
            <EmojiPicker
              label="Monogram"
              value={avatar}
              onChange={(emoji) => actions.updateSettings({ avatar: emoji })}
              choices={avatarChoices(avatar)}
              allowEmpty={{ label: 'Use my initial' }}
            />
          </div>
        </form>
      )}
    </Section>
  )
}
