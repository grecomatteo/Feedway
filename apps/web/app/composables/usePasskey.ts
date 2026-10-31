/// <reference lib="dom" />

/** base64url ⇄ bytes, as the WebAuthn options and answers of the server are written. */
const toBytes = (value: string): ArrayBuffer =>
  Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)).buffer
const toText = (buffer: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

interface CredentialDescriptorJson {
  id: string
  type: PublicKeyCredentialType
  transports?: AuthenticatorTransport[]
}

const descriptors = (list: CredentialDescriptorJson[] | undefined) =>
  (list ?? []).map((c) => ({ ...c, id: toBytes(c.id) }))

/**
 * The WebAuthn ceremonies with Better Auth's passkey routes, written by hand: the browser part
 * is small and needs no extra package.
 */
export function usePasskey() {
  const { call } = useApi()
  const supported = () => typeof window !== 'undefined' && 'PublicKeyCredential' in window

  /** A new passkey for the signed-in person; returns its credential id. */
  async function register(name: string): Promise<string> {
    const options = await call<
      PublicKeyCredentialCreationOptions & {
        challenge: string
        user: { id: string; name: string; displayName: string }
        excludeCredentials?: CredentialDescriptorJson[]
      }
    >('GET', '/api/auth/passkey/generate-register-options')
    const credential = (await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: toBytes(options.challenge),
        user: { ...options.user, id: toBytes(options.user.id) },
        excludeCredentials: descriptors(options.excludeCredentials),
      },
    })) as PublicKeyCredential | null
    if (!credential) throw new Error('passkey not created')
    const response = credential.response as AuthenticatorAttestationResponse
    await call('POST', '/api/auth/passkey/verify-registration', {
      name,
      response: {
        id: credential.id,
        rawId: toText(credential.rawId),
        type: credential.type,
        clientExtensionResults: credential.getClientExtensionResults(),
        response: {
          clientDataJSON: toText(response.clientDataJSON),
          attestationObject: toText(response.attestationObject),
          transports: response.getTransports(),
        },
      },
    })
    return credential.id
  }

  /** Whether the browser can offer passkeys in the email field's autofill. */
  async function autofillSupported(): Promise<boolean> {
    if (!supported()) return false
    const check = (
      PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> }
    ).isConditionalMediationAvailable
    try {
      return typeof check === 'function' ? await check.call(PublicKeyCredential) : false
    } catch {
      return false
    }
  }

  /**
   * A passkey sign-in. `reauth`: the person signed in confirms it is them; the server then
   * accepts only their own passkey and replaces the session with a confirmed one.
   * `autofill`: the passkeys appear in the email field's suggestions (conditional mediation).
   */
  async function authenticate(
    opts: { reauth?: boolean; autofill?: boolean; signal?: AbortSignal; only?: string } = {},
  ): Promise<void> {
    const options = await call<
      PublicKeyCredentialRequestOptions & {
        challenge: string
        allowCredentials?: CredentialDescriptorJson[]
      }
    >('GET', '/api/auth/passkey/generate-authenticate-options')
    const credential = (await navigator.credentials.get({
      publicKey: {
        ...options,
        challenge: toBytes(options.challenge),
        // `only`: the passkey just created, so another account's passkey on this device cannot
        // be picked by mistake
        allowCredentials: descriptors(
          opts.only === undefined
            ? options.allowCredentials
            : [{ id: opts.only, type: 'public-key' }],
        ),
      },
      ...(opts.autofill === true
        ? { mediation: 'conditional' as CredentialMediationRequirement }
        : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })) as PublicKeyCredential | null
    if (!credential) throw new Error('passkey not used')
    const response = credential.response as AuthenticatorAssertionResponse
    await call(
      'POST',
      '/api/auth/passkey/verify-authentication',
      {
        response: {
          id: credential.id,
          rawId: toText(credential.rawId),
          type: credential.type,
          clientExtensionResults: credential.getClientExtensionResults(),
          response: {
            clientDataJSON: toText(response.clientDataJSON),
            authenticatorData: toText(response.authenticatorData),
            signature: toText(response.signature),
            userHandle: response.userHandle ? toText(response.userHandle) : undefined,
          },
        },
      },
      opts.reauth === true ? { 'x-app-reauth': '1' } : {},
    )
  }

  return { supported, autofillSupported, register, authenticate }
}
