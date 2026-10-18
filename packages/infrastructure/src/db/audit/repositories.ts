import type { AuditLog, IdGenerator } from '@app/application'
import { isPersonalAuditAction } from '@app/application'
import type { DbExecutor } from '../client.js'
import { auditLog } from './schema.js'

export function drizzleAuditLog(db: DbExecutor, ids: IdGenerator): AuditLog {
  return {
    async record(entry) {
      if (isPersonalAuditAction(entry.action) && entry.organizationId !== null) {
        // a personal entry inside an agency would show the person's account events to it
        throw new Error(`audit action ${entry.action} is personal: organizationId must be null`)
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
