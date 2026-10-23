import { useCallback, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SheetProps } from '@/app/nav'
import { withUndo } from '@/app/undo'
import { MAX_LENGTHS, MAX_QUICK_ADDS } from '@/domain/constants'
import { categoryDisplay, sortedCategories } from '@/domain/queries'
import { UNCATEGORIZED_ID } from '@/domain/summary'
import type { Category, Cents, IconRef, QuickAdd } from '@/domain/types'
import { IconPage, iconPageStart } from '@/features/you/settings/IconPage'
import { blurOnEnter } from '@/features/you/settings/keyboard'
import { returnTo, showPageFrom } from '@/features/you/settings/sheetPages'
import { actions } from '@/store/actions'
import { useCategoryMap, useData } from '@/store/hooks'
import {
  AmountField,
  CategoryBadge,
  EmptyState,
  ListRow,
  Money,
  Section,
  SelectField,
  SheetHeader,
  TextField,
  toast,
  type SelectOption,
} from '@/ui'

interface Fields {
  label: string
  amount: Cents | null
  categoryId: string
  /** null: the button shows its category's icon until one is picked (new buttons only). */
  icon: IconRef | null
}

/** Categories offered for a quick add: daily and both first, then fixed-only ones, all active. */
function categoryOrder(categories: readonly Category[]): Category[] {
  const daily = sortedCategories(categories, { kind: 'daily' })
  return [...daily, ...sortedCategories(categories).filter((category) => !daily.includes(category))]
}

function fieldsOf(quickAdd: QuickAdd | null, categories: readonly Category[]): Fields {
  if (quickAdd !== null) {
    return { label: quickAdd.label, amount: quickAdd.amount, categoryId: quickAdd.categoryId, icon: quickAdd.icon }
  }
  return { label: '', amount: null, categoryId: categoryOrder(categories)[0]?.id ?? UNCATEGORIZED_ID, icon: null }
}

function sameFields(a: Fields, b: Fields): boolean {
  return a.label === b.label && a.amount === b.amount && a.categoryId === b.categoryId && a.icon === b.icon
}

/**
 * Adds or edits a quick add button (docs/SPEC.md §3.7): Name (max 16), Amount, Category and Icon
 * (the IconPicker page; a new button takes its category's icon until one is picked), and Delete,
 * which runs through withUndo.
 */
export function QuickAddSheet({ route, onClose, setDirty }: SheetProps<'quickAdd'>) {
  const quickAdds = useData((d) => d.quickAdds)
  const categories = useData((d) => d.categories)
  const categoryMap = useCategoryMap()
  const [original] = useState<QuickAdd | null>(() => quickAdds.find((q) => q.id === route.id) ?? null)
  const [initial] = useState<Fields>(() => fieldsOf(original, categories))
  const [fields, setFields] = useState<Fields>(initial)
  const [iconPage, setIconPage] = useState(false)
  const [nameLeft, setNameLeft] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  // The body also puts the keyboard away on its "done" key.
  const attachBody = useCallback((element: HTMLDivElement | null) => {
    bodyRef.current = element
    return blurOnEnter(element)
  }, [])

  if (route.id !== undefined && original === null) {
    return (
      <>
        <SheetHeader title="Quick add" onCancel={onClose} cancelLabel="Close" />
        <EmptyState title="This button no longer exists" message="It was deleted. Close this and pick another one." />
      </>
    )
  }
  if (original === null && quickAdds.length >= MAX_QUICK_ADDS) {
    return (
      <>
        <SheetHeader title="New quick add" onCancel={onClose} cancelLabel="Close" />
        <EmptyState
          icon="tap"
          title={`You have ${MAX_QUICK_ADDS} quick add buttons`}
          message="That is the most there can be. Delete one in You › Quick add buttons to add another."
        />
      </>
    )
  }

  const label = fields.label.trim()
  const category = categoryDisplay(fields.categoryId, categoryMap)
  const icon = fields.icon ?? category.icon
  const amountValid = fields.amount !== null && fields.amount > 0
  const valid = label !== '' && amountValid
  const title = label || original?.label || 'New quick add'

  const options: SelectOption<string>[] = categoryOrder(categories).map((c) => ({ value: c.id, label: c.name, icon: c.icon }))
  if (!options.some((option) => option.value === fields.categoryId)) {
    // An archived or deleted category stays selectable while the button still uses it.
    options.unshift({ value: fields.categoryId, label: category.name, icon: category.icon })
  }

  const update = (patch: Partial<Fields>) => {
    const next = { ...fields, ...patch }
    setFields(next)
    setDirty(!sameFields(next, initial))
  }

  const showIconPage = (open: boolean) => {
    flushSync(() => setIconPage(open))
    const body = bodyRef.current
    if (open) showPageFrom(body, iconPageStart(body))
    else returnTo(body?.querySelector<HTMLElement>('[data-testid="quick-add-icon"] button'))
  }

  const save = () => {
    if (!valid || fields.amount === null) {
      setNameLeft(true)
      return
    }
    const input = { label, amount: fields.amount, categoryId: fields.categoryId, icon }
    if (original === null) actions.addQuickAdd(input)
    else actions.updateQuickAdd(original.id, input)
    onClose()
  }

  const remove = async () => {
    if (original === null) return
    const id = original.id
    try {
      await withUndo(`Deleted ${original.label}`, () => actions.deleteQuickAdd(id))
    } catch {
      toast({ message: "Couldn't delete the button. Close the sheet and try again.", tone: 'critical' })
      return
    }
    onClose()
  }

  return (
    <div ref={attachBody} style={{ display: 'contents' }}>
      {iconPage ? (
        <IconPage value={icon} onChange={(next) => update({ icon: next })} onDone={() => showIconPage(false)} />
      ) : (
        <>
          <SheetHeader
            title={title}
            onCancel={onClose}
            action={{ label: original === null ? 'Add' : 'Save', onClick: save, disabled: !valid, 'data-testid': 'sheet-save' }}
          />
          <Section
            context="sheet"
            footer={
              valid && fields.amount !== null ? (
                <>
                  On Daily, one tap adds <Money cents={fields.amount} /> to {category.name}, dated today.
                </>
              ) : (
                'On Daily, one tap adds the expense, dated today.'
              )
            }
          >
            <TextField
              variant="form"
              label="Name"
              value={fields.label}
              onChange={(text) => update({ label: text })}
              onBlur={() => setNameLeft(true)}
              maxLength={MAX_LENGTHS.quickAdd}
              placeholder="Required"
              enterKeyHint="done"
              error={nameLeft && label === '' ? 'Give the button a name, like Coffee.' : undefined}
            />
            <AmountField
              label="Amount"
              value={fields.amount}
              onChange={(amount) => update({ amount })}
              error={fields.amount === 0 ? 'Enter an amount above 0.' : undefined}
            />
            <SelectField
              label="Category"
              value={fields.categoryId}
              options={options}
              onChange={(categoryId) => update({ categoryId })}
            />
            <ListRow
              title="Icon"
              detail={<CategoryBadge icon={icon} color={category.color} size="sm" />}
              chevron
              onClick={() => showIconPage(true)}
              data-testid="quick-add-icon"
            />
          </Section>
          {original !== null && (
            <Section context="sheet">
              <ListRow title="Delete quick add" destructive onClick={() => void remove()} data-testid="sheet-delete" />
            </Section>
          )}
        </>
      )}
    </div>
  )
}
