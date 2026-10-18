export type Permission =
  | 'workspace.view'
  | 'media.upload'
  | 'post.draft'
  | 'post.publish'
  | 'post.manage_others'
  | 'post.retry'
  | 'workspace.content_settings.manage'
  | 'workspace.members.manage'
  | 'share_link.manage'
  | 'audit.view_workspace'
  | 'workspace.create'
  | 'workspace.accounts.assign'
  | 'accounts.manage'
  | 'users.manage'
  | 'audit.view_all'
  | 'organization.settings.view'
  | 'organization.settings.manage'

export type PlatformPermission = 'platform.organizations.manage' | 'platform.users.manage'

export const PLATFORM_PERMISSIONS: ReadonlySet<PlatformPermission> = new Set<PlatformPermission>([
  'platform.organizations.manage',
  'platform.users.manage',
])

/** Permissions that only make sense inside one workspace: without `workspaceId` they are denied. */
export const WORKSPACE_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
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
])

export const ALL_PERMISSIONS: readonly Permission[] = [
  ...WORKSPACE_PERMISSIONS,
  'workspace.create',
  'workspace.accounts.assign',
  'accounts.manage',
  'users.manage',
  'audit.view_all',
  'organization.settings.view',
  'organization.settings.manage',
]
