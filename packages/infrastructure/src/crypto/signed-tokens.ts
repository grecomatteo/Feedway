import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import type { SignedTokenPurpose, SignedTokens } from '@app/application'

const derive = (masterKey: Buffer, info: string) =>
  Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), `feedway:${info}`, 32))

interface Payload {
  u: string
  e: number
}

const isPayload = (v: unknown): v is Payload =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Payload).u === 'string' &&
  typeof (v as Payload).e === 'number'

/**
 * HMAC-SHA-256 tokens: `<payload>.<mac>` in base64url. Each purpose and the device hash use
 * their own key derived from APP_ENCRYPTION_KEY with HKDF, so no key is reused.
 */
export function createSignedTokens(masterKey: Buffer): SignedTokens {
  const keys: Record<SignedTokenPurpose, Buffer> = {
    security_lock: derive(masterKey, 'signed:security_lock'),
  }
  const deviceKey = derive(masterKey, 'device-hash')
  const mac = (purpose: SignedTokenPurpose, payload: string) =>
    createHmac('sha256', keys[purpose]).update(payload).digest()

  return {
    sign(purpose, { userId, expiresAt }) {
      const payload = Buffer.from(JSON.stringify({ u: userId, e: expiresAt.getTime() })).toString(
        'base64url',
      )
      return `${payload}.${mac(purpose, payload).toString('base64url')}`
    },
    verify(purpose, token, now) {
      const [payload, signature, ...rest] = token.split('.')
      if (!payload || !signature || rest.length > 0) return null
      const expected = mac(purpose, payload)
      const given = Buffer.from(signature, 'base64url')
      // canonical encoding only, so a token has exactly one valid form
      if (given.toString('base64url') !== signature) return null
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
      let body: unknown
      try {
        body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      } catch {
        return null
      }
      if (!isPayload(body) || body.e <= now.getTime()) return null
      return { userId: body.u }
    },
    deviceHash(userId, deviceId) {
      // length prefix: different (userId, deviceId) pairs can never produce the same input
      return createHmac('sha256', deviceKey)
        .update(`${String(userId.length)}:${userId}${deviceId}`)
        .digest()
    },
  }
}
