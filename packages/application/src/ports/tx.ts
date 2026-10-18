export interface OrganizationKeyRecord {
  version: number
  /** Data key sealed with the platform key, `v1.<platformKeyVersion>.…` */
  keyEnc: string
  retiredAt: Date | null
}

export interface OrganizationKeysRepository {
  list(organizationId: string): Promise<OrganizationKeyRecord[]>
  insert(organizationId: string, version: number, keyEnc: string): Promise<void>
  retire(organizationId: string, version: number, at: Date): Promise<void>
}

/**
 * One database transaction with its scope already set (organization, user or system).
 * Repositories are added here as the modules that own them arrive.
 */
export interface Tx {
  organizationKeys: OrganizationKeysRepository
}
