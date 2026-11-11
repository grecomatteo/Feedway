import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  assignAccount,
  listAccounts,
  listProfiles,
  unassignAccount,
  type ImportedAccountInput,
  type SocialAccountRecord,
  type Tx,
} from '@app/application'
import type { OrgActor } from '@app/domain'
import { createKeyRing } from '../../crypto/key-ring.js'
import { createLogger } from '../../logging/logger.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { fixedClock, seed, startTestDatabase } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'
import { createDb } from '../client.js'
import type { DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'
import { createConnectionTokens } from './connection-tokens.js'

// «Account social» and the profiles of a workspace (plan 03 Task 9). Other agencies and the
// roles route by route are in the HTTP isolation battery and the matrix, not here.

let tdb: TestDatabase
let handle: DbHandle
let deps: { uow: ReturnType<typeof createUnitOfWork> }
let org: string, ws1: string, ws2: string, archived: string
let owner: OrgActor, viewer: OrgActor
let connectionId: string
const keyRing = createKeyRing({ platformKey: randomBytes(32), clock: fixedClock(new Date()) })
const tokens = createConnectionTokens({ keyRing })
const logger = createLogger({ service: 'web', level: 'error' })
const IP = { ip: '203.0.113.9' }
let serial = 0

const actor = (userId: string, orgRole: OrgActor['orgRole']): OrgActor => ({
  userId,
  platformRole: null,
  organizationId: org,
  orgRole,
  memberships: new Map(),
})

const inOrg = <T>(fn: (tx: Tx) => Promise<T>) =>
  deps.uow.run({ organizationId: org, userId: owner.userId }, fn)

/** An imported account of the agency's connection, active unless said otherwise. */
async function account(
  over: Partial<ImportedAccountInput> & { inactive?: boolean } = {},
): Promise<SocialAccountRecord> {
  serial += 1
  const { inactive, ...input } = over
  return inOrg(async (tx) => {
    const created = await tx.accounts.upsertImported({
      organizationId: org,
      platform: 'instagram',
      externalId: `1784140000${String(serial).padStart(5, '0')}`,
      name: `Account ${String(serial)}`,
      username: null,
      avatarUrl: null,
      pageId: null,
      connectionId,
      at: new Date(),
      ...input,
    })
    if (inactive) await tx.accounts.markInactive(org, connectionId, [created.id])
    return { ...created, active: !inactive }
  })
}

const assign = (who: OrgActor, workspaceId: string, accountId: string) =>
  assignAccount(deps, who, { workspaceId, accountId }, IP)

const auditOf = (accountId: string) =>
  inOrg(async (tx) =>
    (await tx.audit.listForOrganization({ organizationId: org, limit: 100 }))
      .filter((r) => r.entityId === accountId)
      .map((r) => ({ action: r.action, workspaceId: r.workspaceId, data: r.data })),
  )

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 4, applicationName: 'test' })
  deps = { uow: createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger }) }
  const ids = await seed(tdb.runtimeUrl, async (s) => {
    const o = await s.organization()
    const ownerId = await s.user()
    const viewerId = await s.user()
    await s.member(o, ownerId, 'owner')
    await s.member(o, viewerId, 'member')
    const w1 = await s.workspace(o)
    const w2 = await s.workspace(o)
    const wa = await s.workspace(o, { archived: true })
    await s.workspaceMember(o, w1, viewerId, 'viewer')
    return { o, ownerId, viewerId, w1, w2, wa }
  })
  ;({ o: org, w1: ws1, w2: ws2, wa: archived } = ids)
  owner = actor(ids.ownerId, 'owner')
  viewer = actor(ids.viewerId, 'member')
  connectionId = await inOrg(async (tx) => {
    await keyRing.createOrganizationKey(tx, org)
    const id = uuidV7Generator.newId()
    const sealed = await tokens.seal(tx, { organizationId: org, id }, `EAA-token-${id}`)
    await tx.connections.create({
      id,
      organizationId: org,
      kind: 'meta_system_user',
      externalUserId: `su-${id}`,
      connectedBy: owner.userId,
      ...sealed,
      expiresAt: null,
    })
    return id
  })
}, 120_000)
afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

