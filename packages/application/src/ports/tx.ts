import type {
  ConnectionAttemptsRepository,
  ConnectionsRepository,
  SocialAccountsRepository,
  WorkspaceAccountsRepository,
} from './accounts.js'
import type { AuditLog } from './audit-log.js'
import type { IntegrationsRepository } from './integration-store.js'
import type {
  BrandingRepository,
  CredentialsRepository,
  DataExportsRepository,
  EmailChangesRepository,
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

import type { OrganizationKeysRepository } from './organization-keys.js'

export type { OrganizationKeyRecord, OrganizationKeysRepository } from './organization-keys.js'

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
  emailChanges: EmailChangesRepository
  knownDevices: KnownDevicesRepository
  dataExports: DataExportsRepository
  organizations: OrganizationsRepository
  orgMembers: OrgMembersRepository
  organizationKeys: OrganizationKeysRepository
  branding: BrandingRepository
  invites: InvitesRepository
  workspaces: WorkspacesRepository
  workspaceMembers: WorkspaceMembersRepository
  platformSettings: PlatformSettingsRepository
  integrations: IntegrationsRepository
  accounts: SocialAccountsRepository
  connections: ConnectionsRepository
  connectionAttempts: ConnectionAttemptsRepository
  workspaceAccounts: WorkspaceAccountsRepository
  audit: AuditLog
}
