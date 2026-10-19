import type { AuthMethod, OrgActor, OrgRole, TwoFactorPolicy, WorkspaceRole } from '@app/domain'

// Records carry only what the use cases read. Secrets (password hashes, session tokens,
// 2FA secrets) never leave the auth adapter.

export interface UserRecord {
  id: string
  email: string
  name: string
  nickname: string | null
  image: string | null
  avatarKey: string | null
  platformRole: 'admin' | null
  status: 'active' | 'disabled'
  twoFactorEnabled: boolean
  theme: 'light' | 'dark' | 'system'
  locale: string
  timezone: string | null
  lastOrganizationId: string | null
  lastLoginAt: Date | null
  disabledAt: Date | null
  anonymizedAt: Date | null
  createdAt: Date
}

export interface UsersRepository {
  findById(id: string): Promise<UserRecord | null>
  findByEmail(email: string): Promise<UserRecord | null>
  /** Locks the row until the transaction ends. */
  findByIdForUpdate(id: string): Promise<UserRecord | null>
  /** Whether the two users share an active membership in an active agency. */
  sharesOrganization(a: string, b: string): Promise<boolean>
  setLastLoginAt(id: string, at: Date): Promise<void>
  /** false: the account was already disabled. */
  disable(id: string, at: Date): Promise<boolean>
  platformAdminExists(): Promise<boolean>
  setPlatformAdmin(id: string): Promise<void>
  setNickname(id: string, nickname: string | null): Promise<void>
  /** The agency the panel opens next time. */
  setLastOrganization(id: string, organizationId: string): Promise<void>
  countPasskeys(id: string): Promise<number>
}

export interface SessionRecord {
  id: string
  userId: string
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
  ipAddress: string | null
  userAgent: string | null
  authMethod: AuthMethod
  reauthenticatedAt: Date | null
}

/** Only the columns we own; Better Auth creates and deletes sessions. */
export interface SessionsRepository {
  findForUser(userId: string): Promise<SessionRecord[]>
  /** False when the session is gone. */
  setReauthenticated(userId: string, sessionId: string, at: Date): Promise<boolean>
  setAuthMethod(userId: string, sessionId: string, method: AuthMethod): Promise<void>
  /** False when the session is gone or belongs to someone else. */
  delete(userId: string, sessionId: string): Promise<boolean>
  /** Signs the person out everywhere; returns how many sessions were closed. */
  deleteAllForUser(userId: string): Promise<number>
}

/** Devices a person signed in from, by keyed hash of the `__Host-device` cookie id. */
export interface KnownDevicesRepository {
  count(userId: string): Promise<number>
  /** Records the device or refreshes `last_seen_at`; true when it was not known. */
  touch(userId: string, deviceHash: Buffer, at: Date): Promise<boolean>
}

export interface OrganizationRecord {
  id: string
  name: string
  slug: string
  status: 'active' | 'suspended'
  limits: Record<string, unknown>
  settings: Record<string, unknown>
  suspendedAt: Date | null
  createdAt: Date
}

export interface OrganizationsRepository {
  findById(id: string): Promise<OrganizationRecord | null>
  /** System scope only (row level security). */
  create(input: { id: string; name: string; slug: string }): Promise<void>
  slugExists(slug: string): Promise<boolean>
}

export interface OrgMemberRecord {
  organizationId: string
  userId: string
  role: OrgRole
  status: 'active' | 'disabled'
}

export interface UserOrganizationRecord extends OrgMemberRecord {
  name: string
  slug: string
  organizationStatus: 'active' | 'suspended'
  /** `settings.require2fa` of the agency; null when it keeps the platform rule. */
  require2fa: TwoFactorPolicy | null
}

export interface OrgMembersRepository {
  /** Every membership of the user, disabled ones included: the caller filters. */
  listForUser(userId: string): Promise<UserOrganizationRecord[]>
  find(organizationId: string, userId: string): Promise<OrgMemberRecord | null>
  /** Memberships in any agency, disabled ones and suspended agencies included. */
  organizationCount(userId: string): Promise<number>
  /** Leaves an existing membership as it is (a retried activation). */
  addIfMissing(member: { organizationId: string; userId: string; role: OrgRole }): Promise<void>
}

export type InvitePurpose = 'bootstrap' | 'invite' | 'organization_owner'

export interface InviteRecord {
  id: string
  organizationId: string | null
  purpose: InvitePurpose
  email: string
  existingUserId: string | null
  reservedUserId: string | null
  invitedBy: string | null
  orgRole: OrgRole | null
  memberships: { workspaceId: string; role: WorkspaceRole }[]
  expiresAt: Date
  usedAt: Date | null
  createdAt: Date
}

export interface NewInvite {
  id: string
  organizationId: string | null
  purpose: InvitePurpose
  email: string
  existingUserId: string | null
  tokenHash: Buffer
  invitedBy: string | null
  orgRole: OrgRole | null
  memberships: { workspaceId: string; role: WorkspaceRole }[]
  expiresAt: Date
}

export interface InvitesRepository {
  create(invite: NewInvite): Promise<void>
  /** An unused, unexpired invite, without locking it (to describe the link). */
  findValid(tokenHash: Buffer, now: Date): Promise<InviteRecord | null>
  /**
   * Locks an unused, unexpired invite until the transaction ends; null otherwise. Never waits:
   * `CONFLICT` while another activation of the same link holds it.
   */
  lockForActivation(tokenHash: Buffer, now: Date): Promise<InviteRecord | null>
  /** false: someone else used it first. */
  markUsed(id: string, at: Date): Promise<boolean>
  /**
   * The id the activated account will get, so a retried activation reuses it. Sets it only once:
   * read `reservedUserId` from `lockForActivation` before reserving.
   */
  reserveUserId(id: string, userId: string): Promise<void>
  /** The agency a bootstrap activation created, so a retry finds it again. */
  setOrganization(id: string, organizationId: string): Promise<void>
  /** Ends every open link of this purpose (a new bootstrap link replaces the old ones). */
  expireOpen(purpose: InvitePurpose, at: Date): Promise<void>
}

export interface WorkspaceRecord {
  id: string
  organizationId: string
  name: string
  slug: string
  logoKey: string | null
  /** Local time `HH:MM:SS`; null means no default. */
  defaultPostTime: string | null
  archivedAt: Date | null
  createdAt: Date
}

export interface WorkspacesRepository {
  /** Archived ones included (they stay readable); a Member sees only their own. */
  listVisible(actor: OrgActor): Promise<WorkspaceRecord[]>
  findVisibleById(actor: OrgActor, id: string): Promise<WorkspaceRecord | null>
  countActive(organizationId: string): Promise<number>
}

export interface WorkspaceMembersRepository {
  /** workspaceId → role of the user in that agency, to build the `OrgActor`. */
  rolesOf(organizationId: string, userId: string): Promise<ReadonlyMap<string, WorkspaceRole>>
  /** Leaves an existing membership as it is (a retried activation). */
  addIfMissing(member: {
    organizationId: string
    workspaceId: string
    userId: string
    role: WorkspaceRole
  }): Promise<void>
}

/** Platform-wide settings (`settings` table), outside any agency. */
export interface PlatformSettingsRepository {
  set(key: string, value: unknown, updatedBy: string | null): Promise<void>
}
