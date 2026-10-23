import { useData } from '@/store/hooks'
import { useUiStore } from '@/store/uiStore'
import { IconButton } from '@/ui'

function toggleAmounts(): void {
  const ui = useUiStore.getState()
  ui.setAmountsRevealed(!ui.amountsRevealed)
}

/**
 * The nav row's eye button while "Hide amounts" is on (docs/SPEC.md §3.1, DESIGN.md §9.2): "Show
 * amounts" reveals them until the app is hidden or locked, "Hide amounts" masks them again.
 */
export function AmountsButton() {
  const hideAmounts = useData((d) => d.settings.hideAmounts)
  const revealed = useUiStore((s) => s.amountsRevealed)
  if (!hideAmounts) return null
  return (
    <IconButton
      variant="glass"
      icon={revealed ? 'eye-off' : 'eye'}
      label={revealed ? 'Hide amounts' : 'Show amounts'}
      onClick={toggleAmounts}
    />
  )
}
