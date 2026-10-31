import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto'

// A passkey kept by a test: an ES256 key whose COSE public key is what the library stores. It
// builds the WebAuthn answers a browser would send, so the real endpoints and our hooks run
// without a browser. The browser itself is covered by the E2E tests.

export interface SoftPasskey {
  userId: string
  credentialId: Buffer
  privateKey: KeyObject
  /** CBOR map {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y} */
  cosePublicKey: Buffer
  counter: number
}

type Handler = (request: Request) => Promise<Response>

export function newSoftPasskey(userId: string): SoftPasskey {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const x = Buffer.from(jwk.x ?? '', 'base64url')
  const y = Buffer.from(jwk.y ?? '', 'base64url')
  const cosePublicKey = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    Buffer.from([0x22, 0x58, 0x20]),
    y,
  ])
  return { userId, credentialId: randomBytes(16), privateKey, cosePublicKey, counter: 0 }
}

/** The `passkeys` columns as the library writes them on registration. */
export function storedColumns(key: SoftPasskey) {
  return {
    publicKey: key.cosePublicKey.toString('base64'),
    credentialId: key.credentialId.toString('base64url'),
  }
}

const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')

const joinCookies = (...cookies: (string | undefined)[]) =>
  cookies.filter((c) => c !== undefined && c !== '').join('; ')

interface Ceremony {
  handler: Handler
  panel: string
  ip: string
  cookie?: string
  /** Extra request headers, as the panel sends them (`x-app-reauth` for a confirmation). */
  headers?: Record<string, string>
}

async function challengeFrom(
  ceremony: Ceremony,
  path: string,
): Promise<{ challenge: string; cookie: string; status: number }> {
  const res = await ceremony.handler(
    new Request(`${ceremony.panel}/api/auth${path}`, {
      headers: {
        origin: ceremony.panel,
        'x-app-client-ip': ceremony.ip,
        cookie: joinCookies(ceremony.cookie),
      },
    }),
  )
  if (res.status !== 200) return { challenge: '', cookie: '', status: res.status }
  const { challenge } = (await res.json()) as { challenge: string }
  return { challenge, cookie: cookiesOf(res), status: res.status }
}

function clientData(type: 'webauthn.get' | 'webauthn.create', challenge: string, panel: string) {
  return Buffer.from(JSON.stringify({ type, challenge, origin: panel, crossOrigin: false }))
}

function postJson(ceremony: Ceremony, path: string, cookie: string, body: unknown) {
  return ceremony.handler(
    new Request(`${ceremony.panel}/api/auth${path}`, {
      method: 'POST',
      headers: {
        origin: ceremony.panel,
        'x-app-client-ip': ceremony.ip,
        'content-type': 'application/json',
        cookie: joinCookies(ceremony.cookie, cookie),
        ...ceremony.headers,
      },
      body: JSON.stringify(body),
    }),
  )
}

const rpIdHash = (panel: string) => createHash('sha256').update(new URL(panel).hostname).digest()

/** A passkey sign-in: challenge, then the signed assertion. */
export async function passkeySignIn(
  key: SoftPasskey,
  ceremony: Ceremony & { userVerified: boolean },
): Promise<Response> {
  const { challenge, cookie, status } = await challengeFrom(
    ceremony,
    '/passkey/generate-authenticate-options',
  )
  if (status !== 200) throw new Error(`authentication options answered ${String(status)}`)
  key.counter += 1
  const clientDataJSON = clientData('webauthn.get', challenge, ceremony.panel)
  const counter = Buffer.alloc(4)
  counter.writeUInt32BE(key.counter)
  const authenticatorData = Buffer.concat([
    rpIdHash(ceremony.panel),
    Buffer.from([ceremony.userVerified ? 0x05 : 0x01]), // user present, and verified
    counter,
  ])
  const signature = sign(
    'sha256',
    Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]),
    key.privateKey,
  )
  const id = key.credentialId.toString('base64url')
  return postJson(ceremony, '/passkey/verify-authentication', cookie, {
    response: {
      id,
      rawId: id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString('base64url'),
        authenticatorData: authenticatorData.toString('base64url'),
        signature: signature.toString('base64url'),
        userHandle: Buffer.from(key.userId).toString('base64url'),
      },
    },
  })
}

/** CBOR byte string header for a length below 65536. */
function cborBytes(bytes: Buffer): Buffer {
  const head =
    bytes.length < 24
      ? Buffer.from([0x40 + bytes.length])
      : bytes.length < 256
        ? Buffer.from([0x58, bytes.length])
        : Buffer.from([0x59, bytes.length >> 8, bytes.length & 0xff])
  return Buffer.concat([head, bytes])
}

/**
 * A passkey registration with a "none" attestation, as a platform authenticator sends it.
 * Returns the answer of the registration options when that step is refused.
 */
export async function passkeyRegister(
  key: SoftPasskey,
  ceremony: Ceremony & { name?: string },
): Promise<Response> {
  const optionsRes = await ceremony.handler(
    new Request(`${ceremony.panel}/api/auth/passkey/generate-register-options`, {
      headers: {
        origin: ceremony.panel,
        'x-app-client-ip': ceremony.ip,
        cookie: joinCookies(ceremony.cookie),
      },
    }),
  )
  if (optionsRes.status !== 200) return optionsRes
  const { challenge } = (await optionsRes.json()) as { challenge: string }
  const credentialIdLength = Buffer.alloc(2)
  credentialIdLength.writeUInt16BE(key.credentialId.length)
  const authData = Buffer.concat([
    rpIdHash(ceremony.panel),
    Buffer.from([0x45]), // user present, user verified, attested credential data
    Buffer.alloc(4), // counter
    Buffer.alloc(16), // aaguid
    credentialIdLength,
    key.credentialId,
    key.cosePublicKey,
  ])
  // CBOR map {"fmt": "none", "attStmt": {}, "authData": <bytes>}
  const attestationObject = Buffer.concat([
    Buffer.from([0xa3, 0x63]),
    Buffer.from('fmt'),
    Buffer.from([0x64]),
    Buffer.from('none'),
    Buffer.from([0x67]),
    Buffer.from('attStmt'),
    Buffer.from([0xa0, 0x68]),
    Buffer.from('authData'),
    cborBytes(authData),
  ])
  const id = key.credentialId.toString('base64url')
  return postJson(ceremony, '/passkey/verify-registration', cookiesOf(optionsRes), {
    ...(ceremony.name === undefined ? {} : { name: ceremony.name }),
    response: {
      id,
      rawId: id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientData('webauthn.create', challenge, ceremony.panel).toString(
          'base64url',
        ),
        attestationObject: attestationObject.toString('base64url'),
        transports: ['internal'],
      },
    },
  })
}
