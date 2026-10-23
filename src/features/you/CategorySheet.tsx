import { useCallback, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNav, type SheetProps } from '@/app/nav'
import { withUndo } from '@/app/undo'
import { CATEGORY_COLORS } from '@/domain/catalog'
import { MAX_LENGTHS } from '@/domain/constants'
import { categoryUsage, nextFreeCategoryColor, sortedCategories } from '@/domain/queries'
import type { Category, CategoryColor, CategoryKind, Cents, IconRef } from '@/domain/types'
import { DeletePage } from '@/features/you/settings/DeletePage'
import { IconPage, iconPageStart } from '@/features/you/settings/IconPage'
import { blurOnEnter } from '@/features/you/settings/keyboard'
import { returnTo, showPageFrom } from '@/features/you/settings/sheetPages'
import { KIND_OPTIONS, type UsageCounts } from '@/features/you/settings/text'
import { actions } from '@/store/actions'
import { getData } from '@/store/appStore'
import { useData } from '@/store/hooks'
import {
  AmountField,
  CategoryBadge,
  ColorSwatches,
  confirmDialog,
  EmptyState,
  ListRow,
  Section,
  SelectField,
  SheetHeader,
  TextField,
  toast,
  type ColorSwatchOption,
} from '@/ui'

/** The form: what the sheet edits. budget null means no monthly limit. */
interface Fields {
  name: string
  icon: IconRef
  color: CategoryColor
  kind: CategoryKind
  budget: Cents | null
}

type Page = 'form' | 'icon' | 'delete'

/** The ten category inks as swatches (DESIGN.md §4.5), named for VoiceOver. */
const COLOR_OPTIONS: ColorSwatchOption<CategoryColor>[] = CATEGORY_COLORS.map(({ key, name }) => ({
  value: key,
  name,
  cssVar: `--cat-${key}`,
}))

/** A new category starts with the plain circle, inviting a real icon. */
const NEW_ICON: IconRef = 'circle'

function fieldsOf(category: Category | null, categories: readonly Category[]): Fields {
  if (category !== null) {
    const { name, icon, color, kind, budget } = category
    return { name, icon, color, kind, budget }
  }
  // A new category gets the first colour no active category uses, else the least used (§3.7).
  return { name: '', icon: NEW_ICON, color: nextFreeCategoryColor(categories), kind: 'daily', budget: null }
}

function sameFields(a: Fields, b: Fields): boolean {
  return a.name === b.name && a.icon === b.icon && a.color === b.color && a.kind === b.kind && a.budget === b.budget
}

/** What a save stores: the name trimmed, and a limit of 0 means none (budgetStatus treats it so). */
function stored(fields: Fields): Omit<Category, 'id' | 'order' | 'archived'> {
  const budget = fields.budget === null || fields.budget <= 0 ? null : fields.budget
  return { name: fields.name.trim(), icon: fields.icon, color: fields.color, kind: fields.kind, budget }
}

/** After deleting a category from its own detail screen, that screen goes too. */
function leaveDetailOf(id: string): void {
  const nav = useNav.getState()
  const top = nav.stacks[nav.tab].at(-1)
  if (top?.name === 'category' && top.categoryId === id) nav.pop()
}

function failed(what: string): void {
  toast({ message: `Couldn't ${what}. Close the sheet and try again.`, tone: 'critical' })
}

/**
 * Adds or edits a category (docs/SPEC.md §3.7): Name (max 24), Icon (the IconPicker page), Colour
 * (10 swatches; a new one gets the first free colour), "Show in", "Monthly limit", then "See
 * spending", Archive or Restore, and Delete. Deleting an unused category asks a destructive
 * confirmation; a used one turns the body into the move-to list. Deletes and archiving run
 * through withUndo.
 */
