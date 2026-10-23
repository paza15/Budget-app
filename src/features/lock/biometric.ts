import { base64UrlToBytes, bytesToBase64Url, equalBytes } from '@/features/lock/encoding'
import { useUiStore } from '@/store/uiStore'

/**
 * Face ID unlock through a WebAuthn platform passkey (docs/SPEC.md §1, §3.8, §8). There is no
 * server: the passkey is a local gate that only proves Face ID (or the iPhone passcode) was
 * passed. The credential id is stored as base64url in the security config.
 */

const RP_NAME = 'On a Budget'
/** Constant, so turning Face ID on again replaces the earlier passkey instead of adding one (§8). */
const USER_HANDLE = 'on-a-budget-app-lock'
const USER_NAME = 'On a Budget app lock'
const TIMEOUT_MS = 60_000
const CHALLENGE_BYTES = 32
/** COSE algorithms: ES256 and RS256. */
const ES256 = -7
const RS256 = -257
/** Authenticator data: 32 bytes of RP id hash, then the flags byte, whose bit 2 is "user verified". */
const FLAGS_OFFSET = 32
const USER_VERIFIED = 0x04

/** WebAuthn here: a secure context with credentials.create and get, else null. */
function credentialsContainer(): CredentialsContainer | null {
  if (globalThis.isSecureContext !== true || typeof globalThis.PublicKeyCredential !== 'function') return null
  const credentials = globalThis.navigator?.credentials
  if (typeof credentials?.create !== 'function' || typeof credentials.get !== 'function') return null
  return credentials
}

/** Resolves true when a user-verifying platform authenticator (Face ID, Touch ID) is available. */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (credentialsContainer() === null) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

function challenge(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(CHALLENGE_BYTES))
}

/** Face ID calls in flight; uiStore.systemSheetOpen stays on until the last one ends. */
let prompts = 0

/**
 * Runs a WebAuthn call with uiStore.systemSheetOpen on: the Face ID sheet is a system sheet the app
 * started, so the auto-lock does not treat it as leaving the app (§3.8).
 */
async function asSystemSheet<T>(run: () => Promise<T>): Promise<T> {
  prompts += 1
  useUiStore.getState().setSystemSheetOpen(true)
  try {
    return await run()
  } finally {
    prompts -= 1
    if (prompts === 0) useUiStore.getState().setSystemSheetOpen(false)
  }
}

/**
 * Creates the Face ID passkey (docs/SPEC.md §8). Resolves its credential id (base64url), or null
 * when WebAuthn is missing, the user cancels or it fails. Call it straight from a tap: Safari
 * asks for Face ID only while the tap still counts as the user's.
 */
export async function registerBiometric(): Promise<string | null> {
  const credentials = credentialsContainer()
  if (credentials === null) return null
  const name = USER_NAME
  try {
    const credential = await asSystemSheet(() =>
      credentials.create({
        publicKey: {
          rp: { id: location.hostname, name: RP_NAME },
          user: { id: new TextEncoder().encode(USER_HANDLE), name, displayName: name },
          challenge: challenge(),
          pubKeyCredParams: [
            { type: 'public-key', alg: ES256 },
            { type: 'public-key', alg: RS256 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            residentKey: 'preferred',
            userVerification: 'required',
          },
          attestation: 'none',
          timeout: TIMEOUT_MS,
        },
      }),
    )
    if (!(credential instanceof PublicKeyCredential) || credential.type !== 'public-key') return null
    const id = new Uint8Array(credential.rawId)
    return id.length > 0 ? bytesToBase64Url(id) : null
  } catch {
    // NotAllowedError (cancelled, failed, timed out), InvalidStateError, SecurityError: no passkey.
    return null
  }
}

/** Whether the assertion's authenticator data says the user was verified (Face ID or passcode). */
function userVerified(response: AuthenticatorResponse): boolean {
  const data = (response as Partial<AuthenticatorAssertionResponse>).authenticatorData
  if (data === undefined) return false
  const flags = new Uint8Array(data)[FLAGS_OFFSET]
  return flags !== undefined && (flags & USER_VERIFIED) !== 0
}

/**
 * Asks for Face ID with the stored passkey (docs/SPEC.md §8). True only when the returned
 * credential is the stored one and the user was verified; false on cancel, failure, a passkey
 * deleted in Passwords (which fails like a cancel) or `signal` aborting, which also ends the
 * system prompt.
 */
export async function verifyBiometric(credentialId: string, signal: AbortSignal): Promise<boolean> {
  const credentials = credentialsContainer()
  const id = base64UrlToBytes(credentialId)
  if (credentials === null || id === null || id.length === 0 || signal.aborted) return false
  try {
    const credential = await asSystemSheet(() =>
      credentials.get({
        publicKey: {
          rpId: location.hostname,
          challenge: challenge(),
          allowCredentials: [{ type: 'public-key', id, transports: ['internal'] }],
          userVerification: 'required',
          timeout: TIMEOUT_MS,
        },
        signal,
      }),
    )
    if (signal.aborted || !(credential instanceof PublicKeyCredential)) return false
    return equalBytes(new Uint8Array(credential.rawId), id) && userVerified(credential.response)
  } catch {
    // NotAllowedError (cancel, failure, unknown passkey) and AbortError alike.
    return false
  }
}

/**
 * Tells the platform the passkey is no longer used, so Passwords can drop it
 * (PublicKeyCredential.signalUnknownCredential where available). Fire and forget: never throws.
 */
export function forgetBiometric(credentialId: string): void {
  try {
    if (globalThis.isSecureContext !== true) return
    const signalUnknown = globalThis.PublicKeyCredential?.signalUnknownCredential
    if (typeof signalUnknown !== 'function') return
    signalUnknown.call(PublicKeyCredential, { rpId: location.hostname, credentialId }).catch(() => {})
  } catch {
    // Older engines may throw synchronously; forgetting is best effort.
  }
}
