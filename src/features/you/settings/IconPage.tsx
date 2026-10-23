import { CATEGORY_ICONS, EMOJI_CHOICES } from '@/domain/catalog'
import type { IconRef } from '@/domain/types'
import { IconPicker, Section, SheetHeader } from '@/ui'
import styles from './IconPage.module.css'

export interface IconPageProps {
  value: IconRef
  onChange(icon: IconRef): void
  /** Back to the form. */
  onDone(): void
}

/**
 * The icon page of the category and quick-add sheets (docs/SPEC.md §3.7): the sheet's body turns
 * into the kit's IconPicker (CATEGORY_ICONS, then the Emoji tab) on a raised group, as in the
 * component gallery. A choice applies to the form at once; "Done" returns to it.
 */
export function IconPage({ value, onChange, onDone }: IconPageProps) {
  return (
    <>
      <SheetHeader title="Icon" action={{ label: 'Done', onClick: onDone }} />
      <Section context="sheet">
        <div className={styles.picker} data-icon-page="">
          <IconPicker value={value} onChange={onChange} icons={CATEGORY_ICONS} emojis={EMOJI_CHOICES} />
        </div>
      </Section>
    </>
  )
}

/**
 * Where focus goes when the icon page opens (the button that opened it is gone): the page's first
 * control, the chosen tab of "Icons | Emoji".
 */
export function iconPageStart(root: ParentNode | null): HTMLElement | null {
  const page = root?.querySelector('[data-icon-page]')
  return page?.querySelector<HTMLElement>('input:checked') ?? page?.querySelector<HTMLElement>('input') ?? null
}
