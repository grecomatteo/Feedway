import type {
  AuthMethod,
  OrganizationLimits,
  OrgActor,
  OrgRole,
  TwoFactorPolicy,
  WorkspaceRole,
} from '@app/domain'

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
  /** Last reactivation by the platform: lock links issued before it no longer work. */
  reactivatedAt: Date | null
  /**
   * "Non sono stato io": set by the lock, kept through the reactivation and cleared only when the
   * person chooses a password with the recovery link and code. While set, no ordinary reset is
   * issued or accepted (the account may be active, with no password and no second factor).
   */
  securityLockedAt: Date | null
  anonymizedAt: Date | null
  createdAt: Date
}

/** What an agency's user list shows of a member; never credentials, only whether they exist. */
export interface UserSummary {
  id: string
  email: string
  name: string
  nickname: string | null
  avatarKey: string | null
  status: 'active' | 'disabled'
  anonymizedAt: Date | null
  lastLoginAt: Date | null
  twoFactorEnabled: boolean
  passkeys: number
}

export interface UsersRepository {
  findById(id: string): Promise<UserRecord | null>
  /**
   * The given users, in no particular order. The caller passes only ids it is allowed to see
   * (the members of its agency, read under row level security).
   */
  summaries(ids: readonly string[]): Promise<UserSummary[]>
  findByEmail(email: string): Promise<UserRecord | null>
  /** Locks the row until the transaction ends. */
  findByIdForUpdate(id: string): Promise<UserRecord | null>
  /** Whether the two users share an active membership in an active agency. */
  sharesOrganization(a: string, b: string): Promise<boolean>
  setLastLoginAt(id: string, at: Date): Promise<void>
  /** false: the account was already disabled. */
  disable(id: string, at: Date): Promise<boolean>
  /**
   * Platform reactivation, system scope only: active again, `reactivatedAt` set;
   * `securityLockedAt` stays until the recovery is complete. false: the account was not
   * disabled, or is anonymized.
   */
  enable(id: string, at: Date): Promise<boolean>
  /**
   * Records a "Non sono stato io" lock; false when one is already recorded and the account has
   * not been reactivated since.
   */
  markSecurityLocked(id: string, at: Date): Promise<boolean>
  platformAdminExists(): Promise<boolean>
  /** Platform administrators who can act: active, not anonymized. System scope only. */
  listActivePlatformAdmins(): Promise<UserRecord[]>
  setPlatformAdmin(id: string): Promise<void>
  setNickname(id: string, nickname: string | null): Promise<void>
  /** The agency the panel opens next time. */
  setLastOrganization(id: string, organizationId: string): Promise<void>
  countPasskeys(id: string): Promise<number>
}

/**
 * Credentials written outside Better Auth, system scope only (except `revokePendingTokens`):
 * the platform voids a password that may be in someone else's hands and hands out a reset link
 * (Task 16).
 */
