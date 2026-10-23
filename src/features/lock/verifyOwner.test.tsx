import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetNavForTests, useNav, type SheetRoute } from '@/app/nav'
import { createDefaultSecurity } from '@/domain/defaults'
import { makeData } from '@/domain/test-helpers/dataFixtures'
import { verifyBiometric } from '@/features/lock/biometric'
import { __resetFaceIdForTests, askFaceId } from '@/features/lock/faceId'
import { __resetVerifyOwnerForTests, confirmOwner, verifyOwner } from '@/features/lock/verifyOwner'
import { useAppStore } from '@/store/appStore'
import { __resetSecurityForTests, useSecurityStore } from '@/store/securityStore'

vi.mock('@/features/lock/biometric', () => ({
  verifyBiometric: vi.fn<(credentialId: string, signal: AbortSignal) => Promise<boolean>>(),
}))

type VerifyRoute = Extract<SheetRoute, { name: 'verifyOwner' }>

function withPin(): void {
  useSecurityStore.setState({
    config: { ...createDefaultSecurity(), pinHash: 'aGFzaA==', pinSalt: 'c2FsdA==' },
    status: 'ready',
    locked: false,
    unlockedOnce: true,
  })
}

/** The route of the open verify sheet. */
function openRoute(): VerifyRoute {
  const route = useNav.getState().sheets.at(-1)?.route
  if (route?.name !== 'verifyOwner') throw new Error('no verify sheet')
  return route
}

beforeEach(() => {
  useAppStore.setState({ data: makeData(), status: 'ready' })
  __resetNavForTests()
  __resetSecurityForTests()
})

afterEach(() => {
  __resetVerifyOwnerForTests()
  __resetNavForTests()
  __resetSecurityForTests()
  __resetFaceIdForTests()
  useAppStore.setState(useAppStore.getInitialState(), true)
})

describe('verifyOwner (docs/SPEC.md §3.8, §5.7)', () => {
  it('resolves true at once when no PIN is set, without a sheet', async () => {
    useSecurityStore.setState({ status: 'ready', locked: false, unlockedOnce: true })
    await expect(verifyOwner('Erase all data')).resolves.toBe(true)
    expect(useNav.getState().sheets).toEqual([])
  })

  it('opens the verify sheet with the reason, and resolves true once the owner is confirmed', async () => {
    withPin()
    const answer = verifyOwner('Turn off the app lock')
    expect(openRoute()).toEqual({ name: 'verifyOwner', reason: 'Turn off the app lock' })
    confirmOwner(openRoute())
    await expect(answer).resolves.toBe(true)
  })

  it('resolves false when the sheet closes any other way, ending a Face ID request', async () => {
    withPin()
    let signal: AbortSignal | undefined
    vi.mocked(verifyBiometric).mockImplementation(
      (_id, s) =>
        new Promise((resolve) => {
          signal = s
          s.addEventListener('abort', () => resolve(false))
        }),
    )
    const answer = verifyOwner('Change your PIN')
    void askFaceId('Y3JlZA')
    useNav.getState().closeSheet()
    await expect(answer).resolves.toBe(false)
    expect(signal?.aborted).toBe(true)
    // A late confirmation changes nothing.
    confirmOwner({ name: 'verifyOwner', reason: 'Change your PIN' })
  })

  it('confirms the newest request when the route is not the one it opened', async () => {
    withPin()
    const answer = verifyOwner('Turn on Face ID')
    confirmOwner({ name: 'verifyOwner', reason: 'Turn on Face ID' })
    await expect(answer).resolves.toBe(true)
  })
})
