import { sql } from 'drizzle-orm'
import type { IdGenerator, Logger, Tx, UnitOfWork } from '@app/application'
import { drizzleAuditLog } from './audit/repositories.js'
import type { Db, DbExecutor } from './client.js'
import { drizzleKnownDevices, drizzleSessions, drizzleUsers } from './identity/repositories.js'
import {
  drizzleInvites,
  drizzleOrganizationKeys,
  drizzleOrganizations,
  drizzleOrgMembers,
} from './organizations/repositories.js'
import { drizzlePlatformSettings } from './platform/repositories.js'
import type { TxContext } from './tx-context.js'
import { drizzleWorkspaceMembers, drizzleWorkspaces } from './workspaces/repositories.js'

export interface UnitOfWorkDeps {
  db: Db
  ids: IdGenerator
  logger: Logger
}

const EXECUTOR = Symbol('executor')

function buildTx(db: DbExecutor, ids: IdGenerator, ctx: TxContext): Tx {
  const tx: Tx = {
    users: drizzleUsers(db, ctx),
    sessions: drizzleSessions(db, ctx),
    knownDevices: drizzleKnownDevices(db, ctx),
    organizations: drizzleOrganizations(db, ctx),
    orgMembers: drizzleOrgMembers(db),
    organizationKeys: drizzleOrganizationKeys(db),
    invites: drizzleInvites(db),
    workspaces: drizzleWorkspaces(db),
    workspaceMembers: drizzleWorkspaceMembers(db),
    platformSettings: drizzlePlatformSettings(db),
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
export function createUnitOfWork({ db, ids, logger }: UnitOfWorkDeps): UnitOfWork {
  return {
    async run(scope, fn) {
      if (!scope.userId) throw new Error('a transaction scope needs a userId')
      const ctx: TxContext =
        'organizationId' in scope
          ? { kind: 'organization', organizationId: scope.organizationId, userId: scope.userId }
          : { kind: 'user', userId: scope.userId }
      if (ctx.kind === 'organization' && !ctx.organizationId) {
        throw new Error('an organization scope needs an organizationId')
      }
      const organizationId = ctx.kind === 'organization' ? ctx.organizationId : ''
      return db.transaction(async (t) => {
        await t.execute(
          sql`select set_config('app.organization_id', ${organizationId}, true), set_config('app.user_id', ${scope.userId}, true)`,
        )
        return fn(buildTx(t, ids, ctx))
      })
    },
    async runAsSystem(reason, fn) {
      logger.info({ reason }, 'system scope transaction')
      return db.transaction(async (t) => {
        await t.execute(sql`select set_config('app.scope', 'system', true)`)
        return fn(buildTx(t, ids, { kind: 'system' }))
      })
    },
  }
}
