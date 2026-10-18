import { sql } from 'drizzle-orm'
import type { IdGenerator, Logger, Tx, UnitOfWork } from '@app/application'
import { drizzleAuditLog } from './audit/repositories.js'
import type { Db, DbExecutor } from './client.js'
import { drizzleSessions, drizzleUsers } from './identity/repositories.js'
import {
  drizzleInvites,
  drizzleOrganizationKeys,
  drizzleOrganizations,
  drizzleOrgMembers,
} from './organizations/repositories.js'
import { drizzleWorkspaceMembers, drizzleWorkspaces } from './workspaces/repositories.js'

export interface UnitOfWorkDeps {
  db: Db
  ids: IdGenerator
  logger: Logger
}

const EXECUTOR = Symbol('executor')

function buildTx(db: DbExecutor, ids: IdGenerator): Tx {
  const tx: Tx = {
    users: drizzleUsers(db),
    sessions: drizzleSessions(db),
    organizations: drizzleOrganizations(db),
    orgMembers: drizzleOrgMembers(db),
    organizationKeys: drizzleOrganizationKeys(db),
    invites: drizzleInvites(db),
    workspaces: drizzleWorkspaces(db),
    workspaceMembers: drizzleWorkspaceMembers(db),
    audit: drizzleAuditLog(db, ids),
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
    run(scope, fn) {
      if (!scope.userId) throw new Error('a transaction scope needs a userId')
      const organizationId = 'organizationId' in scope ? scope.organizationId : ''
      if ('organizationId' in scope && !organizationId) {
        throw new Error('an organization scope needs an organizationId')
      }
      return db.transaction(async (t) => {
        await t.execute(
          sql`select set_config('app.organization_id', ${organizationId}, true), set_config('app.user_id', ${scope.userId}, true)`,
        )
        return fn(buildTx(t, ids))
      })
    },
    runAsSystem(reason, fn) {
      logger.info({ reason }, 'system scope transaction')
      return db.transaction(async (t) => {
        await t.execute(sql`select set_config('app.scope', 'system', true)`)
        return fn(buildTx(t, ids))
      })
    },
  }
}
