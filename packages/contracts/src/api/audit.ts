import { z } from 'zod'
import { defineContract } from './define.js'
import { Id, OrgParams, Timestamp } from './common.js'

/** No IP: the log shows who did what and when, not from where. */
export const AuditItem = z.object({
  id: z.string(),
  organizationId: z.string(),
  actorId: z.string().nullable(),
  authorName: z.string(),
  action: z.string(),
  entity: z.string().nullable(),
  entityId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  source: z.enum(['panel', 'api', 'mcp', 'system']),
  createdAt: Timestamp,
  data: z.record(z.string(), z.unknown()),
})

/** The use case checks action, cursor and dates again; one value per key. */
export const AuditLogQuery = z.strictObject({
  workspaceId: Id.optional(),
  actorId: Id.optional(),
  action: z.string().max(64).optional(),
  source: z.enum(['panel', 'api', 'mcp', 'system']).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

export const auditLogRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/audit-log',
  summary: 'Il registro attività dell’agenzia, dal più recente',
  request: { params: OrgParams, query: AuditLogQuery },
  response: z.object({ items: z.array(AuditItem), nextCursor: z.string().nullable() }),
  auth: 'session',
  scope: 'organization',
})

export const auditRoutes = [auditLogRoute] as const
