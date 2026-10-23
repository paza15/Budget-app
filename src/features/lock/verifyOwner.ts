import { useNav, type SheetRoute } from '@/app/nav'
import { abortFaceId } from '@/features/lock/faceId'
import { hasPin } from '@/store/securityStore'

type VerifyRoute = Extract<SheetRoute, { name: 'verifyOwner' }>

interface Request {
  route: VerifyRoute
  settle(verified: boolean): void
}

/** Verify sheets waiting for an answer, oldest first. */
const requests: Request[] = []

/**
 * Opens the 'verifyOwner' sheet and resolves true once the PIN or Face ID is confirmed, or at once
 * when no PIN is set; false when the user cancels (docs/SPEC.md §3.8). `reason` is the sheet's
 * title: a short phrase naming the protected change, such as "Turn off the app lock". Closing the
 * sheet any other way (Cancel, the scrim, Escape, a drag, Back) counts as a cancel. Call it from a
 * tap; the sheet needs the app's tabs on screen.
 */
export function verifyOwner(reason: string): Promise<boolean> {
  if (!hasPin()) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    const route: VerifyRoute = { name: 'verifyOwner', reason }
    const key = useNav.getState().openSheet(route)
    let stopWatching: (() => void) | null = null
    const request: Request = {
      route,
      settle(verified) {
        const index = requests.indexOf(request)
        if (index === -1) return
        requests.splice(index, 1)
        stopWatching?.()
        if (!verified) abortFaceId()
        resolve(verified)
      },
    }
    requests.push(request)
    stopWatching = useNav.subscribe((state) => {
      if (!state.sheets.some((entry) => entry.key === key)) request.settle(false)
    })
  })
}

/**
 * For VerifyOwnerSheet: the owner confirmed it is them in the sheet showing `route`. Resolves that
 * sheet's verifyOwner call with true; the sheet then closes itself.
 */
export function confirmOwner(route: VerifyRoute): void {
  // nav keeps the route object it was given; the newest request is the sheet on top otherwise.
  const request = requests.find((r) => r.route === route) ?? requests.at(-1)
  request?.settle(true)
}

/** Settles every waiting call with false (tests). */
export function __resetVerifyOwnerForTests(): void {
  // settle() takes each request off the list.
  while (requests.length > 0) requests[0]?.settle(false)
}
