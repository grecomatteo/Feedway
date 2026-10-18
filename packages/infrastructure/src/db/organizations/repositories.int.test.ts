import { createHash, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Logger, UnitOfWork } from '@app/application'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, waitForLockWaiter, withScope } from '../../testing/index.js'
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
const now = new Date('2026-10-18T10:00:00Z')
const APP = 'org-repos-test'

let orgA: string, orgB: string, suspended: string
let ownerA: string, memberA: string, userInAandB: string, onlyInB: string, disabledInB: string

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 4, applicationName: APP })
  uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger: silent })
  await seed(tdb.runtimeUrl, async (s) => {
    orgA = await s.organization()
    orgB = await s.organization()
    suspended = await s.organization({ status: 'suspended' })
    ownerA = await s.user()
    memberA = await s.user()
    userInAandB = await s.user()
    onlyInB = await s.user()
    disabledInB = await s.user()
    await s.member(orgA, ownerA, 'owner')
    await s.member(orgA, memberA, 'member')
    await s.member(orgA, userInAandB, 'admin')
    await s.member(orgB, userInAandB, 'member')
    await s.member(orgB, onlyInB, 'owner')
    await s.member(orgB, disabledInB, 'member', 'disabled')
    await s.member(suspended, memberA, 'member')
  })
})
afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

const hashOf = (token: string) => createHash('sha256').update(token).digest()
async function seedInvite(opts: { token: string; expiresAt?: Date; usedAt?: Date | null }) {
  const id = randomUUID()
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query(
      `insert into invites (id, organization_id, purpose, email, token_hash, org_role, expires_at, used_at)
       values ($1, $2, 'invite', 'nuovo@example.test', $3, 'member', $4, $5)`,
      [
        id,
        orgA,
        hashOf(opts.token),
        opts.expiresAt ?? new Date('2026-10-25T10:00:00Z'),
        opts.usedAt ?? null,
      ],
    ),
  )
  return id
}

test('listForUser shows every agency of the user from a user-only scope', async () => {
  const list = await uow.run({ userId: memberA }, (tx) => tx.orgMembers.listForUser(memberA))
  expect(list.map((m) => m.organizationId).sort()).toEqual([orgA, suspended].sort())
  expect(list.find((m) => m.organizationId === suspended)).toMatchObject({
    role: 'member',
    status: 'active',
    organizationStatus: 'suspended',
  })
  expect(list[0]?.slug).toBeTruthy()
})

test('listForUser cannot read another user memberships', async () => {
  expect(await uow.run({ userId: memberA }, (tx) => tx.orgMembers.listForUser(onlyInB))).toEqual([])
})

test('find sees members of the current agency only', async () => {
  const scope = { organizationId: orgA, userId: ownerA }
  expect(await uow.run(scope, (tx) => tx.orgMembers.find(orgA, memberA))).toEqual({
    organizationId: orgA,
    userId: memberA,
    role: 'member',
    status: 'active',
  })
  expect(await uow.run(scope, (tx) => tx.orgMembers.find(orgB, onlyInB))).toBeNull()
})

test('organizationCount counts every membership, disabled ones included', async () => {
  const scope = { organizationId: orgA, userId: ownerA }
  expect(await uow.run(scope, (tx) => tx.orgMembers.organizationCount(userInAandB))).toBe(2)
  expect(await uow.run(scope, (tx) => tx.orgMembers.organizationCount(disabledInB))).toBe(1)
  expect(await uow.run(scope, (tx) => tx.orgMembers.organizationCount(randomUUID()))).toBe(0)
})

test('colleagues are recognised across agencies from a user-only scope', async () => {
  const shares = (a: string, b: string) =>
    uow.run({ userId: a }, (tx) => tx.users.sharesOrganization(a, b))
  expect(await shares(memberA, userInAandB)).toBe(true)
  expect(await shares(memberA, onlyInB)).toBe(false)
  // a disabled membership does not count
  expect(await shares(onlyInB, disabledInB)).toBe(false)
})

