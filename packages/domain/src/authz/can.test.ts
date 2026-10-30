import { describe, expect, test } from 'vitest'
import {
  ALL_PERMISSIONS,
  assignableWorkspaceRoles,
  can,
  canPlatform,
  seesAllWorkspaces,
  WORKSPACE_PERMISSIONS,
} from './index.js'
import type { OrgActor, OrgRole, Permission, Resource, WorkspaceRole } from './index.js'
import { MATRIX } from './matrix.fixture.js'
import type { MatrixRole } from './matrix.fixture.js'

const actorOf = (
  org: string,
  orgRole: OrgRole,
  memberships: Record<string, WorkspaceRole> = {},
): OrgActor => ({
  userId: `${orgRole}-${org}`,
  platformRole: null,
  organizationId: org,
  orgRole,
  memberships: new Map(Object.entries(memberships)),
})
const ownerOf = (org: string) => actorOf(org, 'owner')
const adminOf = (org: string) => actorOf(org, 'admin')
const memberOf = (org: string, memberships: Record<string, WorkspaceRole>) =>
  actorOf(org, 'member', memberships)
const m1 = { id: 'm1', orgRole: 'member' as const }

function actorFor(role: MatrixRole): OrgActor {
  if (role === 'owner' || role === 'admin') return actorOf('A', role)
  return memberOf('A', { w1: role })
}

interface Case {
  role: MatrixRole
  permission: Permission
  own: boolean
  sameWs: boolean
  sameOrg: boolean
  actor: OrgActor
  resource: Resource
  expected: boolean
}

const cases: Case[] = []
for (const permission of ALL_PERMISSIONS) {
  const workspaceScoped = WORKSPACE_PERMISSIONS.has(permission)
  for (const role of Object.keys(MATRIX[permission]) as MatrixRole[]) {
    const cell = MATRIX[permission][role]
    const actor = actorFor(role)
    for (const own of [true, false]) {
      for (const sameWs of [true, false]) {
        for (const sameOrg of [true, false]) {
          const resource: Resource = {
            organizationId: sameOrg ? 'A' : 'B',
            ...(workspaceScoped ? { workspaceId: sameWs ? 'w1' : 'w2' } : {}),
            ownerId: own ? actor.userId : 'someone-else',
          }
          const seesWorkspace = role === 'owner' || role === 'admin' || sameWs || !workspaceScoped
          const allowedByCell = cell === true || (cell === 'own' && own)
          cases.push({
            role,
            permission,
            own,
            sameWs,
            sameOrg,
            actor,
            resource,
            expected: sameOrg && seesWorkspace && allowedByCell,
          })
        }
      }
    }
  }
}

describe('matrix §10.2', () => {
  test.each(cases)(
    '$role $permission own=$own ws=$sameWs org=$sameOrg → $expected',
    ({ actor, permission, resource, expected }) => {
      expect(can(actor, permission, resource)).toBe(expected)
    },
  )
})

test('owner of org A cannot do anything in org B', () => {
  for (const p of ALL_PERMISSIONS)
    expect(can(ownerOf('A'), p, { organizationId: 'B', workspaceId: 'wB' })).toBe(false)
})

test('workspace permissions need a workspace, for every role', () => {
  for (const p of WORKSPACE_PERMISSIONS) {
    expect(can(ownerOf('A'), p, { organizationId: 'A' })).toBe(false)
    expect(can(memberOf('A', { w1: 'manager' }), p, { organizationId: 'A' })).toBe(false)
  }
})

test('a new draft (no owner yet) is allowed to editors', () => {
  expect(
    can(memberOf('A', { w1: 'editor' }), 'post.draft', { organizationId: 'A', workspaceId: 'w1' }),
  ).toBe(true)
  expect(
    can(memberOf('A', { w1: 'publisher' }), 'post.retry', {
      organizationId: 'A',
      workspaceId: 'w1',
    }),
  ).toBe(false)
})

test('platform admin has platform permissions only', () => {
  expect(canPlatform({ userId: 'p', platformRole: 'admin' }, 'platform.organizations.manage')).toBe(
    true,
  )
  expect(canPlatform({ userId: 'p', platformRole: 'admin' }, 'platform.users.manage')).toBe(true)
  expect(canPlatform({ userId: 'u', platformRole: null }, 'platform.users.manage')).toBe(false)
  expect(canPlatform({ userId: 'p', platformRole: 'admin' }, 'platform.integrations.manage')).toBe(
    true,
  )
  expect(canPlatform({ userId: 'u', platformRole: null }, 'platform.integrations.manage')).toBe(
    false,
  )
})

test('platform admin role adds nothing inside an organization', () => {
  const member = { ...memberOf('A', {}), platformRole: 'admin' as const }
  expect(can(member, 'users.manage', { organizationId: 'A' })).toBe(false)
  expect(can(member, 'workspace.view', { organizationId: 'A', workspaceId: 'w1' })).toBe(false)
})

