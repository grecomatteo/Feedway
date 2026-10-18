import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Logger, UnitOfWork } from '@app/application'
import type { OrgActor, OrgRole, WorkspaceRole } from '@app/domain'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'
import { createDb } from '../client.js'
import type { DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'

let tdb: TestDatabase
let handle: DbHandle
let uow: UnitOfWork
const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
}

let orgA: string, orgB: string, ownerA: string, adminA: string, memberA: string
let w1: string, w2: string, archived: string, workspaceOfB: string

const actor = (
  organizationId: string,
  userId: string,
  orgRole: OrgRole,
  memberships: [string, WorkspaceRole][] = [],
): OrgActor => ({
  userId,
  platformRole: null,
  organizationId,
  orgRole,
  memberships: new Map(memberships),
})
const inA = (userId: string) => ({ organizationId: orgA, userId })

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'ws-repos-test' })
  uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger: silent })
  await seed(tdb.runtimeUrl, async (s) => {
    orgA = await s.organization()
    orgB = await s.organization()
    ownerA = await s.user()
    adminA = await s.user()
    memberA = await s.user()
    await s.member(orgA, ownerA, 'owner')
    await s.member(orgA, adminA, 'admin')
    await s.member(orgA, memberA, 'member')
    w1 = await s.workspace(orgA, { name: 'Alfa' })
    w2 = await s.workspace(orgA, { name: 'Beta' })
    archived = await s.workspace(orgA, { name: 'Gamma', archived: true })
    workspaceOfB = await s.workspace(orgB)
    await s.workspaceMember(orgA, w1, memberA, 'editor')
  })
})
afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

test('member only sees own workspaces; org admin sees all of own org', async () => {
  const member = actor(orgA, memberA, 'member', [[w1, 'editor']])
  const listed = await uow.run(inA(memberA), (tx) => tx.workspaces.listVisible(member))
  expect(listed.map((w) => w.id)).toEqual([w1])

  const admin = actor(orgA, adminA, 'admin')
  const all = await uow.run(inA(adminA), (tx) => tx.workspaces.listVisible(admin))
  expect(all.map((w) => w.id)).toEqual([w1, w2, archived])
  expect(all.every((w) => w.organizationId === orgA)).toBe(true)
  expect(all.find((w) => w.id === archived)?.archivedAt).toBeInstanceOf(Date)
})

test('a member with no workspace sees none', async () => {
  const lonely = actor(orgA, memberA, 'member')
  expect(await uow.run(inA(memberA), (tx) => tx.workspaces.listVisible(lonely))).toEqual([])
  expect(await uow.run(inA(memberA), (tx) => tx.workspaces.findVisibleById(lonely, w1))).toBeNull()
})

test('findVisibleById hides workspaces the actor may not see', async () => {
  const member = actor(orgA, memberA, 'member', [[w1, 'editor']])
  const owner = actor(orgA, ownerA, 'owner')
  expect((await uow.run(inA(memberA), (tx) => tx.workspaces.findVisibleById(member, w1)))?.id).toBe(
    w1,
  )
  expect(await uow.run(inA(memberA), (tx) => tx.workspaces.findVisibleById(member, w2))).toBeNull()
  expect(
    await uow.run(inA(ownerA), (tx) => tx.workspaces.findVisibleById(owner, workspaceOfB)),
  ).toBeNull()
})

test('an actor of another agency gets nothing even inside that agency scope', async () => {
  // the SQL filter uses the actor's agency: a mismatched actor and scope return no rows
  const ownerOfB = actor(orgB, ownerA, 'owner')
  expect(await uow.run(inA(ownerA), (tx) => tx.workspaces.listVisible(ownerOfB))).toEqual([])
})

test('countActive skips archived workspaces', async () => {
  expect(await uow.run(inA(ownerA), (tx) => tx.workspaces.countActive(orgA))).toBe(2)
  expect(await uow.run(inA(ownerA), (tx) => tx.workspaces.countActive(orgB))).toBe(0)
})

test('rolesOf returns the workspace roles of the user in the agency', async () => {
  const roles = await uow.run(inA(memberA), (tx) => tx.workspaceMembers.rolesOf(orgA, memberA))
  expect([...roles]).toEqual([[w1, 'editor']])
  expect(
    (await uow.run(inA(memberA), (tx) => tx.workspaceMembers.rolesOf(orgB, memberA))).size,
  ).toBe(0)
})
