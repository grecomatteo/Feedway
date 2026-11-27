import { z } from 'zod'
import { defineContract } from './define.js'
import { Platform } from './accounts.js'
import { Id, OrgParams, OrgSlug, WorkspaceRole } from './common.js'

export const Workspace = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  archivedAt: z.string().nullable(),
  myRole: z.enum(['owner', 'admin', 'manager', 'publisher', 'editor', 'viewer']),
  /** `HH:MM`: the local time a new post proposes; null: none. */
  defaultPostTime: z.string().nullable(),
  /** after how many days untouched a draft goes to «Eliminati»: 30, 60 or 90; null «Mai» */
  draftRetentionDays: z.number().int().nullable(),
})

/**
 * A profile on the row of a client: the names and pictures of its accounts and what its link asks
 * (`reconnect` when the connection stopped working), never anything of the connection itself.
 */
export const ClientProfile = z.object({
  key: z.string(),
  accounts: z.array(
    z.object({
      id: Id,
      platform: Platform,
      name: z.string(),
      username: z.string().nullable(),
      /** Feedway's copy of the picture, in the panel; null: the initials. */
      avatarUrl: z.string().nullable(),
    }),
  ),
  link: z.enum(['reconnect', 'error', 'warning', 'ok']),
})
export type ClientProfile = z.infer<typeof ClientProfile>

const WorkspaceParams = z.strictObject({ org: OrgSlug, id: Id })
const WorkspaceMemberParams = z.strictObject({ org: OrgSlug, id: Id, userId: Id })
const WorkspaceName = z.strictObject({ name: z.string().max(400) })

export const listWorkspacesRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces',
  summary: 'Gli spazi di lavoro visibili alla persona',
  request: { params: OrgParams },
  response: z.object({
    items: z.array(
      Workspace.extend({
        /** The picture of its first profile, as Feedway keeps it; null: the initials. */
        photoUrl: z.string().nullable(),
        /** Its profiles (spec §14.7), only from its active accounts; Instagram first. */
        profiles: z.array(ClientProfile),
      }),
    ),
  }),
  auth: 'session',
  scope: 'organization',
})

export const createWorkspaceRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces',
  summary: 'Crea uno spazio di lavoro, anche dai profili già importati',
  request: {
    params: OrgParams,
    body: WorkspaceName.extend({
      /** The accounts of its profiles, already imported (spec §14.7, «Nuovo cliente»). */
      accountIds: z.array(Id).max(20).optional(),
    }),
  },
  response: Workspace,
  auth: 'session',
  scope: 'organization',
})

/**
 * One field at a time, each with its own permission: the name (Owner and Admin) or the default
 * time of the posts, `HH:MM` or null (Manager and above).
 */
const WorkspaceChange = z
  .strictObject({
    name: z.string().max(400),
    defaultPostTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    draftRetentionDays: z.union([z.literal(30), z.literal(60), z.literal(90), z.null()]),
  })
  .partial()
  .refine(
    (b) =>
      [b.name, b.defaultPostTime, b.draftRetentionDays].filter((v) => v !== undefined).length === 1,
    { message: 'Un campo alla volta: name, defaultPostTime oppure draftRetentionDays' },
  )

export const renameWorkspaceRoute = defineContract({
  method: 'PATCH',
  path: '/api/v1/orgs/{org}/workspaces/{id}',
  summary:
    'Rinomina uno spazio di lavoro, o ne cambia l’orario predefinito dei post o i giorni dopo cui una bozza non toccata va negli «Eliminati»',
  request: { params: WorkspaceParams, body: WorkspaceChange },
  response: Workspace,
  auth: 'session',
  scope: 'organization',
})

export const archiveWorkspaceRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/archive',
  summary: 'Archivia uno spazio di lavoro',
  request: { params: WorkspaceParams },
  response: z.object({ archived: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

/** No email: whoever works in the space sees who else does, not how to reach them. */
export const WorkspaceMember = z.object({
  userId: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: WorkspaceRole,
  status: z.enum(['active', 'disabled']),
})

export const listWorkspaceMembersRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces/{id}/members',
  summary: 'Chi lavora nello spazio',
  request: { params: WorkspaceParams },
  response: z.object({ items: z.array(WorkspaceMember) }),
  auth: 'session',
  scope: 'organization',
})

export const addWorkspaceMemberRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces/{id}/members',
  summary: 'Aggiunge un utente dell’agenzia allo spazio (con riconferma)',
  request: {
    params: WorkspaceParams,
    body: z.strictObject({ userId: Id, role: WorkspaceRole }),
  },
  response: z.object({ role: WorkspaceRole }),
  auth: 'session',
  scope: 'organization',
})

export const changeWorkspaceMemberRoute = defineContract({
  method: 'PUT',
  path: '/api/v1/orgs/{org}/workspaces/{id}/members/{userId}',
  summary: 'Cambia il ruolo nello spazio (con riconferma); scollega l’utente',
  request: { params: WorkspaceMemberParams, body: z.strictObject({ role: WorkspaceRole }) },
  response: z.object({ role: WorkspaceRole }),
  auth: 'session',
  scope: 'organization',
})

export const removeWorkspaceMemberRoute = defineContract({
  method: 'DELETE',
  path: '/api/v1/orgs/{org}/workspaces/{id}/members/{userId}',
  summary: 'Toglie l’utente dallo spazio e lo scollega',
  request: { params: WorkspaceMemberParams },
  response: z.object({ removed: z.literal(true) }),
  auth: 'session',
  scope: 'organization',
})

export const workspaceRoutes = [
  listWorkspacesRoute,
  createWorkspaceRoute,
  renameWorkspaceRoute,
  archiveWorkspaceRoute,
  listWorkspaceMembersRoute,
  addWorkspaceMemberRoute,
  changeWorkspaceMemberRoute,
  removeWorkspaceMemberRoute,
] as const