test('Owner sees every account with its connection, a Member only those of their workspaces', async () => {
  const inBoth = await account()
  const elsewhere = await account()
  const unassigned = await account()
  await assign(owner, ws1, inBoth.id)
  await assign(owner, ws2, inBoth.id)
  await assign(owner, ws2, elsewhere.id)

  const all = await listAccounts(deps, owner, {})
  const mine = all.items.filter((a) => [inBoth.id, elsewhere.id, unassigned.id].includes(a.id))
  expect(mine.map((a) => a.id)).toEqual([inBoth.id, elsewhere.id, unassigned.id])
  expect(mine[0]).toMatchObject({
    workspaceIds: [ws1, ws2].sort(),
    connection: { id: connectionId, kind: 'meta_system_user', status: 'pending' },
    selectable: false,
  })
  expect(mine[2]?.workspaceIds).toEqual([])

  // the Viewer of ws1: the account of ws1 only, and only ws1 among its workspaces
  const seen = await listAccounts(deps, viewer, {})
  expect(seen.items.map((a) => a.id)).toEqual([inBoth.id])
  expect(seen.items[0]).toMatchObject({ workspaceIds: [ws1], connection: null })
  expect(JSON.stringify(seen)).not.toContain(connectionId)
})

test('the list comes a page at a time, the cursor on the id', async () => {
  // ids grow with time: the accounts after this one are the three made here
  const anchor = await account()
  const made = [await account(), await account(), await account()].map((a) => a.id)
  const first = await listAccounts(deps, owner, { cursor: anchor.id, limit: 2 })
  expect(first.items.map((a) => a.id)).toEqual(made.slice(0, 2))
  expect(first.nextCursor).toBe(made[1])
  const rest = await listAccounts(deps, owner, { cursor: first.nextCursor ?? '', limit: 10 })
  expect(rest.items.map((a) => a.id)).toEqual(made.slice(2))
  expect(rest.nextCursor).toBeNull()
  await expect(listAccounts(deps, owner, { cursor: 'non-un-id' })).rejects.toMatchObject({
    code: 'VALIDATION',
  })
  await expect(listAccounts(deps, owner, { limit: 101 })).rejects.toMatchObject({
    code: 'VALIDATION',
  })
})

test('assigning and taking out are recorded once; a repeat records nothing', async () => {
  const a = await account()
  await assign(owner, ws1, a.id)
  await assign(owner, ws1, a.id)
  await unassignAccount(deps, owner, { workspaceId: ws1, accountId: a.id }, IP)
  await unassignAccount(deps, owner, { workspaceId: ws1, accountId: a.id }, IP)
  expect(await auditOf(a.id)).toEqual([
    { action: 'account.unassigned', workspaceId: ws1, data: {} },
    { action: 'account.assigned', workspaceId: ws1, data: {} },
  ])
  expect(await inOrg((tx) => tx.workspaceAccounts.listForWorkspace(org, ws1))).not.toContain(a.id)
})

test('an inactive account is not assigned, nor is any account to an archived workspace', async () => {
  const gone = await account({ inactive: true })
  await expect(assign(owner, ws1, gone.id)).rejects.toMatchObject({ code: 'CONFLICT' })
  const a = await account()
  await expect(assign(owner, archived, a.id)).rejects.toMatchObject({ code: 'CONFLICT' })
  expect(await auditOf(gone.id)).toEqual([])
  expect(await auditOf(a.id)).toEqual([])
})

test('the profiles of a workspace pair only its own active accounts', async () => {
  const ws = await seed(tdb.runtimeUrl, (s) => s.workspace(org))
  const page = await account({
    platform: 'facebook',
    externalId: '100000000000777',
    pageId: '100000000000777',
  })
  const ig = await account({ name: 'Forno Luce', pageId: '100000000000777' })
  // the Instagram of a page that is not in the workspace
  const lone = await account({ pageId: '100000000000888' })
  await account({ platform: 'facebook', externalId: '100000000000888', pageId: '100000000000888' })
  const inactive = await account({ inactive: true })
  for (const a of [page, ig, lone]) await assign(owner, ws, a.id)
  await inOrg((tx) => tx.workspaceAccounts.assign(org, ws, inactive.id))

  const profiles = await listProfiles(deps, owner, { workspaceId: ws })
  expect(
    profiles.map((p) => ({ key: p.key, id: p.id, accounts: p.accounts.map((a) => a.id) })),
  ).toEqual(
    expect.arrayContaining([
      { key: 'page:100000000000777', id: ig.id, accounts: [ig.id, page.id] },
      { key: 'page:100000000000888', id: lone.id, accounts: [lone.id] },
    ]),
  )
  expect(profiles).toHaveLength(2)
  // a workspace the Viewer has no role in is not found
  await expect(listProfiles(deps, viewer, { workspaceId: ws })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  })
})