test('organizations.findById reads the current agency and nothing else', async () => {
  const scope = { organizationId: orgA, userId: ownerA }
  expect(await uow.run(scope, (tx) => tx.organizations.findById(orgA))).toMatchObject({
    id: orgA,
    status: 'active',
    limits: {},
    settings: {},
  })
  expect(await uow.run(scope, (tx) => tx.organizations.findById(orgB))).toBeNull()
})

test('inside one agency, another agency of the same user stays hidden', async () => {
  // RLS lists every agency of the user (switcher); the repository narrows to the current one
  const scope = { organizationId: orgA, userId: userInAandB }
  expect(await uow.run(scope, (tx) => tx.organizations.findById(orgB))).toBeNull()
  const fromUserScope = await uow.run({ userId: userInAandB }, (tx) =>
    tx.organizations.findById(orgB),
  )
  expect(fromUserScope?.id).toBe(orgB)
})

test('lockForActivation ignores used, expired and unknown invites', async () => {
  await seedInvite({ token: 'used', usedAt: now })
  await seedInvite({ token: 'expired', expiresAt: now })
  const lock = (token: string) =>
    uow.runAsSystem('test', (tx) => tx.invites.lockForActivation(hashOf(token), now))
  expect(await lock('used')).toBeNull()
  expect(await lock('expired')).toBeNull()
  expect(await lock('unknown')).toBeNull()
})

test('invite row is locked: concurrent activation waits and then finds it used', async () => {
  const id = await seedInvite({ token: 'race' })
  let release!: () => void
  const released = new Promise<void>((r) => (release = r))
  let locked!: () => void
  const lockTaken = new Promise<void>((r) => (locked = r))
  const first = uow.runAsSystem('test', async (tx) => {
    const invite = await tx.invites.lockForActivation(hashOf('race'), now)
    locked()
    await released
    return { invite, used: invite ? await tx.invites.markUsed(invite.id, now) : false }
  })
  await lockTaken
  const second = uow.runAsSystem('test', (tx) => tx.invites.lockForActivation(hashOf('race'), now))
  // the second activation is blocked on the row before the first one commits
  await waitForLockWaiter(tdb.adminUrl, APP)
  release()
  expect(await first).toMatchObject({
    invite: { id, purpose: 'invite', orgRole: 'member', memberships: [] },
    used: true,
  })
  expect(await second).toBeNull()
  expect(await uow.runAsSystem('test', (tx) => tx.invites.markUsed(id, now))).toBe(false)
})

test('reserveUserId keeps the id for a retried activation and never touches a used invite', async () => {
  const open = await seedInvite({ token: 'reserve' })
  const used = await seedInvite({ token: 'reserve-used', usedAt: now })
  const reserved = randomUUID()
  await uow.runAsSystem('test', async (tx) => {
    await tx.invites.reserveUserId(open, reserved)
    await tx.invites.reserveUserId(used, reserved)
  })
  const again = await uow.runAsSystem('test', (tx) =>
    tx.invites.lockForActivation(hashOf('reserve'), now),
  )
  expect(again?.reservedUserId).toBe(reserved)
  // a second reservation never replaces the first
  await uow.runAsSystem('test', (tx) => tx.invites.reserveUserId(open, randomUUID()))
  const still = await uow.runAsSystem('test', (tx) =>
    tx.invites.lockForActivation(hashOf('reserve'), now),
  )
  expect(still?.reservedUserId).toBe(reserved)
  const { rows } = await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query<{ reserved_user_id: string | null }>(
      'select reserved_user_id from invites where id = $1',
      [used],
    ),
  )
  expect(rows[0]?.reserved_user_id).toBeNull()
})

test('an agency cannot lock another agency invite', async () => {
  await seedInvite({ token: 'of-a' })
  const fromB = await uow.run({ organizationId: orgB, userId: onlyInB }, (tx) =>
    tx.invites.lockForActivation(hashOf('of-a'), now),
  )
  expect(fromB).toBeNull()
})
