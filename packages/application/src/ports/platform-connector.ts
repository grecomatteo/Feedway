import type { AccountHealth, ConnectionKind, Platform } from '@app/domain'
import type { OrganizationIntegrationTx } from './integration-store.js'

/**
 * What a platform gives the product (ADR 019): one connector per connection kind. The app's
 * credentials arrive opaque, as the platform's module defines them; the accounts module never
 * looks inside. The answers of the platform arrive already classified: a use case never sees a
 * platform error. The unified login (plan 03 Task 7) adds `startLogin` and `completeLogin`.
 */
export interface PlatformConnector<AppCredentials = unknown> {
  /** Tries the app's credentials with the platform before they are saved. */
  verifyApp(app: AppCredentials): Promise<AppVerification>
  /** The agency's own app, from its integration; null while the agency has none. */
  loadAppCredentials(
    tx: OrganizationIntegrationTx,
    organizationId: string,
  ): Promise<AppCredentials | null>
  /** Only the kinds whose token is pasted (system user, spec §8.1 step 4). */
  connectWithToken?(app: AppCredentials, token: string): Promise<TokenCheck>
  /** The accounts the connection sees now, read live. */
  listAccounts(credentials: ConnectionCredentials<AppCredentials>): Promise<AccountListing>
  /**
   * A new token before this one expires. Left out by the kinds whose token cannot be renewed
   * (the system user's does not expire): such a connection expires with its token.
   */
  refresh?(credentials: ConnectionCredentials<AppCredentials>): Promise<TokenRefresh>
  /** Token, permissions, assignment and quota of the connection's accounts (§8.4). */
  checkHealth(
    credentials: ConnectionCredentials<AppCredentials>,
    accounts: readonly HealthTarget[],
  ): Promise<HealthCheck>
}

/** The kinds this process can reach; a kind left out has no connector here. */
export type PlatformConnectors = { readonly [K in ConnectionKind]?: PlatformConnector }

/**
 * `rejected`: the platform refuses these credentials. `unavailable`: it could not say (down,
 * slow, rate limited): nothing is known about the credentials.
 */
export type AppVerification = { ok: true } | { ok: false; reason: 'rejected' | 'unavailable' }

/** The app, and the connection's token in clear: kept in memory for one call, never logged. */
export interface ConnectionCredentials<AppCredentials = unknown> {
  app: AppCredentials
  token: string
}

/** One permission the kind needs, and whether the token has it (green or red, spec §8.1). */
export interface PermissionCheck {
  name: string
  granted: boolean
}

/**
 * A pasted token as the platform judges it. `rejected`: not valid, or not of the agency's app.
 * `app_rejected`: the agency's app itself is refused. `permissions_missing`: valid, but some
 * permission in `permissions` is red.
 */
export type TokenCheck =
  | {
      ok: true
      /** The same user on the platform is the same connection (plan 03, choice 4). */
      externalUserId: string
      /** null: the token does not expire. */
      expiresAt: Date | null
      permissions: PermissionCheck[]
    }
  | {
      ok: false
      reason: 'rejected' | 'app_rejected' | 'permissions_missing' | 'unavailable'
      permissions: PermissionCheck[]
    }

/** An account a connection sees, as the platform describes it. */
export interface PlatformAccount {
  platform: Platform
  externalId: string
  name: string
  username: string | null
  avatarUrl: string | null
  /** The key of the profile (§3); null for an account with no pair. */
  pageId: string | null
  /** null: it can be imported. `role_missing`: the connection has no role on it. */
  problem: 'role_missing' | null
}

/**
 * `rejected`: the token or the account list is refused; `unavailable`: no answer; `incomplete`:
 * the list does not end (too long, or a page that comes back), so it was not read whole.
 */
export type AccountListing =
  | { ok: true; accounts: PlatformAccount[] }
  | { ok: false; reason: 'rejected' | 'unavailable' | 'incomplete' }

/** `not_renewable`: the platform has no renewal for it; `rejected`: it refuses this token. */
export type TokenRefresh =
  | { ok: true; token: string; expiresAt: Date | null }
  | { ok: false; reason: 'not_renewable' | 'rejected' | 'unavailable' }

/** An account to check, as the platform knows it. */
export interface HealthTarget {
  platform: Platform
  externalId: string
  pageId: string | null
}

/**
 * Why an account is yellow or red. `permission_missing`: the token lacks a permission;
 * `role_missing`: no role on the page; `not_assigned`: no longer among the connection's assets;
 * `quota_exhausted`: no posts left in the platform's window.
 */
export type AccountProblem =
  'permission_missing' | 'role_missing' | 'not_assigned' | 'quota_exhausted'

export interface AccountHealthReport {
  platform: Platform
  externalId: string
  /** null: the platform could not say this time (temporary error, an unclear answer): unchanged. */
  health: AccountHealth | null
  problem: AccountProblem | null
  /** Posts used and allowed in the platform's window; null where there is none or it failed. */
  quota: { used: number; total: number } | null
}

/**
 * `ok`: the token works; `usage` is the platform's counters from the last call, opaque.
 * `expired`: the token no longer works; `revoked`: the client took the access away;
 * `app_rejected`: the agency's app is refused; `unavailable`: no answer, nothing is known.
 */
export type HealthCheck =
  | { ok: true; accounts: AccountHealthReport[]; usage: unknown }
  | { ok: false; reason: 'expired' | 'revoked' | 'app_rejected' | 'unavailable' }
