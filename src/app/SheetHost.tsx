import { useCallback, useState, type ComponentType } from 'react'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { discardTitleFor, useNav, type SheetEntry, type SheetProps, type SheetRoute } from '@/app/nav'
import { SHEETS, sheetLabel } from '@/app/registry'
import { Sheet } from '@/ui'

interface HostView {
  /** The open sheets this view was derived from. */
  sheets: SheetEntry[]
  /** Closed sheets that stay mounted until their exit animation ends (Sheet calls onExited). */
  closing: SheetEntry[]
}

/** Open order: keys are "sheet-<n>" with n counting up. */
function sequence(entry: SheetEntry): number {
  return Number.parseInt(entry.key.slice(entry.key.lastIndexOf('-') + 1), 10) || 0
}

/**
 * Renders every open sheet from the nav store inside the UI kit's Sheet, with the registry's
 * component, label, size and material (docs/SPEC.md §5.5). A closed sheet stays mounted with open={false}
 * until its exit has finished. Only the top sheet reacts to Escape, the scrim and a drag; the
 * others' requests to close are ignored. A sheet with unsaved changes (setDirty) asks "Discard this
 * expense?" or "Discard changes?" before those close it (§5.10 rule 5).
 */
export function SheetHost() {
  const sheets = useNav((s) => s.sheets)
  const dirty = useNav((s) => s.dirty)
  const [view, setView] = useState<HostView>(() => ({ sheets, closing: [] }))

  // Derived during render, so a closed sheet is never missing for a frame before its exit.
  if (view.sheets !== sheets) {
    const closed = view.sheets.filter((entry) => !sheets.includes(entry))
    setView({ sheets, closing: [...view.closing.filter((entry) => !sheets.includes(entry)), ...closed] })
  }

  const onExited = useCallback((key: string) => {
    setView((v) => {
      if (!v.closing.some((entry) => entry.key === key)) return v
      return { ...v, closing: v.closing.filter((entry) => entry.key !== key) }
    })
  }, [])

  const topKey = sheets.at(-1)?.key
  const all = [...sheets, ...view.closing].toSorted((a, b) => sequence(a) - sequence(b))
  return all.map((entry) => (
    <HostedSheet
      key={entry.key}
      entry={entry}
      open={sheets.includes(entry)}
      top={entry.key === topKey}
      dirty={dirty[entry.key] === true}
      onExited={onExited}
    />
  ))
}

interface HostedSheetProps {
  entry: SheetEntry
  open: boolean
  top: boolean
  dirty: boolean
  onExited(key: string): void
}

function ignoreClose(): void {}

function HostedSheet({ entry, open, top, dirty, onExited }: HostedSheetProps) {
  const { key, route } = entry
  const close = useCallback(() => useNav.getState().closeSheet(key), [key])
  const setDirty = useCallback((value: boolean) => useNav.getState().setSheetDirty(key, value), [key])
  const exited = useCallback(() => onExited(key), [onExited, key])
  const { size, material } = SHEETS[route.name]
  return (
    <Sheet
      open={open}
      label={sheetLabel(route)}
      size={size}
      material={material}
      dirty={dirty}
      discardTitle={discardTitleFor(route)}
      onClose={top ? close : ignoreClose}
      onExited={exited}
      data-sheet={route.name}
    >
      <ErrorBoundary level="sheet" onDismiss={close}>
        <SheetBody route={route} onClose={close} setDirty={setDirty} />
      </ErrorBoundary>
    </Sheet>
  )
}

interface SheetBodyProps {
  route: SheetRoute
  onClose(): void
  setDirty(dirty: boolean): void
}

function SheetBody({ route, onClose, setDirty }: SheetBodyProps) {
  // SHEETS maps each name to the component for that route, which TypeScript cannot correlate
  // through a union.
  const Component = SHEETS[route.name].Component as ComponentType<SheetProps<SheetRoute['name']>>
  return <Component route={route} onClose={onClose} setDirty={setDirty} />
}
