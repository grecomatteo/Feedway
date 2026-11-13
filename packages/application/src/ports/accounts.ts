import type { AccountHealth, ConnectionKind, ConnectionStatus, Platform } from '@app/domain'

/** A row of `social_accounts`. */
export interface SocialAccountRecord {
  id: string
  organizationId: string
  platform: Platform
  externalId: string
  name: string
  username: string | null
  /** As the platform gave it at the last sync: Meta's address expires after some days. */
  avatarUrl: string | null
  /**
   * The picture copied into Feedway's storage (`accounts.avatar`, plan 04 Task 4), without the
   * extension: `<key>.webp` (256 px) and `<key>-64.webp`. null: none yet, the panel shows the
   * initials.
   */
  avatarKey: string | null
  /** The key of the profile (§3); null for an account with no pair. */
  pageId: string | null
  /** The owning connection (plan 03, choice 2). */
  connectionId: string
  active: boolean
  /** null: never checked yet. */
  health: AccountHealth | null
  healthMessage: string | null
  lastSyncedAt: Date | null
  quotaUsed: number | null
  quotaTotal: number | null
  quotaCheckedAt: Date | null
  createdAt: Date
}

/** What the platform says about an account, when it is imported or imported again. */
export interface ImportedAccountInput {
  organizationId: string
  platform: Platform
  externalId: string
  name: string
  username: string | null
  avatarUrl: string | null
  pageId: string | null
  /** The connection that becomes the owner: the caller has applied `canTakeOver`. */
  connectionId: string
  at: Date
}

/** Names, picture and pair as the platform gives them now (daily sync, §8.4). */
export interface PlatformAccountUpdate {
  name: string
  username: string | null
  avatarUrl: string | null
  pageId: string | null
  at: Date
}

/** The outcome of a health check of one account (§8.4). */
export interface AccountHealthUpdate {
  health: AccountHealth
  /** Why it is yellow or red, for the panel; null when it is green. */
  message: string | null
  /** null: the quota was not read this time and stays as it was. */
  quota: { used: number; total: number } | null
  at: Date
}

export interface SocialAccountsRepository {
  /**
   * The agency's accounts by name, inactive ones included. With `workspaceIds`, only those
   * assigned to at least one of them (none for an empty list).
   */
  list(
    organizationId: string,
    filter?: { workspaceIds?: readonly string[] },
  ): Promise<SocialAccountRecord[]>
  /**
   * One page of the agency's accounts by id, inactive ones included: those after `afterId`, at
   * most `limit`. `workspaceIds` as in `list`.
   */
  listPage(
    organizationId: string,
    page: { workspaceIds?: readonly string[]; afterId?: string; limit: number },
  ): Promise<SocialAccountRecord[]>
  findById(organizationId: string, id: string): Promise<SocialAccountRecord | null>
  /** The ones by platform and external id, for an import; the missing ones are left out. */
  findByExternalIds(
    organizationId: string,
    platform: Platform,
    externalIds: readonly string[],
  ): Promise<SocialAccountRecord[]>
  /** What counts towards the `social_accounts` limit. */
  countActive(organizationId: string): Promise<number>
  /**
   * Imports of one agency go one at a time until the transaction ends, so two of them cannot
   * both take the last slot of the limit.
   */
  lockImport(organizationId: string): Promise<void>
  /**
   * Inserts the account, or updates names, pair and owner of the one already there and makes it
   * active again. The health is kept for the same owner; an account that moves to another
   * connection is "never checked" again, until the check queued after the import.
   */
  upsertImported(input: ImportedAccountInput): Promise<SocialAccountRecord>
  /**
   * Accounts gone from the platform: inactive, never deleted (§8.4). Only those `connectionId`
   * still owns (plan 03, choice 2). Returns how many changed.
   */
  markInactive(
    organizationId: string,
    connectionId: string,
    ids: readonly string[],
  ): Promise<number>
  /** The accounts `connectionId` owns, inactive ones included. */
  listOwnedBy(organizationId: string, connectionId: string): Promise<SocialAccountRecord[]>
  /** Only an active account `connectionId` still owns; false otherwise. */
  updateFromPlatform(
    organizationId: string,
    connectionId: string,
    id: string,
    update: PlatformAccountUpdate,
  ): Promise<boolean>
  /**
   * The stored picture of the account (null: none), whoever owns it; the row stays locked until
   * the transaction ends. Returns the key it replaces, or null when there is no such account.
   */
  setAvatarKey(
    organizationId: string,
    id: string,
    avatarKey: string | null,
  ): Promise<{ previous: string | null } | null>
  /** Only an account `connectionId` still owns; false otherwise. */
  setHealth(
    organizationId: string,
    connectionId: string,
    id: string,
    update: AccountHealthUpdate,
  ): Promise<boolean>
}

