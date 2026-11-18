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
  /**
   * A file of the workspace, in its library, with its variants' rows (the files themselves are
   * the test's to write, at the keys given).
   */
  media(
    organizationId: string,
    workspaceId: string,
    opts: {
      uploadedBy: string
      kind?: 'image' | 'video'
      status?: 'processing' | 'ready' | 'deleted'
      storageKey?: string | null
      sizeBytes?: number
      variants?: {
        purpose: string
        storageKey: string
        mime: string
        sizeBytes: number
        publicToken?: string | null
      }[]
    },
  ): Promise<string>
  /** A social account of the agency, with its own connection; in the workspaces given. */
  account(
    organizationId: string,
    opts?: { platform?: 'instagram' | 'facebook'; workspaceIds?: string[] },
  ): Promise<string>
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
    async media(organizationId, workspaceId, opts) {
      const id = randomUUID()
      const kind = opts.kind ?? 'video'
      const status = opts.status ?? 'ready'
      await c.query(
        `insert into media (id, organization_id, workspace_id, uploaded_by, kind, status,
                            original_name, mime, size_bytes, storage_key, deleted_at)
         values ($1, $2, $3, $4, $5, $6::text, $7, $8, $9, $10,
                 case when $6::text = 'deleted' then now() end)`,
        [
          id,
          organizationId,
          workspaceId,
          opts.uploadedBy,
          kind,
          status,
          kind === 'video' ? 'clip.mov' : 'foto.heic',
          kind === 'video' ? 'video/quicktime' : 'image/heic',
          opts.sizeBytes ?? 1000,
          opts.storageKey === undefined
            ? `org/${organizationId}/media/${id}/original`
            : opts.storageKey,
        ],
      )
      if (status !== 'deleted')
        await c.query(
          'insert into library_items (organization_id, workspace_id, media_id) values ($1, $2, $3)',
          [organizationId, workspaceId, id],
        )
      for (const v of opts.variants ?? [])
        await c.query(
          `insert into media_variants (id, organization_id, media_id, purpose, storage_key, mime,
                                       size_bytes, public_token)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            organizationId,
            id,
            v.purpose,
            v.storageKey,
            v.mime,
            v.sizeBytes,
            v.publicToken ?? null,
          ],
        )
      return id
    },
    async account(organizationId, opts = {}) {
      const [connectionId, id] = [randomUUID(), randomUUID()]
      const platform = opts.platform ?? 'instagram'
      await c.query(
        `insert into account_connections
           (id, organization_id, kind, external_user_id, connected_by, token_enc, key_version)
         values ($1, $2, 'meta_system_user', $3, $4, 'v1.1.x', 1)`,
        [connectionId, organizationId, `su-${connectionId}`, randomUUID()],
      )
      await c.query(
        `insert into social_accounts (id, organization_id, platform, external_id, name, page_id,
                                      connection_id)
         values ($1, $2, $3, $4, 'Forno', $5, $6)`,
        [
          id,
          organizationId,
          platform,
          `ext-${id}`,
          platform === 'facebook' ? `ext-${id}` : null,
          connectionId,
        ],
      )
      for (const workspaceId of opts.workspaceIds ?? [])
        await c.query(
          `insert into workspace_accounts (organization_id, workspace_id, account_id)
           values ($1, $2, $3)`,
          [organizationId, workspaceId, id],
        )
      return id
    },
  }
}

export function seed<T>(url: string, fn: (s: Seeder) => Promise<T>): Promise<T> {
  return withScope(url, { kind: 'system' }, (c) => fn(seederOf(c)))
}
