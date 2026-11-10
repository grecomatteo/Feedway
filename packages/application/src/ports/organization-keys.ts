// The agencies' data keys (ADR 007); apart from tx.ts so the stores that seal with them can
// name the repository without a cycle.

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