describe('acting on other users', () => {
  test('admin cannot act on owner or other admins', () => {
    expect(
      can(adminOf('A'), 'users.manage', {
        organizationId: 'A',
        targetUser: { id: 'o', orgRole: 'owner' },
      }),
    ).toBe(false)
    expect(
      can(adminOf('A'), 'users.manage', {
        organizationId: 'A',
        targetUser: { id: 'a2', orgRole: 'admin' },
      }),
    ).toBe(false)
    expect(can(adminOf('A'), 'users.manage', { organizationId: 'A', targetUser: m1 })).toBe(true)
  })
  test('admin cannot change the workspace role of an owner or admin either', () => {
    const resource = { organizationId: 'A', workspaceId: 'w1', assignRole: 'viewer' as const }
    expect(
      can(adminOf('A'), 'workspace.members.manage', {
        ...resource,
        targetUser: { id: 'a2', orgRole: 'admin' },
      }),
    ).toBe(false)
    expect(can(adminOf('A'), 'workspace.members.manage', { ...resource, targetUser: m1 })).toBe(
      true,
    )
  })
  test('nobody acts on the owner', () => {
    const owner = { id: 'o', orgRole: 'owner' as const }
    expect(can(ownerOf('A'), 'users.manage', { organizationId: 'A', targetUser: owner })).toBe(
      false,
    )
  })
  test('only owner can assign admin', () => {
    expect(
      can(ownerOf('A'), 'users.manage', {
        organizationId: 'A',
        targetUser: m1,
        assignRole: 'admin',
      }),
    ).toBe(true)
    expect(
      can(adminOf('A'), 'users.manage', {
        organizationId: 'A',
        targetUser: m1,
        assignRole: 'admin',
      }),
    ).toBe(false)
  })
  test('owner is never assigned', () => {
    expect(
      can(ownerOf('A'), 'users.manage', {
        organizationId: 'A',
        targetUser: m1,
        assignRole: 'owner',
      }),
    ).toBe(false)
  })
  test('organization roles are not workspace roles', () => {
    const resource = { organizationId: 'A', workspaceId: 'w1', targetUser: m1 }
    expect(
      can(ownerOf('A'), 'workspace.members.manage', { ...resource, assignRole: 'admin' }),
    ).toBe(false)
    expect(
      can(ownerOf('A'), 'workspace.members.manage', { ...resource, assignRole: 'manager' }),
    ).toBe(true)
    expect(
      can(ownerOf('A'), 'users.manage', {
        organizationId: 'A',
        targetUser: m1,
        assignRole: 'manager',
      }),
    ).toBe(false)
  })
  test('manager can only assign lower roles and never to self', () => {
    const mgr = memberOf('A', { w1: 'manager' })
    expect(assignableWorkspaceRoles(mgr, 'w1')).toEqual(['publisher', 'editor', 'viewer'])
    const base = { organizationId: 'A', workspaceId: 'w1' }
    expect(
      can(mgr, 'workspace.members.manage', {
        ...base,
        targetUser: { id: 'x', orgRole: 'member', workspaceRole: 'manager' },
        assignRole: 'viewer',
      }),
    ).toBe(false)
    expect(
      can(mgr, 'workspace.members.manage', {
        ...base,
        targetUser: { id: mgr.userId, orgRole: 'member' },
        assignRole: 'publisher',
      }),
    ).toBe(false)
    expect(
      can(mgr, 'workspace.members.manage', {
        organizationId: 'A',
        workspaceId: 'w2',
        targetUser: m1,
        assignRole: 'viewer',
      }),
    ).toBe(false)
    expect(
      can(mgr, 'workspace.members.manage', { ...base, targetUser: m1, assignRole: 'manager' }),
    ).toBe(false)
    expect(
      can(mgr, 'workspace.members.manage', {
        ...base,
        targetUser: { id: 'x', orgRole: 'admin' },
        assignRole: 'viewer',
      }),
    ).toBe(false)
    expect(
      can(mgr, 'workspace.members.manage', {
        ...base,
        targetUser: { ...m1, workspaceRole: 'editor' },
        assignRole: 'publisher',
      }),
    ).toBe(true)
  })
})

test('admin has read-only organization settings', () => {
  expect(can(adminOf('A'), 'organization.settings.view', { organizationId: 'A' })).toBe(true)
  expect(can(adminOf('A'), 'organization.settings.manage', { organizationId: 'A' })).toBe(false)
})

test('owner and admin see every workspace, members do not', () => {
  expect(seesAllWorkspaces(ownerOf('A'))).toBe(true)
  expect(seesAllWorkspaces(adminOf('A'))).toBe(true)
  expect(seesAllWorkspaces(memberOf('A', { w1: 'manager' }))).toBe(false)
})

test('assignable workspace roles', () => {
  expect(assignableWorkspaceRoles(ownerOf('A'), 'w1')).toEqual([
    'manager',
    'publisher',
    'editor',
    'viewer',
  ])
  expect(assignableWorkspaceRoles(adminOf('A'), 'w1')).toEqual([
    'manager',
    'publisher',
    'editor',
    'viewer',
  ])
  expect(assignableWorkspaceRoles(memberOf('A', { w1: 'manager' }), 'w2')).toEqual([])
  expect(assignableWorkspaceRoles(memberOf('A', { w1: 'publisher' }), 'w1')).toEqual([])
})
