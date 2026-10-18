import { createHash, randomBytes } from 'node:crypto'
import type { TokenService } from '@app/application'

export function createTokenService(): TokenService {
  const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest()
  return {
    generate() {
      const token = randomBytes(32).toString('base64url')
      return { token, hash: hash(token) }
    },
    hash,
  }
}
