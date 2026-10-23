import { useMemo, useState, type MouseEvent } from 'react'
import { useNav } from '@/app/nav'
import { MAX_QUICK_ADDS } from '@/domain/constants'
import { categoryDisplay } from '@/domain/queries'
import type { QuickAdd } from '@/domain/types'
import { AddRow } from '@/features/you/settings/AddRow'
import { OrderButtons } from '@/features/you/settings/OrderButtons'
import { useReorder } from '@/features/you/settings/useReorder'
import { actions } from '@/store/actions'
import { useCategoryMap, useData } from '@/store/hooks'
import { Button, CategoryBadge, EmptyState, ListRow, Money, Screen, Section } from '@/ui'

function back(): void {
  useNav.getState().pop()
}

function edit(id?: string): void {
  useNav.getState().openSheet(id === undefined ? { name: 'quickAdd' } : { name: 'quickAdd', id })
}

/**
 * You › Quick add buttons (docs/SPEC.md §3.3, §3.7): the buttons of Daily's quick add strip in
 * their order (at most 8), each opening its sheet; "Add a button" at the end. "Reorder" in the
 * header shows the up and down buttons, as on Categories.
 */
export function QuickAddsScreen() {
  const quickAdds = useData((d) => d.quickAdds)
  const categoryMap = useCategoryMap()
  const ordered = useMemo(() => quickAdds.toSorted((a, b) => a.order - b.order), [quickAdds])
  const [reordering, setReordering] = useState(false)
  const { listRef, status, move: moveRow } = useReorder()
  const canReorder = ordered.length > 1
  const showOrder = reordering && canReorder
  const full = ordered.length >= MAX_QUICK_ADDS

  const move = (event: MouseEvent<HTMLButtonElement>, quickAdd: QuickAdd, delta: -1 | 1) => {
    const ids = ordered.map(({ id }) => id)
    moveRow(event, ids, quickAdd.id, delta, quickAdd.label, (next) => actions.reorderQuickAdds(next))
  }

  const footer = showOrder
    ? 'Daily shows them in this order.'
    : full
      ? `You have ${MAX_QUICK_ADDS}, the most there can be. Delete one to add another.`
      : 'On Daily, one tap adds the expense, dated today.'

  return (
    <Screen
      title="Quick add buttons"
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
      {ordered.length === 0 ? (
        <EmptyState
          icon="tap"
          title="No quick add buttons"
          message="Add what you buy often, like a coffee, and log it on Daily with one tap."
          action={
            <Button variant="secondary" onClick={() => edit()}>
              Add a button
            </Button>
          }
        />
      ) : (
        <Section footer={footer}>
          <div ref={listRef}>
            {ordered.map((quickAdd, index) => {
              const category = categoryDisplay(quickAdd.categoryId, categoryMap)
              return (
                <ListRow
                  key={quickAdd.id}
                  leading={<CategoryBadge icon={quickAdd.icon} color={category.color} />}
                  title={quickAdd.label}
                  subtitle={category.name}
                  value={showOrder ? undefined : <Money cents={quickAdd.amount} />}
                  chevron={!showOrder}
                  onClick={() => edit(quickAdd.id)}
                  trailing={
                    showOrder ? (
                      <OrderButtons
                        layout="row"
                        name={quickAdd.label}
                        first={index === 0}
                        last={index === ordered.length - 1}
                        onMove={(event, delta) => move(event, quickAdd, delta)}
                      />
                    ) : undefined
                  }
                  data-id={quickAdd.id}
                />
              )
            })}
            {!showOrder && !full && <AddRow label="Add a button" onClick={() => edit()} />}
          </div>
        </Section>
      )}
      <output className="visually-hidden">{status}</output>
    </Screen>
  )
}
