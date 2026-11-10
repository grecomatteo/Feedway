import type { AccountHealth, ConnectionKind, ConnectionStatus, Platform } from '@app/domain'

/** A row of `social_accounts`. */
export interface SocialAccountRecord {
  id: string
  organizationId: string
  platform: Platform
  externalId: string
  name: string
  username: string | null
  avatarUrl: string | null
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

export interface SocialAccountsRepository {
  /**
   * The agency's accounts by name, inactive ones included. With `workspaceIds`, only those
   * assigned to at least one of them (none for an empty list).
   */
  list(
    organizationId: string,
    filter?: { workspaceIds?: readonly string[] },
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
   * active again. The health is kept: the first check after the import sets it.
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
}

export interface WorkspaceAccountsRepository {
  /** false: already assigned. */
  assign(organizationId: string, workspaceId: string, accountId: string): Promise<boolean>
  /** false: it was not assigned. */
  unassign(organizationId: string, workspaceId: string, accountId: string): Promise<boolean>
  /** The ids of the accounts assigned to the workspace. */
  listForWorkspace(organizationId: string, workspaceId: string): Promise<string[]>
}
