import type { AuditLog } from './audit-log.js'
import type {
  CredentialsRepository,
  InvitesRepository,
  KnownDevicesRepository,
  OrganizationsRepository,
  OrgMembersRepository,
  PlatformSettingsRepository,
  SessionsRepository,
  UsersRepository,
  WorkspaceMembersRepository,
  WorkspacesRepository,
} from './repositories.js'

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
 * Repositories that read agency data take the `OrgActor` and filter in SQL too: row level
 * security is the second barrier, not the only one. Repositories are added here as the
 * modules that own them arrive.
 */
export interface Tx {
  users: UsersRepository
  sessions: SessionsRepository
  credentials: CredentialsRepository
  knownDevices: KnownDevicesRepository
  organizations: OrganizationsRepository
  orgMembers: OrgMembersRepository
  organizationKeys: OrganizationKeysRepository
  invites: InvitesRepository
  workspaces: WorkspacesRepository
  workspaceMembers: WorkspaceMembersRepository
  platformSettings: PlatformSettingsRepository
  audit: AuditLog
}
