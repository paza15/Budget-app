import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetBiometric,
  platformAuthenticatorAvailable,
  registerBiometric,
  verifyBiometric,
} from '@/features/lock/biometric'
import { useUiStore } from '@/store/uiStore'

/** A stand-in for the platform's PublicKeyCredential: rawId, type and response. */
class FakeCredential {
  readonly type = 'public-key'
  readonly rawId: ArrayBuffer
  readonly response: { authenticatorData?: ArrayBuffer }
  constructor(rawId: ArrayBuffer, response: { authenticatorData?: ArrayBuffer } = {}) {
    this.rawId = rawId
    this.response = response
  }
  static isUserVerifyingPlatformAuthenticatorAvailable = vi.fn<() => Promise<boolean>>(async () => true)
  static signalUnknownCredential = vi.fn<(options: { rpId: string; credentialId: string }) => Promise<void>>(
    async () => {},
  )
}

const CRED = new TextEncoder().encode('cred')
const CRED_ID = 'Y3JlZA'

function authenticatorData(flags: number): ArrayBuffer {
  const data = new Uint8Array(37)
  data[32] = flags
  return data.buffer
}

const create = vi.fn<(options: CredentialCreationOptions) => Promise<unknown>>()
const get = vi.fn<(options: CredentialRequestOptions) => Promise<unknown>>()

beforeEach(() => {
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('location', { hostname: 'owner.github.io' })
  vi.stubGlobal('PublicKeyCredential', FakeCredential)
  vi.stubGlobal('navigator', { credentials: { create, get } })
  create.mockReset()
  get.mockReset()
  FakeCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockClear()
  FakeCredential.signalUnknownCredential.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  useUiStore.setState(useUiStore.getInitialState(), true)
})

