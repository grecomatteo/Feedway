import type { Tx } from './tx.js'

/** Authenticated encryption; `aad` binds a sealed value to where it is stored. */
export interface SecretBox {
  seal(plaintext: string, aad: string): string
  open(sealed: string, aad: string): string
}

/** The key ring only needs the keys table of the current transaction. */
export type KeyTx = Pick<Tx, 'organizationKeys'>

export interface KeyRing {
  /** Sealed with APP_ENCRYPTION_KEY: platform secrets only. */
  platform(): SecretBox
  /** The organization's data key; opens secrets sealed with any of its versions. */
  forOrganization(tx: KeyTx, organizationId: string): Promise<SecretBox>
  createOrganizationKey(tx: KeyTx, organizationId: string): Promise<void>
  rotateOrganizationKey(tx: KeyTx, organizationId: string): Promise<void>
}