/** A row of `account_connections` without its token. */
export interface ConnectionRecord {
  id: string
  organizationId: string
  kind: ConnectionKind
  externalUserId: string
  connectedBy: string
  expiresAt: Date | null
  status: ConnectionStatus
  lastRefreshedAt: Date | null
  lastUsage: unknown
  createdAt: Date
  updatedAt: Date
}

/** The token still sealed (ADR 019); only the calls that use it read it. */
export interface ConnectionWithToken extends ConnectionRecord {
  tokenEnc: string
  keyVersion: number
}

export interface NewConnection {
  id: string
  organizationId: string
  kind: ConnectionKind
  externalUserId: string
  connectedBy: string
  tokenEnc: string
  keyVersion: number
  expiresAt: Date | null
}

export interface ConnectionsRepository {
  list(organizationId: string): Promise<ConnectionRecord[]>
  findById(organizationId: string, id: string): Promise<ConnectionRecord | null>
  /** The same user on the platform (plan 03, choice 4). */
  findByExternalUser(
    organizationId: string,
    kind: ConnectionKind,
    externalUserId: string,
  ): Promise<ConnectionRecord | null>
  /** With `forUpdate`, the row stays locked until the transaction ends (token renewal). */
  findWithToken(
    organizationId: string,
    id: string,
    opts?: { forUpdate?: boolean },
  ): Promise<ConnectionWithToken | null>
  /** A new connection is `pending` until an account is imported (plan 03, choice 6). */
  create(connection: NewConnection): Promise<ConnectionRecord>
  /** A verified new token; `at` is the renewal time. false: no such connection. */
  replaceToken(
    organizationId: string,
    id: string,
    token: {
      tokenEnc: string
      keyVersion: number
      expiresAt: Date | null
      status: ConnectionStatus
      at: Date
    },
  ): Promise<boolean>
  setStatus(organizationId: string, id: string, status: ConnectionStatus): Promise<boolean>
  /** The platform's usage counters from the last call. */
  recordUsage(organizationId: string, id: string, usage: unknown): Promise<void>
  /**
   * The daily clean-up (plan 03 Task 11): new connections still `pending`, created before
   * `createdBefore` and with no account, are deleted. Returns how many.
   */
  deleteStalePending(organizationId: string, createdBefore: Date): Promise<number>
}

export interface ConnectionAttemptRecord {
  id: string
  organizationId: string
  userId: string
  kind: ConnectionKind
  expiresAt: Date
  usedAt: Date | null
}

export interface ConnectionAttemptsRepository {
  create(attempt: {
    id: string
    organizationId: string
    userId: string
    kind: ConnectionKind
    stateHash: Buffer
    expiresAt: Date
  }): Promise<void>
  /**
   * Marks the attempt used and returns it, only if it is of this kind and this user's, not
   * expired and not used
   * yet (plan 03, choice 5); null otherwise, with nothing changed. One use, even when two
   * returns race.
   */
  consume(
    organizationId: string,
    kind: ConnectionKind,
    stateHash: Buffer,
    userId: string,
    now: Date,
  ): Promise<ConnectionAttemptRecord | null>
  /** The daily clean-up: attempts expired at `now`, used or not, are deleted. Returns how many. */
  deleteExpired(organizationId: string, now: Date): Promise<number>
}

export interface WorkspaceAccountsRepository {
  /** false: already assigned. */
  assign(organizationId: string, workspaceId: string, accountId: string): Promise<boolean>
  /** false: it was not assigned. */
  unassign(organizationId: string, workspaceId: string, accountId: string): Promise<boolean>
  /** The ids of the accounts assigned to the workspace. */
  listForWorkspace(organizationId: string, workspaceId: string): Promise<string[]>
  /** Where each of these accounts is assigned. */
  listForAccounts(
    organizationId: string,
    accountIds: readonly string[],
  ): Promise<{ accountId: string; workspaceId: string }[]>
}
