import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyBiometric } from '@/features/lock/biometric'
import { __resetFaceIdForTests, abortFaceId, askFaceId, claimAutomaticFaceId } from '@/features/lock/faceId'

vi.mock('@/features/lock/biometric', () => ({
  verifyBiometric: vi.fn<(credentialId: string, signal: AbortSignal) => Promise<boolean>>(),
}))

/** verifyBiometric calls waiting for an answer, with the signal each got. */
function pendingRequests(): { signal: AbortSignal; answer(ok: boolean): void }[] {
  const requests: { signal: AbortSignal; answer(ok: boolean): void }[] = []
  vi.mocked(verifyBiometric).mockImplementation(
    (_id, signal) =>
      new Promise((resolve) => {
        requests.push({ signal, answer: resolve })
        signal.addEventListener('abort', () => resolve(false))
      }),
  )
  return requests
}

afterEach(() => {
  __resetFaceIdForTests()
  vi.mocked(verifyBiometric).mockReset()
})

describe('askFaceId (docs/SPEC.md §3.8)', () => {
  it('answers what Face ID says', async () => {
    vi.mocked(verifyBiometric).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(askFaceId('Y3JlZA')).resolves.toBe(true)
    await expect(askFaceId('Y3JlZA')).resolves.toBe(false)
    expect(verifyBiometric).toHaveBeenCalledWith('Y3JlZA', expect.any(AbortSignal))
  })

  it('aborts the previous request before a new one', async () => {
    const requests = pendingRequests()
    const first = askFaceId('Y3JlZA')
    const second = askFaceId('Y3JlZA')
    expect(requests[0]?.signal.aborted).toBe(true)
    expect(requests[1]?.signal.aborted).toBe(false)
    requests[1]?.answer(true)
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(true)
  })

  it('ends the request in flight on abortFaceId, even if Face ID then says yes', async () => {
    const requests = pendingRequests()
    vi.mocked(verifyBiometric).mockImplementationOnce(
      (_id, signal) =>
        new Promise((resolve) => {
          requests.push({ signal, answer: resolve })
        }),
    )
    const answer = askFaceId('Y3JlZA')
    abortFaceId()
    expect(requests[0]?.signal.aborted).toBe(true)
    requests[0]?.answer(true)
    await expect(answer).resolves.toBe(false)
  })
})

describe('claimAutomaticFaceId (docs/SPEC.md §5.10 rule 3)', () => {
  it('lets the automatic prompt start once per lock episode', () => {
    expect(claimAutomaticFaceId(3)).toBe(true)
    expect(claimAutomaticFaceId(3)).toBe(false)
    expect(claimAutomaticFaceId(4)).toBe(true)
  })

  it('and once per opened verify sheet', () => {
    const route = { name: 'verifyOwner', reason: 'Turn off the app lock' }
    expect(claimAutomaticFaceId(route)).toBe(true)
    expect(claimAutomaticFaceId(route)).toBe(false)
    expect(claimAutomaticFaceId({ ...route })).toBe(true)
  })
})
