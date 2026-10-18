import { randomUUID } from 'node:crypto'
import type { OrgRole, WorkspaceRole } from '@app/domain'
import type pg from 'pg'
import { withScope } from './scoped-db.js'

/** Inserts rows with plain SQL in the system scope; returns the new ids. For tests only. */
export interface Seeder {
  user(opts?: { email?: string; name?: string }): Promise<string>
  organization(opts?: { status?: 'active' | 'suspended' }): Promise<string>
  member(
    organizationId: string,
    userId: string,
    role: OrgRole,
    status?: 'active' | 'disabled',
  ): Promise<void>
  workspace(organizationId: string, opts?: { name?: string; archived?: boolean }): Promise<string>
  workspaceMember(
    organizationId: string,
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<void>
}

function seederOf(c: pg.Client): Seeder {
  return {
    async user(opts = {}) {
      const id = randomUUID()
      await c.query('insert into users (id, name, email) values ($1, $2, $3)', [
        id,
        opts.name ?? 'Utente',
        opts.email ?? `${id}@example.test`,
      ])
      return id
    },
    async organization(opts = {}) {
      const id = randomUUID()
      await c.query(
        `insert into organizations (id, name, slug, status, suspended_at)
         values ($1, $2, $3, $4::text, case when $4::text = 'suspended' then now() end)`,
        [id, `Agenzia ${id.slice(0, 8)}`, id, opts.status ?? 'active'],
      )
      return id
    },
    async member(organizationId, userId, role, status = 'active') {
      await c.query(
        'insert into organization_members (organization_id, user_id, role, status) values ($1, $2, $3, $4)',
        [organizationId, userId, role, status],
      )
    },
    async workspace(organizationId, opts = {}) {
      const id = randomUUID()
      await c.query(
        `insert into workspaces (id, organization_id, name, slug, archived_at)
         values ($1, $2, $3, $4, case when $5::boolean then now() end)`,
        [id, organizationId, opts.name ?? `Spazio ${id.slice(0, 8)}`, id, opts.archived ?? false],
      )
      return id
    },
    async workspaceMember(organizationId, workspaceId, userId, role) {
      await c.query(
        'insert into workspace_members (organization_id, workspace_id, user_id, role) values ($1, $2, $3, $4)',
        [organizationId, workspaceId, userId, role],
      )
    },
  }
}

export function seed<T>(url: string, fn: (s: Seeder) => Promise<T>): Promise<T> {
  return withScope(url, { kind: 'system' }, (c) => fn(seederOf(c)))
}
