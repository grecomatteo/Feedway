import type { AuditLog, IdGenerator } from '@app/application'
import { isPersonalAuditAction } from '@app/application'
import type { DbExecutor } from '../client.js'
import type { TxContext } from '../tx-context.js'
import { auditLog } from './schema.js'

// user.* actions may be personal too (user.anonymized has one entry per agency and one personal)
const isAgencyAction = (action: string) =>
  action.startsWith('workspace.') ||
  action.startsWith('member.') ||
  action.startsWith('organization.')

export function drizzleAuditLog(db: DbExecutor, ids: IdGenerator, ctx: TxContext): AuditLog {
  return {
    async record(entry) {
      if (isPersonalAuditAction(entry.action) && entry.organizationId !== null) {
        // a personal entry inside an agency would show the person's account events to it
        throw new Error(`audit action ${entry.action} is personal: organizationId must be null`)
      }
      if (isAgencyAction(entry.action) && entry.organizationId === null && ctx.kind !== 'system') {
        // an agency event without its agency would vanish from that agency's log; platform
        // entries (no agency) are written in the system scope
        throw new Error(
          `audit action ${entry.action} needs an organizationId outside the system scope`,
        )
      }
      await db.insert(auditLog).values({
        id: ids.newId(),
        organizationId: entry.organizationId,
        actorId: entry.actorId,
        source: entry.source,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        workspaceId: entry.workspaceId,
        ip: entry.ip,
        data: entry.data ?? {},
      })
    },
  }
}
