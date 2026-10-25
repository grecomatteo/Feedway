import type { AuditAction, AuditLog, AuditSource, IdGenerator } from '@app/application'
import { isPersonalAuditAction } from '@app/application'
import { and, desc, eq, gte, lt, lte, sql, type SQL } from 'drizzle-orm'
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
    async listForOrganization(q) {
      // the agency filter is explicit: row level security also lets a person read their own
      // personal entries (organization_id null), which never belong in an agency's log
      const where: SQL[] = [eq(auditLog.organizationId, q.organizationId)]
      if (q.workspaceId !== undefined) where.push(eq(auditLog.workspaceId, q.workspaceId))
      if (q.actorId !== undefined) where.push(eq(auditLog.actorId, q.actorId))
      if (q.action !== undefined) where.push(eq(auditLog.action, q.action))
      if (q.source !== undefined) where.push(eq(auditLog.source, q.source))
      if (q.from !== undefined) where.push(gte(auditLog.createdAt, q.from))
      if (q.to !== undefined) where.push(lt(auditLog.createdAt, q.to))
      if (q.after !== undefined) {
        const at = sql`${q.after.position}::timestamptz`
        // the plain bound lets the (organization_id, created_at) index range-scan
        where.push(lte(auditLog.createdAt, at))
        where.push(sql`(${auditLog.createdAt}, ${auditLog.id}) < (${at}, ${q.after.id}::uuid)`)
      }
      const rows = await db
        .select({
          id: auditLog.id,
          organizationId: auditLog.organizationId,
          actorId: auditLog.actorId,
          source: auditLog.source,
          action: auditLog.action,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          workspaceId: auditLog.workspaceId,
          data: auditLog.data,
          createdAt: auditLog.createdAt,
          position: sql<string>`to_char(${auditLog.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(auditLog)
        .where(and(...where))
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(q.limit)
      return rows.map((row) => ({
        ...row,
        organizationId: q.organizationId,
        source: row.source as AuditSource,
        action: row.action as AuditAction,
        data: row.data as Record<string, unknown>,
      }))
    },
  }
}
