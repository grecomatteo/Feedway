import type { KeyTx } from './key-ring.js'

/**
 * Seals and opens the token of a connection with the agency's data key, bound to its row
 * (AAD `account_connections:<organizationId>:<connectionId>`, ADR 019): a value copied to
 * another connection or agency does not open.
 */
export interface ConnectionTokens {
  seal(
    tx: KeyTx,
    connection: { organizationId: string; id: string },
    token: string,
  ): Promise<{ tokenEnc: string; keyVersion: number }>
  open(
    tx: KeyTx,
    connection: { organizationId: string; id: string; tokenEnc: string },
  ): Promise<string>
}
