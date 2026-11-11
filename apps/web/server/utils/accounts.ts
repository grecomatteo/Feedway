import type {
  AccountListItem,
  ConnectionsDeps,
  ConnectionView,
  ImportableAccount,
  SocialAccountRecord,
  SyncRequestDeps,
  WorkspaceAccount,
} from '@app/application'
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

export const importableDto = (a: ImportableAccount) => ({
  platform: a.platform,
  externalId: a.externalId,
  name: a.name,
  username: a.username,
  avatarUrl: a.avatarUrl,
  pageId: a.pageId,
  state: a.state,
  problem: a.problem,
  accountId: a.accountId,
})

export const socialAccountDto = (a: SocialAccountRecord) => ({
  id: a.id,
  platform: a.platform,
  externalId: a.externalId,
  name: a.name,
  username: a.username,
  avatarUrl: a.avatarUrl,
  pageId: a.pageId,
  active: a.active,
  health: a.health,
})

/** An account of a workspace: never anything of its connection. */
export const workspaceAccountDto = (a: WorkspaceAccount) => ({
  id: a.id,
  platform: a.platform,
  externalId: a.externalId,
  name: a.name,
  username: a.username,
  avatarUrl: a.avatarUrl,
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

export const accountListItemDto = (a: AccountListItem) => ({
  ...workspaceAccountDto(a),
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