export function CategorySheet({ route, onClose, setDirty }: SheetProps<'categoryEdit'>) {
  const categories = useData((d) => d.categories)
  // The category as it was when the sheet opened: the sheet keeps showing it while it closes,
  // also after it was deleted from here.
  const [original] = useState<Category | null>(() => categories.find((c) => c.id === route.id) ?? null)
  const [initial] = useState<Fields>(() => fieldsOf(original, categories))
  const [fields, setFields] = useState<Fields>(initial)
  const [page, setPage] = useState<Page>('form')
  const [usage, setUsage] = useState<UsageCounts | null>(null)
  const [moveTo, setMoveTo] = useState<string | null>(null)
  const [nameLeft, setNameLeft] = useState(false)
  // Wraps every page, so focus can be placed after the page changes (display: contents keeps the
  // sticky SheetHeader working).
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // The body also puts the keyboard away on its "done" key.
  const attachBody = useCallback((element: HTMLDivElement | null) => {
    bodyRef.current = element
    return blurOnEnter(element)
  }, [])

  if (route.id !== undefined && original === null) {
    return (
      <>
        <SheetHeader title="Category" onCancel={onClose} cancelLabel="Close" />
        <EmptyState
          title="This category no longer exists"
          message="It was deleted. Close this and pick another category."
        />
      </>
    )
  }

  const name = fields.name.trim()
  const valid = name !== ''
  const title = name || original?.name || 'New category'
  const live = original === null ? undefined : categories.find((c) => c.id === original.id)
  const archived = (live ?? original)?.archived === true
  const targets = original === null ? [] : sortedCategories(categories).filter((c) => c.id !== original.id)

  const update = (patch: Partial<Fields>) => {
    const next = { ...fields, ...patch }
    setFields(next)
    setDirty(!sameFields(next, initial))
  }

  const showPage = (next: Page) => {
    const from = page
    flushSync(() => setPage(next))
    const body = bodyRef.current
    if (next === 'icon') showPageFrom(body, iconPageStart(body))
    else if (next === 'delete') {
      showPageFrom(body, body?.querySelector<HTMLElement>('[data-testid="move-to"] input') ?? body?.querySelector<HTMLElement>('header button'))
    } else {
      // Back on the form, at the row that left it.
      const row = from === 'delete' ? 'sheet-delete' : 'category-icon'
      returnTo(body?.querySelector<HTMLElement>(`[data-testid="${row}"] button`))
    }
  }

  const save = () => {
    if (!valid) {
      setNameLeft(true)
      return
    }
    if (original === null) actions.addCategory(stored(fields))
    else actions.updateCategory(original.id, stored(fields))
    onClose()
  }

  const seeSpending = () => {
    if (original === null) return
    const id = original.id
    onClose()
    const nav = useNav.getState()
    const top = nav.stacks[nav.tab].at(-1)
    if (top?.name !== 'category' || top.categoryId !== id) nav.push({ name: 'category', categoryId: id })
  }

  const changeArchived = async (archive: boolean) => {
    if (original === null) return
    const id = original.id
    try {
      await withUndo(archive ? `Archived ${title}` : `Restored ${title}`, () => {
        // Edits made before archiving are kept with it.
        if (valid) actions.updateCategory(id, stored(fields))
        actions.setCategoryArchived(id, archive)
      })
    } catch {
      failed(archive ? 'archive the category' : 'restore the category')
      return
    }
    onClose()
  }

  const remove = async (target: string | null) => {
    if (original === null) return
    const id = original.id
    try {
      await withUndo(`Deleted ${original.name}`, () => actions.deleteCategory(id, target))
    } catch {
      failed('delete the category')
      return
    }
    onClose()
    leaveDetailOf(id)
  }

  const startDelete = async () => {
    if (original === null) return
    const counts = categoryUsage(getData(), original.id)
    if (counts.transactions + counts.recurring + counts.quickAdds > 0) {
      setUsage(counts)
      setMoveTo(null)
      showPage('delete')
      return
    }
    const confirmed = await confirmDialog({
      title: `Delete ${original.name}?`,
      message: 'No expenses, fixed costs or quick adds use it.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (confirmed) await remove(null)
  }

  return (
    <div ref={attachBody} style={{ display: 'contents' }}>
      {page === 'icon' ? (
        <IconPage value={fields.icon} onChange={(icon) => update({ icon })} onDone={() => showPage('form')} />
      ) : page === 'delete' && original !== null && usage !== null ? (
        <DeletePage
          name={original.name}
          usage={usage}
          targets={targets}
          moveTo={moveTo}
          onMoveTo={setMoveTo}
          onCancel={() => showPage('form')}
          onDelete={() => void remove(moveTo)}
        />
      ) : (
        <>
          <SheetHeader
            title={title}
            onCancel={onClose}
            action={{ label: original === null ? 'Add' : 'Save', onClick: save, disabled: !valid, 'data-testid': 'sheet-save' }}
          />
          <Section context="sheet">
            <TextField
              variant="form"
              label="Name"
              value={fields.name}
              onChange={(text) => update({ name: text })}
              onBlur={() => setNameLeft(true)}
              maxLength={MAX_LENGTHS.category}
              placeholder="Required"
              enterKeyHint="done"
              error={nameLeft && !valid ? 'Give the category a name.' : undefined}
            />
            <ListRow
              title="Icon"
              detail={<CategoryBadge icon={fields.icon} color={fields.color} size="sm" />}
              chevron
              onClick={() => showPage('icon')}
              data-testid="category-icon"
            />
            <ColorSwatches
              label="Colour"
              showLabel
              options={COLOR_OPTIONS}
              value={fields.color}
              onChange={(color) => update({ color })}
            />
          </Section>
          <Section context="sheet" footer="Where it's offered first. You can still pick it anywhere.">
            <SelectField label="Show in" value={fields.kind} options={KIND_OPTIONS} onChange={(kind) => update({ kind })} />
          </Section>
          <Section context="sheet" footer="Optional. It counts this category's fixed costs and daily spending together.">
            <AmountField label="Monthly limit" value={fields.budget} onChange={(budget) => update({ budget })} placeholder="None" />
          </Section>
          {original !== null && (
            <>
              <Section
                context="sheet"
                footer={
                  archived
                    ? 'Restoring puts it back in the pickers.'
                    : 'Archived categories leave the pickers. Their entries stay as they are.'
                }
              >
                <ListRow title="See spending" chevron onClick={seeSpending} />
                <ListRow
                  title={archived ? 'Restore category' : 'Archive category'}
                  tinted
                  onClick={() => void changeArchived(!archived)}
                />
              </Section>
              <Section context="sheet">
                <ListRow title="Delete category" destructive onClick={() => void startDelete()} data-testid="sheet-delete" />
              </Section>
            </>
          )}
        </>
      )}
    </div>
  )
}
