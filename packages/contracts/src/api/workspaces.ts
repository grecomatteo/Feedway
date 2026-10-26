import { z } from 'zod'
import { defineContract } from './define.js'
import { Id, OrgParams, OrgSlug, WorkspaceRole } from './common.js'

export const Workspace = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  archivedAt: z.string().nullable(),
  myRole: z.enum(['owner', 'admin', 'manager', 'publisher', 'editor', 'viewer']),
})

const WorkspaceParams = z.strictObject({ org: OrgSlug, id: Id })
const WorkspaceMemberParams = z.strictObject({ org: OrgSlug, id: Id, userId: Id })
const WorkspaceName = z.strictObject({ name: z.string().max(400) })

export const listWorkspacesRoute = defineContract({
  method: 'GET',
  path: '/api/v1/orgs/{org}/workspaces',
  summary: 'Gli spazi di lavoro visibili alla persona',
  request: { params: OrgParams },
  response: z.object({ items: z.array(Workspace) }),
  auth: 'session',
  scope: 'organization',
})

export const createWorkspaceRoute = defineContract({
  method: 'POST',
  path: '/api/v1/orgs/{org}/workspaces',
  summary: 'Crea uno spazio di lavoro',
  request: { params: OrgParams, body: WorkspaceName },
  response: Workspace,
  auth: 'session',
  scope: 'organization',
})

export const renameWorkspaceRoute = defineContract({
  method: 'PATCH',
  path: '/api/v1/orgs/{org}/workspaces/{id}',
  summary: 'Rinomina uno spazio di lavoro',
  request: { params: WorkspaceParams, body: WorkspaceName },
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
