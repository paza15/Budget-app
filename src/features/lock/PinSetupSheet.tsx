import type { SheetProps } from '@/app/nav'
import { PinSetupFlow } from '@/features/lock/PinSetupFlow'
import { SheetHeader, toast } from '@/ui'

/**
 * PinSetupFlow in a sheet (docs/SPEC.md §3.8): 'enable' from the App lock switch, 'change' from
 * Change PIN once the current PIN or Face ID was verified. It closes itself once the PIN is saved.
 */
export function PinSetupSheet({ route, onClose }: SheetProps<'pinSetup'>) {
  const changing = route.mode === 'change'
  const done = (): void => {
    // Turning the lock on shows in its switch; a changed PIN shows nowhere else.
    if (changing) toast({ message: 'PIN changed' })
    onClose()
  }
  return (
    <>
      <SheetHeader title={changing ? 'Change PIN' : 'App lock'} onCancel={onClose} />
      <PinSetupFlow mode={route.mode} onDone={done} onCancel={onClose} />
    </>
  )
}