describe('registerBiometric (docs/SPEC.md §8)', () => {
  it('creates a platform passkey that requires user verification, with the constant user', async () => {
    create.mockResolvedValue(new FakeCredential(CRED.buffer))
    await expect(registerBiometric()).resolves.toBe(CRED_ID)
    const publicKey = create.mock.calls[0]?.[0].publicKey
    expect(publicKey).toMatchObject({
      rp: { id: 'owner.github.io', name: 'On a Budget' },
      user: { name: 'On a Budget app lock', displayName: 'On a Budget app lock' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
      attestation: 'none',
      timeout: 60_000,
    })
    expect(new TextDecoder().decode(publicKey?.user.id as Uint8Array)).toBe('on-a-budget-app-lock')
    expect(publicKey?.challenge).toHaveProperty('byteLength', 32)
  })

  it('uses a new random challenge each time', async () => {
    create.mockResolvedValue(new FakeCredential(CRED.buffer))
    await registerBiometric()
    await registerBiometric()
    const [first, second] = create.mock.calls.map((call) => Array.from(call[0].publicKey?.challenge as Uint8Array))
    expect(first).not.toEqual(second)
  })

  it('counts as a system sheet while it is open', async () => {
    let during: boolean | undefined
    create.mockImplementation(async () => {
      during = useUiStore.getState().systemSheetOpen
      return new FakeCredential(CRED.buffer)
    })
    await registerBiometric()
    expect(during).toBe(true)
    expect(useUiStore.getState().systemSheetOpen).toBe(false)
  })

  it('resolves null when the user cancels or it fails', async () => {
    create.mockRejectedValue(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'))
    await expect(registerBiometric()).resolves.toBeNull()
    expect(useUiStore.getState().systemSheetOpen).toBe(false)
    create.mockResolvedValue(null)
    await expect(registerBiometric()).resolves.toBeNull()
  })

  it('resolves null without asking where WebAuthn is missing or the context is not secure', async () => {
    vi.stubGlobal('isSecureContext', false)
    await expect(registerBiometric()).resolves.toBeNull()
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('PublicKeyCredential', undefined)
    await expect(registerBiometric()).resolves.toBeNull()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('verifyBiometric (docs/SPEC.md §8)', () => {
  it('asks for the stored passkey with user verification, and accepts only that passkey', async () => {
    get.mockResolvedValue(new FakeCredential(CRED.buffer, { authenticatorData: authenticatorData(0x05) }))
    const signal = new AbortController().signal
    await expect(verifyBiometric(CRED_ID, signal)).resolves.toBe(true)
    const options = get.mock.calls[0]?.[0]
    expect(options?.signal).toBe(signal)
    expect(options?.publicKey).toMatchObject({
      rpId: 'owner.github.io',
      userVerification: 'required',
      timeout: 60_000,
      allowCredentials: [{ type: 'public-key', transports: ['internal'] }],
    })
    expect(options?.publicKey?.allowCredentials?.[0]?.id).toEqual(CRED)
    expect(options?.publicKey?.challenge).toHaveProperty('byteLength', 32)
  })

  it('refuses another passkey, or one that did not verify the user', async () => {
    const signal = new AbortController().signal
    get.mockResolvedValue(new FakeCredential(new TextEncoder().encode('other').buffer, { authenticatorData: authenticatorData(0x05) }))
    await expect(verifyBiometric(CRED_ID, signal)).resolves.toBe(false)
    get.mockResolvedValue(new FakeCredential(CRED.buffer, { authenticatorData: authenticatorData(0x01) }))
    await expect(verifyBiometric(CRED_ID, signal)).resolves.toBe(false)
    get.mockResolvedValue(new FakeCredential(CRED.buffer))
    await expect(verifyBiometric(CRED_ID, signal)).resolves.toBe(false)
  })

  it('answers false on a cancel, a failure or a deleted passkey (all NotAllowedError)', async () => {
    get.mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'))
    await expect(verifyBiometric(CRED_ID, new AbortController().signal)).resolves.toBe(false)
    expect(useUiStore.getState().systemSheetOpen).toBe(false)
  })

  it('answers false when aborted, before or during the request', async () => {
    const before = new AbortController()
    before.abort()
    await expect(verifyBiometric(CRED_ID, before.signal)).resolves.toBe(false)
    expect(get).not.toHaveBeenCalled()

    const during = new AbortController()
    get.mockImplementation(
      ({ signal }: CredentialRequestOptions) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    const answer = verifyBiometric(CRED_ID, during.signal)
    expect(useUiStore.getState().systemSheetOpen).toBe(true)
    during.abort()
    await expect(answer).resolves.toBe(false)
    expect(useUiStore.getState().systemSheetOpen).toBe(false)
  })

  it('answers false for a stored id that is not base64url', async () => {
    await expect(verifyBiometric('not+base64url', new AbortController().signal)).resolves.toBe(false)
    expect(get).not.toHaveBeenCalled()
  })
})

describe('forgetBiometric', () => {
  it('signals the unknown passkey to the platform for this site', () => {
    forgetBiometric(CRED_ID)
    expect(FakeCredential.signalUnknownCredential).toHaveBeenCalledWith({ rpId: 'owner.github.io', credentialId: CRED_ID })
  })

  it('never throws: missing API, a rejection or a synchronous error', async () => {
    FakeCredential.signalUnknownCredential.mockRejectedValueOnce(new Error('No'))
    expect(() => forgetBiometric(CRED_ID)).not.toThrow()
    FakeCredential.signalUnknownCredential.mockImplementationOnce(() => {
      throw new TypeError('Old engine')
    })
    expect(() => forgetBiometric(CRED_ID)).not.toThrow()
    // An engine without the signal API.
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {})
    expect(() => forgetBiometric(CRED_ID)).not.toThrow()
    await Promise.resolve()
  })
})

describe('platformAuthenticatorAvailable', () => {
  it('asks the platform, and says false where it cannot', async () => {
    await expect(platformAuthenticatorAvailable()).resolves.toBe(true)
    FakeCredential.isUserVerifyingPlatformAuthenticatorAvailable.mockRejectedValueOnce(new Error('No'))
    await expect(platformAuthenticatorAvailable()).resolves.toBe(false)
    vi.stubGlobal('navigator', {})
    await expect(platformAuthenticatorAvailable()).resolves.toBe(false)
  })
})
