import { useState, type MouseEvent } from 'react'
import { useNav } from '@/app/nav'
import type { Category } from '@/domain/types'
import { AddRow } from '@/features/you/settings/AddRow'
import { OrderButtons } from '@/features/you/settings/OrderButtons'
import { kindLabel } from '@/features/you/settings/text'
import { useReorder } from '@/features/you/settings/useReorder'
import { actions } from '@/store/actions'
import { useCategories } from '@/store/hooks'
import { Button, CategoryBadge, ListRow, Money, Screen, Section } from '@/ui'

function back(): void {
  useNav.getState().pop()
}

function edit(id?: string): void {
  useNav.getState().openSheet(id === undefined ? { name: 'categoryEdit' } : { name: 'categoryEdit', id })
}

/** "Daily spending", "Daily spending, limit 40,00 €". */
function CategorySubtitle({ category }: { category: Category }) {
  if (category.budget === null) return kindLabel(category.kind)
  return (
    <>
      {kindLabel(category.kind)}, limit <Money cents={category.budget} />
    </>
  )
}

/**
 * You › Categories (docs/SPEC.md §3.7): the active categories in their order, each a button that
 * opens the category sheet (its name starts with the category's name), then "Add category"; the
 * archived ones in their own group. "Reorder" in the header shows "Move {name} up" / "Move {name}
 * down" on each active row, the iOS edit-mode idiom, so the list stays calm for the common task of
 * editing a category.
 */
export function CategoriesScreen() {
  const all = useCategories({ includeArchived: true })
  const active = all.filter((category) => !category.archived)
  const archived = all.filter((category) => category.archived)
  const [reordering, setReordering] = useState(false)
  const { listRef, status, move: moveRow } = useReorder()
  const canReorder = active.length > 1
  const showOrder = reordering && canReorder

  const move = (event: MouseEvent<HTMLButtonElement>, category: Category, delta: -1 | 1) => {
    const ids = active.map(({ id }) => id)
    moveRow(event, ids, category.id, delta, category.name, (next) => actions.reorderCategories(next))
  }

  return (
    <Screen
      title="Categories"
      largeTitle
      onBack={back}
      backLabel="You"
      headerRight={
        canReorder ? (
          <Button variant="glass" tinted={showOrder} onClick={() => setReordering(!showOrder)}>
            {showOrder ? 'Done' : 'Reorder'}
          </Button>
        ) : undefined
      }
    >
      <Section
        footer={
          showOrder
            ? 'Categories show in this order in pickers, lists and charts.'
            : 'Tap a category to change its name, icon, colour or monthly limit.'
        }
      >
        {/* Rows are siblings, so the group's hairlines run between them (data-row). */}
        <div ref={listRef}>
          {active.map((category, index) => (
            <ListRow
              key={category.id}
              leading={<CategoryBadge icon={category.icon} color={category.color} />}
              title={category.name}
              subtitle={<CategorySubtitle category={category} />}
              chevron={!showOrder}
              onClick={() => edit(category.id)}
              trailing={
                showOrder ? (
                  <OrderButtons
                    layout="row"
                    name={category.name}
                    first={index === 0}
                    last={index === active.length - 1}
                    onMove={(event, delta) => move(event, category, delta)}
                  />
                ) : undefined
              }
              data-id={category.id}
            />
          ))}
          {!showOrder && <AddRow label="Add category" onClick={() => edit()} />}
        </div>
      </Section>

      {archived.length > 0 && (
        <Section
          variant="form"
          title="Archived"
          footer="Archived categories leave the pickers. Their entries stay as they are."
        >
          {archived.map((category) => (
            <ListRow
              key={category.id}
              leading={<CategoryBadge icon={category.icon} color={category.color} />}
              title={category.name}
              subtitle={<CategorySubtitle category={category} />}
              chevron
              onClick={() => edit(category.id)}
              data-id={category.id}
            />
          ))}
        </Section>
      )}
      <output className="visually-hidden">{status}</output>
    </Screen>
  )
}
