import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import type { GridPictureScope, GridPictureTokens } from '@app/application'

const IV_BYTES = 12
const TAG_BYTES = 16
const INFO = 'feedway:grid-picture'
/** Far above a picture's address, far below what an address of the panel may hold. */
const GRID_PICTURE_TOKEN_MAX = 4096

interface Payload {
  m: string
  u: string
  e: number
}

const isPayload = (v: unknown): v is Payload =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Payload).m === 'string' &&
  typeof (v as Payload).u === 'string' &&
  Number.isSafeInteger((v as Payload).e)

// the agency and the account are not in the token: they are its associated data, so a token
// opens only on the address of the account it was given for
const aadOf = (scope: GridPictureScope) =>
  Buffer.from(`grid-picture:${scope.organizationId}:${scope.accountId}`, 'utf8')

/**
 * AES-256-GCM, with a key of its own derived from APP_ENCRYPTION_KEY with HKDF. Token:
 * `base64url(iv ‖ ciphertext ‖ tag)`, canonical only, so a token has one valid form.
 */
export function createGridPictureTokens(masterKey: Buffer): GridPictureTokens {
  const key = Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), INFO, 32))
  return {
    seal(scope, picture, expiresAt) {
      const body: Payload = { m: picture.mediaId, u: picture.pictureUrl, e: expiresAt.getTime() }
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
      cipher.setAAD(aadOf(scope))
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(body), 'utf8'),
        cipher.final(),
      ])
      return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64url')
    },
    open(scope, token, now) {
      if (token.length > GRID_PICTURE_TOKEN_MAX) return null
      const bytes = Buffer.from(token, 'base64url')
      if (bytes.toString('base64url') !== token || bytes.length <= IV_BYTES + TAG_BYTES) return null
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, IV_BYTES), {
        authTagLength: TAG_BYTES,
      })
      decipher.setAAD(aadOf(scope))
      decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES))
      let body: unknown
      try {
        const plain = Buffer.concat([
          decipher.update(bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES)),
          decipher.final(),
        ])
        body = JSON.parse(plain.toString('utf8'))
      } catch {
        return null
      }
      if (!isPayload(body) || body.e <= now.getTime()) return null
      return { mediaId: body.m, pictureUrl: body.u }
    },
  }
}
