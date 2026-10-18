import type { Permission, PlatformPermission } from './permissions.js'
import { PLATFORM_PERMISSIONS, WORKSPACE_PERMISSIONS } from './permissions.js'
import type { Grant, OrgRole, WorkspaceRole } from './roles.js'
import {
  BELOW_MANAGER,
  ORG_ROLE_PERMISSIONS,
  WORKSPACE_ROLE_PERMISSIONS,
  WORKSPACE_ROLES,
} from './roles.js'

export interface OrgActor {
  userId: string
  platformRole: 'admin' | null
  organizationId: string
  orgRole: OrgRole
  /** workspaceId → role, only inside this organization. */
  memberships: ReadonlyMap<string, WorkspaceRole>
}

export interface PlatformActor {
  userId: string
  platformRole: 'admin' | null
}

export interface TargetUser {
  id: string
  orgRole: OrgRole
  workspaceRole?: WorkspaceRole
}

export interface Resource {
  organizationId: string
  workspaceId?: string
  /** Owner of the resource; absent for something not created yet. */
  ownerId?: string
  targetUser?: TargetUser
  assignRole?: WorkspaceRole | OrgRole
}

const isWorkspaceRole = (role: WorkspaceRole | OrgRole): role is WorkspaceRole =>
  (WORKSPACE_ROLES as readonly string[]).includes(role)

export function seesAllWorkspaces(actor: OrgActor): boolean {
  return actor.orgRole === 'owner' || actor.orgRole === 'admin'
}

function grantFor(
  actor: OrgActor,
  permission: Permission,
  workspaceId: string | undefined,
): Grant | undefined {
  if (actor.orgRole !== 'member') return ORG_ROLE_PERMISSIONS[actor.orgRole].get(permission)
  const role = workspaceId === undefined ? undefined : actor.memberships.get(workspaceId)
  return role === undefined ? undefined : WORKSPACE_ROLE_PERMISSIONS[role].get(permission)
}

/** Who the actor may act on and which role they may hand out (spec §10.1–10.2). */
function canActOn(actor: OrgActor, permission: Permission, resource: Resource): boolean {
  const { targetUser, assignRole } = resource
  if (targetUser?.orgRole === 'owner') return false
  if (assignRole === 'owner') return false
  if (actor.orgRole === 'admin' && targetUser?.orgRole === 'admin') return false
  if (assignRole !== undefined) {
    const assignsWorkspaceRole = isWorkspaceRole(assignRole)
    if (permission === 'workspace.members.manage' && !assignsWorkspaceRole) return false
    if (permission !== 'workspace.members.manage' && assignsWorkspaceRole) return false
    if (assignRole === 'admin' && actor.orgRole !== 'owner') return false
  }
  if (actor.orgRole === 'member' && permission === 'workspace.members.manage') {
    if (targetUser?.id === actor.userId) return false
    if (targetUser !== undefined && targetUser.orgRole !== 'member') return false
    const lower = (role: WorkspaceRole | OrgRole | undefined) =>
      role === undefined || (BELOW_MANAGER as readonly string[]).includes(role)
    if (!lower(targetUser?.workspaceRole) || !lower(assignRole)) return false
  }
  return true
}

export function can(actor: OrgActor, permission: Permission, resource: Resource): boolean {
  if (resource.organizationId !== actor.organizationId) return false
  if (WORKSPACE_PERMISSIONS.has(permission) && resource.workspaceId === undefined) return false
  const grant = grantFor(actor, permission, resource.workspaceId)
  if (grant === undefined) return false
  if (grant === 'own') {
    const isNew = resource.ownerId === undefined
    const isOwn = resource.ownerId === actor.userId
    // a retry always concerns an existing publication: "new" does not count there
    if (!(isOwn || (isNew && permission !== 'post.retry'))) return false
  }
  return canActOn(actor, permission, resource)
}

export function canPlatform(actor: PlatformActor, permission: PlatformPermission): boolean {
  return actor.platformRole === 'admin' && PLATFORM_PERMISSIONS.has(permission)
}

export function assignableWorkspaceRoles(actor: OrgActor, workspaceId: string): WorkspaceRole[] {
  if (seesAllWorkspaces(actor)) return [...WORKSPACE_ROLES]
  return actor.memberships.get(workspaceId) === 'manager' ? [...BELOW_MANAGER] : []
}
