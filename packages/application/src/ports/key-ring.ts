import type { Tx } from './tx.js'

/** Authenticated encryption; `aad` binds a sealed value to where it is stored. */
export interface SecretBox {
  seal(plaintext: string, aad: string): string
  open(sealed: string, aad: string): string
}

export interface KeyRing {
  /** Sealed with APP_ENCRYPTION_KEY: platform secrets only. */
  platform(): SecretBox
  /** The organization's data key; opens secrets sealed with any of its versions. */
  forOrganization(tx: Tx, organizationId: string): Promise<SecretBox>
  createOrganizationKey(tx: Tx, organizationId: string): Promise<void>
  rotateOrganizationKey(tx: Tx, organizationId: string): Promise<void>
}
