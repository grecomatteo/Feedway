import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { SecretBox } from '@app/application'

const FORMAT = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

// Canonical base64url only: Node ignores stray characters and padding bits, which would let
// two different strings open to the same value.
function decode(text: string | undefined): Buffer {
  const bytes = Buffer.from(text ?? '', 'base64url')
  if (bytes.toString('base64url') !== text) throw new Error('malformed sealed value')
  return bytes
}

/**
 * AES-256-GCM. Sealed form: `v1.<keyVersion>.<iv>.<ciphertext>.<tag>` (base64url);
 * `open` picks the key from the version, so old values stay readable after a rotation.
 */
export function createSecretBox(
  keys: ReadonlyMap<number, Buffer>,
  activeVersion: number,
): SecretBox {
  for (const [version, key] of keys) {
    if (key.length !== KEY_BYTES) throw new Error(`key ${String(version)} must be 32 bytes`)
  }
  const active = keys.get(activeVersion)
  if (!active) throw new Error(`active key version ${String(activeVersion)} is missing`)

  return {
    seal(plaintext, aad) {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv('aes-256-gcm', active, iv)
      cipher.setAAD(Buffer.from(aad, 'utf8'))
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return [FORMAT, String(activeVersion), iv, ciphertext, tag]
        .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
        .join('.')
    },
    open(sealed, aad) {
      const parts = sealed.split('.')
      const [format, versionText, ivText, ciphertextText, tagText] = parts
      if (
        parts.length !== 5 ||
        format !== FORMAT ||
        !versionText ||
        !/^[1-9]\d*$/.test(versionText)
      ) {
        throw new Error('malformed sealed value')
      }
      const key = keys.get(Number(versionText))
      if (!key) throw new Error(`unknown key version ${versionText}`)
      const iv = decode(ivText)
      const tag = decode(tagText)
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
        throw new Error('malformed sealed value')
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
      decipher.setAAD(Buffer.from(aad, 'utf8'))
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(decode(ciphertextText)), decipher.final()]).toString(
        'utf8',
      )
    },
  }
}
