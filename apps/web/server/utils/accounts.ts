import type {
  AccountListItem,
  ConnectionsDeps,
  ConnectionView,
  ImportableAccount,
  MetaRemindersDeps,
  SocialAccountRecord,
  SyncRequestDeps,
  WorkspaceAccount,
} from '@app/application'
import { accountAvatarUrl, type MetaReminder } from '@app/domain'
import type { Deps } from './deps'

/** Connections and imports: the platform connectors and the sealed tokens of the process. */
export function connectionsDeps(deps: Deps): ConnectionsDeps {
  return {
    uow: deps.uow,
    clock: deps.clock,
    ids: deps.ids,
    tokens: deps.connectionTokens,
    connectors: deps.connectors,
    queue: deps.queue,
    logger: deps.logger,
  }
}

/** What leaves for the panel: dates as ISO strings, never the token. */
export const connectionDto = (c: ConnectionView) => ({
  id: c.id,
  kind: c.kind,
  status: c.status,
  expiresAt: c.expiresAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
})

/**
 * The pictures leave as Feedway's own copy, in the panel: Meta's addresses expire and the CSP
 * allows none of them (plan 04 Task 4). An account not imported yet has none: the initials.
 */
export const importableDto = (slug: string) => (a: ImportableAccount) => ({
  platform: a.platform,
  externalId: a.externalId,
  name: a.name,
  username: a.username,
  avatarUrl: a.accountId === null ? null : accountAvatarUrl(slug, a.accountId, a.avatarKey),
  pageId: a.pageId,
  state: a.state,
  problem: a.problem,
  accountId: a.accountId,
  inClient: a.inClient,
})

export const socialAccountDto = (slug: string) => (a: SocialAccountRecord) => ({
  id: a.id,
  platform: a.platform,
  externalId: a.externalId,
  name: a.name,
  username: a.username,
  avatarUrl: accountAvatarUrl(slug, a.id, a.avatarKey),
  pageId: a.pageId,
  active: a.active,
  health: a.health,
})

/** An account of a workspace: never anything of its connection. */
export const workspaceAccountDto = (slug: string) => (a: WorkspaceAccount) => ({
  id: a.id,
  platform: a.platform,
  externalId: a.externalId,
  name: a.name,
  username: a.username,
  avatarUrl: accountAvatarUrl(slug, a.id, a.avatarKey),
  pageId: a.pageId,
  active: a.active,
  health: a.health,
  healthMessage: a.healthMessage,
  selectable: a.selectable,
  quota:
    a.quotaUsed === null || a.quotaTotal === null || a.quotaCheckedAt === null
      ? null
      : { used: a.quotaUsed, total: a.quotaTotal, checkedAt: a.quotaCheckedAt.toISOString() },
  lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null,
})

export const accountListItemDto = (slug: string) => (a: AccountListItem) => ({
  ...workspaceAccountDto(slug)(a),
  workspaceIds: a.workspaceIds,
  connection: a.connection,
  createdAt: a.createdAt.toISOString(),
})

/** «Aggiorna»: the connection's sync, queued for the worker. */
export function syncRequestDeps(deps: Deps): SyncRequestDeps {
  return { uow: deps.uow, queue: deps.queue, rateLimiter: deps.rateLimiter }
}

/** Each of these calls Meta under the agency's app: a few a minute are plenty. */
export const CONNECTIONS_RATE_LIMIT = { name: 'connections', limit: 20, windowMs: 60_000 }

/** The Meta reminders: the Graph API version of the config, counted on the panel's calendar. */
export function metaRemindersDeps(deps: Deps): MetaRemindersDeps {
  return {
    uow: deps.uow,
    clock: deps.clock,
    integrations: deps.integrations,
    graph: { version: deps.config.metaGraphVersion, sunset: deps.config.metaGraphVersionSunset },
    timeZone: deps.config.defaultTimezone,
  }
}

export const metaReminderDto = (r: MetaReminder) =>
  r.kind === 'token_expiring' ? { ...r, expiresAt: r.expiresAt.toISOString() } : r
