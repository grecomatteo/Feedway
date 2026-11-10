import type { ConnectionTokens, KeyRing } from '@app/application'
import { sealedKeyVersion } from '../../crypto/secret-box.js'

/** Binds a sealed token to its connection (ADR 019). */
const aadFor = (organizationId: string, connectionId: string) =>
  `account_connections:${organizationId}:${connectionId}`

export function createConnectionTokens({ keyRing }: { keyRing: KeyRing }): ConnectionTokens {
  return {
    async seal(tx, connection, token) {
      if (token.length === 0) throw new Error('empty connection token')
      const box = await keyRing.forOrganization(tx, connection.organizationId)
      const tokenEnc = box.seal(token, aadFor(connection.organizationId, connection.id))
      return { tokenEnc, keyVersion: sealedKeyVersion(tokenEnc) }
    },
    async open(tx, connection) {
      const box = await keyRing.forOrganization(tx, connection.organizationId)
      return box.open(connection.tokenEnc, aadFor(connection.organizationId, connection.id))
    },
  }
}
