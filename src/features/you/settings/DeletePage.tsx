import type { Category } from '@/domain/types'
import { Button, CategoryBadge, Section, SheetHeader } from '@/ui'
import { ChoiceList } from './ChoiceList'
import styles from './DeletePage.module.css'
import { usageWords, type UsageCounts } from './text'

export interface DeletePageProps {
  name: string
  usage: UsageCounts
  /** The other active categories, in order. */
  targets: readonly Category[]
  moveTo: string | null
  onMoveTo(id: string): void
  /** Back to the form. */
  onCancel(): void
  onDelete(): void
}

/**
 * Deleting a category that is still used (docs/SPEC.md §3.7): the sheet's body asks where its
 * entries go, "Move 12 expenses, 1 fixed cost and 2 quick adds to…", with a radio list of the other
 * active categories and a destructive "Delete {name}" that stays disabled until one is chosen.
 */
export function DeletePage({ name, usage, targets, moveTo, onMoveTo, onCancel, onDelete }: DeletePageProps) {
  const words = usageWords(usage)
  return (
    <>
      <SheetHeader title={`Delete ${name}`} onCancel={onCancel} />
      {targets.length > 0 ? (
        <>
          <p className={styles.lead}>Move {words} to…</p>
          <Section context="sheet">
            <ChoiceList
              label="Move them to"
              options={targets.map((category) => ({
                value: category.id,
                title: category.name,
                leading: <CategoryBadge icon={category.icon} color={category.color} />,
              }))}
              value={moveTo}
              onChange={onMoveTo}
              data-testid="move-to"
            />
          </Section>
          <div className={styles.actions}>
            <Button
              variant="destructive"
              filled
              size="lg"
              block
              disabled={moveTo === null}
              onClick={onDelete}
              data-testid="sheet-delete"
            >
              Delete {name}
            </Button>
          </div>
        </>
      ) : (
        <p className={styles.lead}>
          {name} still has {words}, and there is no other category to move them to. Add a category or
          restore an archived one, then delete this one.
        </p>
      )}
    </>
  )
}
