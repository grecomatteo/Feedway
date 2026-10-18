import type { Permission } from './permissions.js'
import { ALL_PERMISSIONS } from './permissions.js'

export type OrgRole = 'owner' | 'admin' | 'member'
export type WorkspaceRole = 'manager' | 'publisher' | 'editor' | 'viewer'

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  'manager',
  'publisher',
  'editor',
  'viewer',
]
/** Roles a Manager may give or take away (spec §10.2, note 1). */
export const BELOW_MANAGER: readonly WorkspaceRole[] = ['publisher', 'editor', 'viewer']

/** Granted only on resources the actor owns (or new ones, for drafts). */
export type Grant = 'all' | 'own'

const all = (permissions: readonly Permission[]) =>
  new Map<Permission, Grant>(permissions.map((p) => [p, 'all']))

export const ORG_ROLE_PERMISSIONS: Record<
  Exclude<OrgRole, 'member'>,
  ReadonlyMap<Permission, Grant>
> = {
  owner: all(ALL_PERMISSIONS),
  admin: all(ALL_PERMISSIONS.filter((p) => p !== 'organization.settings.manage')),
}

export const WORKSPACE_ROLE_PERMISSIONS: Record<WorkspaceRole, ReadonlyMap<Permission, Grant>> = {
  manager: all([
    'workspace.view',
    'media.upload',
    'post.draft',
    'post.publish',
    'post.manage_others',
    'post.retry',
    'workspace.content_settings.manage',
    'workspace.members.manage',
    'share_link.manage',
    'audit.view_workspace',
  ]),
  publisher: new Map<Permission, Grant>([
    ['workspace.view', 'all'],
    ['media.upload', 'all'],
    ['post.draft', 'own'],
    ['post.publish', 'all'],
    ['post.retry', 'own'],
  ]),
  editor: new Map<Permission, Grant>([
    ['workspace.view', 'all'],
    ['media.upload', 'all'],
    ['post.draft', 'own'],
  ]),
  viewer: all(['workspace.view']),
}
