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

  /** A new passkey for the signed-in person. */
  async function register(name: string): Promise<void> {
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
  }

  /**
   * A passkey sign-in. With a session of the same person it is a reauth: the server replaces
   * the session with a confirmed one (its cookie comes with the answer).
   */
  async function authenticate(): Promise<void> {
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
        allowCredentials: descriptors(options.allowCredentials),
      },
    })) as PublicKeyCredential | null
    if (!credential) throw new Error('passkey not used')
    const response = credential.response as AuthenticatorAssertionResponse
    await call('POST', '/api/auth/passkey/verify-authentication', {
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
    })
  }

  return { supported, register, authenticate }
}
