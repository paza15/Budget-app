import { NOTICES } from '@/features/you/data/licenses'
import styles from '@/features/you/data/Notices.module.css'
import { Icon, Section } from '@/ui'

/**
 * "Open-source notices" on About (docs/SPEC.md §3.7): one row per component the app ships, with
 * what it does and its license. A row opens to show the copyright and the license text. Native
 * <details>, so it opens with VoiceOver, the keyboard and a tap without any state.
 */
export function Notices() {
  return (
    <Section
      variant="form"
      title="Open-source notices"
      footer="On a Budget is built with these open-source components. Tap one to read its license."
    >
      {NOTICES.map((notice) => (
        <details key={notice.name} className={styles.notice} data-row="">
          <summary className={styles.summary}>
            <span className={styles.main}>
              <span className={styles.name}>{notice.name}</span>
              <span className={styles.meta}>
                {notice.use}, {notice.license}
              </span>
            </span>
            <Icon name="chevron-down" size={14} className={styles.chevron} />
          </summary>
          <div className={styles.text}>
            <p>{notice.copyright}</p>
            {notice.paragraphs.map((paragraph) => (
              // No two paragraphs of a license are the same.
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </details>
      ))}
    </Section>
  )
}
