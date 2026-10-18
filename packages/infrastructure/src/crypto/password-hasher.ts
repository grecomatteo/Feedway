import { hash, verify } from '@node-rs/argon2'
import type { PasswordHasher } from '@app/application'

// OWASP minimum for argon2id (spec §15.1)
// `Algorithm` is an ambient const enum, unusable with verbatimModuleSyntax: 2 is Argon2id.
const ARGON2ID = 2
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const

export function createPasswordHasher(): PasswordHasher {
  return {
    hash: (plain) => hash(plain, OPTIONS),
    async verify(hashed, plain) {
      try {
        return await verify(hashed, plain)
      } catch {
        // a malformed stored hash must deny access, not crash the request
        return false
      }
    },
  }
}
