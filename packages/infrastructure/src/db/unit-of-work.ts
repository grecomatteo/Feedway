import { sql } from 'drizzle-orm'
import type { IdGenerator, Logger, Tx, UnitOfWork } from '@app/application'
import {
  drizzleConnectionAttempts,
  drizzleConnections,
  drizzleSocialAccounts,
  drizzleWorkspaceAccounts,
} from './accounts/repositories.js'
import { drizzleAuditLog } from './audit/repositories.js'
import type { Db, DbExecutor } from './client.js'
import {
  drizzleCredentials,
  drizzleDataExports,
  drizzleEmailChanges,
  drizzleKnownDevices,
  drizzleSessions,
  drizzleUsers,
} from './identity/repositories.js'
import {
  drizzleInvites,
  drizzleOrganizationKeys,
  drizzleBranding,
  drizzleOrganizations,
  drizzleOrgMembers,
} from './organizations/repositories.js'
import { drizzleHeartbeats } from './notifications/heartbeats.js'
import { drizzleIntegrations } from './integrations/repositories.js'
import { drizzleMedia } from './media/repositories.js'
import { drizzleUploadSessions } from './media/upload-sessions.js'
import { drizzleContentSettings } from './posts/content-settings.js'
import { drizzlePosts } from './posts/repositories.js'
import { drizzlePublishing } from './posts/publishing.js'
import {
  drizzleNotificationPrefs,
  drizzleNotifications,
  drizzleTelegramLinks,
} from './notifications/repositories.js'
import { drizzleOutbox } from './outbox/repositories.js'
import { drizzlePlatformSettings } from './platform/repositories.js'
import type { TxContext } from './tx-context.js'
import { drizzleWorkspaceMembers, drizzleWorkspaces } from './workspaces/repositories.js'

export interface UnitOfWorkDeps {
  db: Db
  ids: IdGenerator
  logger: Logger
  /**
   * Called after the commit of a transaction that wrote an outbox event (plan 08 P2): the
   * runtime wakes the notifications' dispatcher. A failure is logged, never thrown: the use case
   * has saved, and the dispatcher's every-minute run takes the event anyway.
   */
  afterEventsCommitted?: () => Promise<void>
}

/** Whether the transaction wrote an event, for the hook after its commit. */
interface TxMarks {
  wroteEvent: boolean
}

const EXECUTOR = Symbol('executor')

function buildTx(db: DbExecutor, ids: IdGenerator, ctx: TxContext, marks?: TxMarks): Tx {
  const outbox = drizzleOutbox(db, ids, ctx)
  const tx: Tx = {
    users: drizzleUsers(db, ctx),
    sessions: drizzleSessions(db, ctx),
    credentials: drizzleCredentials(db, ids, ctx),
    emailChanges: drizzleEmailChanges(db, ids, ctx),
    knownDevices: drizzleKnownDevices(db, ctx),
    dataExports: drizzleDataExports(db, ctx),
    organizations: drizzleOrganizations(db, ctx),
    orgMembers: drizzleOrgMembers(db),
    organizationKeys: drizzleOrganizationKeys(db),
    branding: drizzleBranding(db, ctx),
    invites: drizzleInvites(db, ctx),
    workspaces: drizzleWorkspaces(db),
    workspaceMembers: drizzleWorkspaceMembers(db),
    platformSettings: drizzlePlatformSettings(db),
    integrations: drizzleIntegrations(db, ids),
    accounts: drizzleSocialAccounts(db, ids),
    connections: drizzleConnections(db),
    connectionAttempts: drizzleConnectionAttempts(db),
    workspaceAccounts: drizzleWorkspaceAccounts(db),
    media: drizzleMedia(db),
    uploads: drizzleUploadSessions(db),
    posts: drizzlePosts(db, ids),
    publishing: drizzlePublishing(db, ids),
    outbox: {
      ...outbox,
      async record(event) {
        const written = await outbox.record(event)
        if (written && marks) marks.wroteEvent = true
        return written
      },
    },
    notifications: drizzleNotifications(db, ids, ctx),
    notificationPrefs: drizzleNotificationPrefs(db, ctx),
    telegramLinks: drizzleTelegramLinks(db),
    contentSettings: drizzleContentSettings(db),
    heartbeats: drizzleHeartbeats(db, ctx),
    audit: drizzleAuditLog(db, ids, ctx),
  }
  Object.defineProperty(tx, EXECUTOR, { value: db, enumerable: false })
  return tx
}

/**
 * The raw transaction behind a `Tx`. Only for infrastructure tests that must prove row level
 * security holds when a query forgets its own filter; never exported from the package.
 */
export function executorOf(tx: Tx): DbExecutor {
  const db = (tx as Tx & { [EXECUTOR]?: DbExecutor })[EXECUTOR]
  if (!db) throw new Error('not a transaction of this unit of work')
  return db
}

// set_config(…, true) lasts until the end of the transaction: a pooled connection never
// carries a scope into the next one.
export function createUnitOfWork({
  db,
  ids,
  logger,
  afterEventsCommitted,
}: UnitOfWorkDeps): UnitOfWork {
  const afterCommit = async (marks: TxMarks) => {
    if (!marks.wroteEvent || !afterEventsCommitted) return
    try {
      await afterEventsCommitted()
    } catch (error) {
      logger.error({ err: error }, 'hook after the commit of an event failed')
    }
  }
  return {
    async run(scope, fn) {
      // null only for an agency's job; an empty or missing id is always a bug
      if (scope.userId === null ? !('organizationId' in scope) : !scope.userId)
        throw new Error('a transaction scope needs a userId')
      const ctx: TxContext =
        'organizationId' in scope
          ? { kind: 'organization', organizationId: scope.organizationId, userId: scope.userId }
          : { kind: 'user', userId: scope.userId }
      if (ctx.kind === 'organization' && !ctx.organizationId) {
        throw new Error('an organization scope needs an organizationId')
      }
      const organizationId = ctx.kind === 'organization' ? ctx.organizationId : ''
      const marks: TxMarks = { wroteEvent: false }
      const result = await db.transaction(async (t) => {
        await t.execute(
          sql`select set_config('app.organization_id', ${organizationId}, true), set_config('app.user_id', ${scope.userId ?? ''}, true)`,
        )
        return fn(buildTx(t, ids, ctx, marks))
      })
      await afterCommit(marks)
      return result
    },
    async runAsSystem(reason, fn) {
      logger.info({ reason }, 'system scope transaction')
      const marks: TxMarks = { wroteEvent: false }
      const result = await db.transaction(async (t) => {
        await t.execute(sql`select set_config('app.scope', 'system', true)`)
        return fn(buildTx(t, ids, { kind: 'system' }, marks))
      })
      await afterCommit(marks)
      return result
    },
  }
}