export interface CredentialsRepository {
  /** Removes the password credential; false when the account had none. Passkeys stay. */
  removePassword(userId: string): Promise<boolean>
  /**
   * The recovery link after a verified reactivation: a reset token in the format
   * `/reset-password` reads (ADR 012, V6) and, beside it, the keyed hash of the code the
   * operator dictates (`codeHash` of the new token), both valid until `expiresAt`. Not limited
   * to people of one agency: only the platform issues it. Returns the token.
   */
  issueAccountRecovery(
    userId: string,
    expiresAt: Date,
    codeHash: (token: string) => Buffer,
  ): Promise<string>
  /**
   * After a "Non sono stato io" lock: removes every passkey, the authenticator app and its
   * recovery codes, which the intruder may have added. Returns how many of each.
   */
  removeSecondFactors(userId: string): Promise<{ passkeys: number; totp: number }>
  /**
   * "Non sono stato io": deletes every pending link or challenge of the person that Better Auth
   * keeps in `verifications` (password reset, second factor waiting after the password, passkey
   * challenges). Also in the person's own scope. Returns how many were deleted.
   */
  revokePendingTokens(userId: string): Promise<number>
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
  /** Forgets every device of the person; returns how many. */
  deleteAllForUser(userId: string): Promise<number>
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
  /** Same, and locks the row until the transaction ends. */
  findByIdForUpdate(id: string): Promise<OrganizationRecord | null>
  /** System scope only (row level security). */
  create(input: { id: string; name: string; slug: string }): Promise<void>
  slugExists(slug: string): Promise<boolean>
  /** System scope only: every agency would look missing elsewhere. */
  findBySlug(slug: string): Promise<OrganizationRecord | null>
  /** System scope only. Every agency, by name. */
  listAll(): Promise<OrganizationRecord[]>
  /** System scope only (a trigger refuses it elsewhere). false: already in that status. */
  setStatus(id: string, status: OrganizationRecord['status'], at: Date): Promise<boolean>
  /** System scope only (a trigger refuses it elsewhere). Replaces the limits as a whole. */
  setLimits(id: string, limits: OrganizationLimits): Promise<void>
  /** Name and settings keys of the agency the transaction is scoped to; other keys stay. */
  update(id: string, change: { name?: string; settings?: Record<string, unknown> }): Promise<void>
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
  /** Same, and locks the row until the transaction ends: checks on it hold until the commit. */
  findForUpdate(organizationId: string, userId: string): Promise<OrgMemberRecord | null>
  /** Memberships in any agency, disabled ones and suspended agencies included. */
  organizationCount(userId: string): Promise<number>
  /** Leaves an existing membership as it is (a retried activation). */
  addIfMissing(member: { organizationId: string; userId: string; role: OrgRole }): Promise<void>
  /** Every member of the agency, disabled ones included. */
  listForOrganization(organizationId: string): Promise<OrgMemberRecord[]>
  /** Members of the agency, disabled ones included: each holds a seat. */
  count(organizationId: string): Promise<number>
  /**
   * Seat counts and new invites of one agency go one at a time until the transaction ends, so
   * two invites cannot both take the last seat.
   */
  lockSeats(organizationId: string): Promise<void>
  /** false: the membership is gone or already had this status. */
  setStatus(
    organizationId: string,
    userId: string,
    status: OrgMemberRecord['status'],
  ): Promise<boolean>
  /**
   * Changes the role only if it is still `from` and the membership is active; false otherwise
   * (a concurrent change).
   */
  setRole(organizationId: string, userId: string, from: OrgRole, to: OrgRole): Promise<boolean>
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
  /** Unused, unexpired invites of the agency: each will take a seat. */
  countOpen(organizationId: string, now: Date): Promise<number>
  /** One open invite of the agency (purpose `invite`), without locking it. */
  findOpen(organizationId: string, id: string, now: Date): Promise<InviteRecord | null>
  /** Open invites this person sent, in every agency. System scope only. */
  listOpenSentBy(userId: string, now: Date): Promise<InviteRecord[]>
  /** The agency's own open invites (purpose `invite`), oldest first. */
  listOpen(organizationId: string, now: Date): Promise<InviteRecord[]>
  /**
   * One open invite of the agency (purpose `invite`), locked until the transaction ends; null
   * otherwise. Never waits: `CONFLICT` while an activation of it holds the row.
   */
  findOpenForUpdate(organizationId: string, id: string, now: Date): Promise<InviteRecord | null>
  /** A new link for the same invite: the old token stops working. */
  replaceToken(id: string, tokenHash: Buffer, expiresAt: Date): Promise<void>
  /** Ends the link now: it stops working and frees its seat. */
  expire(id: string, at: Date): Promise<void>
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
  /**
   * Same, and locks the row until the transaction ends: changes to one workspace and to its
   * members go one at a time, so the checks on it hold until the commit.
   */
  findVisibleByIdForUpdate(actor: OrgActor, id: string): Promise<WorkspaceRecord | null>
  /**
   * One workspace of the agency, for an activation that adds its invited roles: shares the row
   * lock with the changes above, so an archiving that commits first is seen.
   */
  findForShare(organizationId: string, id: string): Promise<WorkspaceRecord | null>
  countActive(organizationId: string): Promise<number>
  /** Archived workspaces keep their slug. */
  slugExists(organizationId: string, slug: string): Promise<boolean>
  /**
   * New workspaces of one agency go one at a time until the transaction ends, so two of them
   * cannot both take the last slot or the same slug.
   */
  lockCreation(organizationId: string): Promise<void>
  create(workspace: {
    id: string
    organizationId: string
    name: string
    slug: string
  }): Promise<WorkspaceRecord>
  rename(organizationId: string, id: string, name: string): Promise<void>
  /** false: already archived. */
  archive(organizationId: string, id: string, at: Date): Promise<boolean>
}

export interface WorkspaceMembershipRecord {
  userId: string
  workspaceId: string
  workspaceName: string
  role: WorkspaceRole
}

export interface WorkspaceMembersRepository {
  /** Every workspace role in the agency, with the workspace name, for the user list. */
  listForOrganization(organizationId: string): Promise<WorkspaceMembershipRecord[]>
  /** workspaceId → role of the user in that agency, to build the `OrgActor`. */
  rolesOf(organizationId: string, userId: string): Promise<ReadonlyMap<string, WorkspaceRole>>
  /** Leaves an existing membership as it is (a retried activation). */
  addIfMissing(member: {
    organizationId: string
    workspaceId: string
    userId: string
    role: WorkspaceRole
  }): Promise<void>
  /** The members of one workspace with their role. */
  listForWorkspace(
    organizationId: string,
    workspaceId: string,
  ): Promise<{ userId: string; role: WorkspaceRole }[]>
  /** The user's role in the workspace, locking the row until the transaction ends. */
  findForUpdate(
    organizationId: string,
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceRole | null>
  /** false: the user already has a role there. */
  add(member: {
    organizationId: string
    workspaceId: string
    userId: string
    role: WorkspaceRole
  }): Promise<boolean>
  /** Changes the role only if it is still `from`; false otherwise (a concurrent change). */
  setRole(
    organizationId: string,
    workspaceId: string,
    userId: string,
    from: WorkspaceRole,
    to: WorkspaceRole,
  ): Promise<boolean>
  /** The user's roles in workspaces of the agency that are not archived, except `exceptWorkspaceId`. */
  countInActiveWorkspaces(
    organizationId: string,
    userId: string,
    exceptWorkspaceId: string,
  ): Promise<number>
  /** false: the user had no role there. */
  remove(organizationId: string, workspaceId: string, userId: string): Promise<boolean>
}

/** Platform-wide settings (`settings` table), outside any agency. */
export interface PlatformSettingsRepository {
  set(key: string, value: unknown, updatedBy: string | null): Promise<void>
}
