import { check, index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createdAt, inList } from '../columns.js'

export const AUDIT_SOURCES = ['panel', 'api', 'mcp', 'system'] as const

// Append-only: app_runtime has no UPDATE or DELETE; old IPs are shortened only through
// audit_shorten_ips() (migration 0002). No foreign keys: entries outlive what they describe.
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    // null: personal entry of the actor (account, privacy), or platform entry
    organizationId: uuid('organization_id'),
    actorId: uuid('actor_id'),
    source: text('source').notNull(),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: uuid('entity_id'),
    workspaceId: uuid('workspace_id'),
    ip: inet('ip'),
    data: jsonb('data').default({}).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_organization_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('audit_log_organization_workspace_created_idx').on(
      t.organizationId,
      t.workspaceId,
      t.createdAt.desc(),
    ),
    index('audit_log_actor_created_idx').on(t.actorId, t.createdAt.desc()),
    check('audit_log_source', inList('source', AUDIT_SOURCES)),
  ],
)
