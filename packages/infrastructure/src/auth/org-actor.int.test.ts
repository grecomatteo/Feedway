import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { resolveOrgActor, type UnitOfWork } from '@app/application'
import { createDb } from '../db/client.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createLogger } from '../logging/logger.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { seed, startTestDatabase, type TestDatabase } from '../testing/index.js'

let tdb: TestDatabase
let admin: pg.Client
let deps: { uow: UnitOfWork }

let orgA: string, orgB: string, wsA: string
let memberA: string, userInAandB: string, platformAdminNotInB: string, disabledInA: string

beforeAll(async () => {
  tdb = await startTestDatabase()
  const { db } = createDb(tdb.runtimeUrl, { max: 3, applicationName: 'org-actor-test' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  deps = {
    uow: createUnitOfWork({
      db,
      ids: uuidV7Generator,
      logger: createLogger({ service: 'web', level: 'error' }),
    }),
  }
  await seed(tdb.runtimeUrl, async (s) => {
    orgA = await s.organization()
    orgB = await s.organization()
    wsA = await s.workspace(orgA)
    const wsB = await s.workspace(orgB)
    memberA = await s.user()
    userInAandB = await s.user()
    platformAdminNotInB = await s.user()
    disabledInA = await s.user()
    await s.member(orgA, memberA, 'member')
    await s.workspaceMember(orgA, wsA, memberA, 'editor')
    await s.member(orgA, userInAandB, 'admin')
    await s.member(orgB, userInAandB, 'member')
    await s.workspaceMember(orgB, wsB, userInAandB, 'viewer')
    await s.member(orgA, platformAdminNotInB, 'owner')
    await s.member(orgA, disabledInA, 'member', 'disabled')
  })
  await admin.query("update users set platform_role = 'admin' where id = $1", [platformAdminNotInB])
})
afterAll(async () => {
  await admin.end()
  await tdb.stop()
})

const lastOrganizationOf = async (userId: string) =>
  (
    await admin.query<{ id: string | null }>(
      'select last_organization_id as id from users where id = $1',
      [userId],
    )
  ).rows[0]?.id

test('an active member gets the actor of the agency, with its workspace roles', async () => {
  const actor = await resolveOrgActor(deps, { userId: memberA, organizationSlug: orgA })
  expect(actor).toMatchObject({
    userId: memberA,
    organizationId: orgA,
    orgRole: 'member',
    platformRole: null,
  })
  expect([...actor.memberships]).toEqual([[wsA, 'editor']])
  expect(await lastOrganizationOf(memberA)).toBe(orgA)
})

test('workspace roles of another agency of the same person stay out', async () => {
  const actor = await resolveOrgActor(deps, { userId: userInAandB, organizationSlug: orgA })
  expect(actor.orgRole).toBe('admin')
  expect(actor.memberships.size).toBe(0)
})

test('org actor requires active membership', async () => {
  await expect(
    resolveOrgActor(deps, { userId: memberA, organizationSlug: orgB }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(
    resolveOrgActor(deps, { userId: disabledInA, organizationSlug: orgA }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(
    resolveOrgActor(deps, { userId: memberA, organizationSlug: 'non-esiste' }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect(await lastOrganizationOf(disabledInA)).toBeNull()
})

test('platform admin without membership gets no org actor', async () => {
  await expect(
    resolveOrgActor(deps, { userId: platformAdminNotInB, organizationSlug: orgB }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  const own = await resolveOrgActor(deps, { userId: platformAdminNotInB, organizationSlug: orgA })
  expect(own).toMatchObject({ platformRole: 'admin', orgRole: 'owner' })
})

test('suspended organization blocks its actors only', async () => {
  const suspended = await seed(tdb.runtimeUrl, async (s) => {
    const id = await s.organization({ status: 'suspended' })
    await s.member(id, userInAandB, 'member')
    return id
  })
  await expect(
    resolveOrgActor(deps, { userId: userInAandB, organizationSlug: suspended }),
  ).rejects.toMatchObject({ code: 'ORGANIZATION_SUSPENDED' })
  await expect(
    resolveOrgActor(deps, { userId: userInAandB, organizationSlug: orgB }),
  ).resolves.toMatchObject({ organizationId: orgB })
  expect(await lastOrganizationOf(userInAandB)).toBe(orgB)
})

test('an unknown user gets nothing', async () => {
  await expect(
    resolveOrgActor(deps, { userId: randomUUID(), organizationSlug: orgA }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
})

test('a disabled person gets nothing, even with an active membership', async () => {
  const disabled = await seed(tdb.runtimeUrl, async (s) => {
    const id = await s.user()
    await s.member(orgA, id, 'member')
    return id
  })
  await admin.query("update users set status = 'disabled', disabled_at = now() where id = $1", [
    disabled,
  ])
  await expect(
    resolveOrgActor(deps, { userId: disabled, organizationSlug: orgA }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect(await lastOrganizationOf(disabled)).toBeNull()
})

test('the last agency is written only when it changes', async () => {
  await resolveOrgActor(deps, { userId: memberA, organizationSlug: orgA })
  const rowVersion = async () =>
    (await admin.query<{ v: string }>('select xmin::text as v from users where id = $1', [memberA]))
      .rows[0]?.v
  const before = await rowVersion()
  await resolveOrgActor(deps, { userId: memberA, organizationSlug: orgA })
  expect(await rowVersion()).toBe(before)
})
