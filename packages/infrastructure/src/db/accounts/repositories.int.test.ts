import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { ImportedAccountInput, Tx } from '@app/application'
import { createKeyRing } from '../../crypto/key-ring.js'
import { createLogger } from '../../logging/logger.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { fixedClock, seed, startTestDatabase, withScope } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'
import { createDb } from '../client.js'
import type { DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'
import { createConnectionTokens } from './connection-tokens.js'

// The accounts module's data (plan 03, Task 5). Isolation by row level security is in
// rls.int.test.ts; here the repositories and the constraints that keep agencies apart.

let tdb: TestDatabase
let handle: DbHandle
let uow: ReturnType<typeof createUnitOfWork>
let orgA: string, orgB: string, ownerA: string, ownerB: string, memberA: string
let wsA1: string, wsA2: string, wsB: string
const keyRing = createKeyRing({ platformKey: randomBytes(32), clock: fixedClock(new Date()) })
const tokens = createConnectionTokens({ keyRing })
const logger = createLogger({ service: 'worker', level: 'error' })
const newId = () => uuidV7Generator.newId()
const now = new Date('2026-11-10T12:00:00.000Z')
// drizzle wraps the driver error: the constraint is on its cause
const refusedBy = (constraint: string) => ({ cause: { constraint } })

const inA = <T>(fn: (tx: Tx) => Promise<T>) => uow.run({ organizationId: orgA, userId: ownerA }, fn)
const inB = <T>(fn: (tx: Tx) => Promise<T>) => uow.run({ organizationId: orgB, userId: ownerB }, fn)

async function connection(
  tx: Tx,
  organizationId: string,
  over: { externalUserId?: string; expiresAt?: Date | null } = {},
) {
  const id = newId()
  const sealed = await tokens.seal(tx, { organizationId, id }, `EAA-token-${id}`)
  return tx.connections.create({
    id,
    organizationId,
    kind: 'meta_system_user',
    externalUserId: over.externalUserId ?? `su-${id}`,
    connectedBy: organizationId === orgA ? ownerA : ownerB,
    ...sealed,
    expiresAt: over.expiresAt ?? null,
  })
}

const imported = (
  organizationId: string,
  connectionId: string,
  over: Partial<ImportedAccountInput> = {},
): ImportedAccountInput => ({
  organizationId,
  platform: 'instagram',
  externalId: '17841400000000001',
  name: 'Forno Luce',
  username: 'fornoluce',
  avatarUrl: null,
  pageId: '100000000000001',
  connectionId,
  at: now,
  ...over,
})

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 4, applicationName: 'test' })
  uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger })
  ;({ orgA, orgB, ownerA, ownerB, memberA, wsA1, wsA2, wsB } = await seed(
    tdb.runtimeUrl,
    async (s) => {
      const a = await s.organization()
      const b = await s.organization()
      const oa = await s.user()
      const ob = await s.user()
      const ma = await s.user()
      await s.member(a, oa, 'owner')
      await s.member(a, ma, 'member')
      await s.member(b, ob, 'owner')
      return {
        orgA: a,
        orgB: b,
        ownerA: oa,
        ownerB: ob,
        memberA: ma,
        wsA1: await s.workspace(a),
        wsA2: await s.workspace(a),
        wsB: await s.workspace(b),
      }
    },
  ))
  await inA((tx) => keyRing.createOrganizationKey(tx, orgA))
  await inB((tx) => keyRing.createOrganizationKey(tx, orgB))
}, 120_000)
afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

test('a new connection is pending, and its token opens only on its own row', async () => {
  const { conn, other } = await inA(async (tx) => ({
    conn: await connection(tx, orgA),
    other: await connection(tx, orgA),
  }))
  expect(conn.status).toBe('pending')
  expect(conn).not.toHaveProperty('tokenEnc')
  const stored = await inA((tx) => tx.connections.findWithToken(orgA, conn.id))
  if (!stored) throw new Error('missing')
  expect(stored.tokenEnc).toMatch(/^v1\.1\./)
  expect(stored.keyVersion).toBe(1)
  expect(await inA((tx) => tokens.open(tx, stored))).toBe(`EAA-token-${conn.id}`)
  // copied to another connection of the same agency, or to another agency: it does not open
  await expect(inA((tx) => tokens.open(tx, { ...stored, id: other.id }))).rejects.toThrow()
  await expect(inB((tx) => tokens.open(tx, { ...stored, organizationId: orgB }))).rejects.toThrow()
})

test('the same platform user twice in one agency is refused, in two agencies it is not', async () => {
  await inA((tx) => connection(tx, orgA, { externalUserId: 'su-shared' }))
  await expect(
    inA((tx) => connection(tx, orgA, { externalUserId: 'su-shared' })),
  ).rejects.toMatchObject(refusedBy('account_connections_external_user'))
  await expect(
    inB((tx) => connection(tx, orgB, { externalUserId: 'su-shared' })),
  ).resolves.toBeDefined()
  const found = await inA((tx) =>
    tx.connections.findByExternalUser(orgA, 'meta_system_user', 'su-shared'),
  )
  expect(found?.organizationId).toBe(orgA)
})

test('a new token replaces the old one, with its expiry and status', async () => {
  const conn = await inA((tx) => connection(tx, orgA, { expiresAt: now }))
  const later = new Date(now.getTime() + 60 * 86_400_000)
  const changed = await inA(async (tx) => {
    const sealed = await tokens.seal(tx, conn, 'EAA-nuovo')
    return tx.connections.replaceToken(orgA, conn.id, {
      ...sealed,
      expiresAt: later,
      status: 'active',
      at: now,
    })
  })
  expect(changed).toBe(true)
  const stored = await inA((tx) => tx.connections.findWithToken(orgA, conn.id, { forUpdate: true }))
  if (!stored) throw new Error('missing')
  expect(stored).toMatchObject({ status: 'active', expiresAt: later, lastRefreshedAt: now })
  expect(await inA((tx) => tokens.open(tx, stored))).toBe('EAA-nuovo')
  // another agency changes nothing, even knowing the id
  expect(await inB((tx) => tx.connections.setStatus(orgA, conn.id, 'revoked'))).toBe(false)
  expect(await inB((tx) => tx.connections.findById(orgA, conn.id))).toBeNull()
})

test('the same account is imported by two agencies, once in each', async () => {
  const a = await inA(async (tx) => {
    const conn = await connection(tx, orgA)
    return tx.accounts.upsertImported(imported(orgA, conn.id, { externalId: 'ig-shared' }))
  })
  const b = await inB(async (tx) => {
    const conn = await connection(tx, orgB)
    return tx.accounts.upsertImported(imported(orgB, conn.id, { externalId: 'ig-shared' }))
  })
  expect(a.id).not.toBe(b.id)
  expect(
    (await inA((tx) => tx.accounts.list(orgA))).filter((x) => x.externalId === 'ig-shared'),
  ).toHaveLength(1)
  expect(a).toMatchObject({ active: true, health: null, lastSyncedAt: now })
})

test('importing again updates the account, moves the owner and makes it active again', async () => {
  const { first, second } = await inA(async (tx) => ({
    first: await connection(tx, orgA),
    second: await connection(tx, orgA),
  }))
  const account = await inA((tx) =>
    tx.accounts.upsertImported(imported(orgA, first.id, { externalId: 'ig-again' })),
  )
  expect(await inA((tx) => tx.accounts.markInactive(orgA, first.id, [account.id]))).toBe(1)
  // already inactive: nothing changes
  expect(await inA((tx) => tx.accounts.markInactive(orgA, first.id, [account.id]))).toBe(0)
  // the old owner cannot close it once another connection has taken it
  await inA((tx) =>
    tx.accounts.upsertImported(imported(orgA, second.id, { externalId: 'ig-again' })),
  )
  expect(await inA((tx) => tx.accounts.markInactive(orgA, first.id, [account.id]))).toBe(0)
  const again = await inA((tx) =>
    tx.accounts.upsertImported(
      imported(orgA, second.id, { externalId: 'ig-again', name: 'Forno Luce Bio' }),
    ),
  )
  expect(again).toMatchObject({
    id: account.id,
    name: 'Forno Luce Bio',
    connectionId: second.id,
    active: true,
  })
  const found = await inA((tx) => tx.accounts.findByExternalIds(orgA, 'instagram', ['ig-again']))
  expect(found.map((x) => x.id)).toEqual([account.id])
  expect(await inA((tx) => tx.accounts.findByExternalIds(orgA, 'facebook', ['ig-again']))).toEqual(
    [],
  )
})

test('an account cannot point at a connection of another agency', async () => {
  const connB = await inB((tx) => connection(tx, orgB))
  await expect(
    inA((tx) => tx.accounts.upsertImported(imported(orgA, connB.id, { externalId: 'ig-x' }))),
  ).rejects.toMatchObject(refusedBy('social_accounts_connection_fk'))
})

test('a Facebook Page is its own profile key', async () => {
  const conn = await inA((tx) => connection(tx, orgA))
  for (const pageId of ['p2', null]) {
    await expect(
      inA((tx) =>
        tx.accounts.upsertImported(
          imported(orgA, conn.id, { platform: 'facebook', externalId: 'p1', pageId }),
        ),
      ),
    ).rejects.toMatchObject(refusedBy('social_accounts_facebook_page'))
  }
})

test('workspaces list their accounts; the composite key refuses an account of another agency', async () => {
  const { accountA, accountA2 } = await inA(async (tx) => {
    const conn = await connection(tx, orgA)
    return {
      accountA: await tx.accounts.upsertImported(imported(orgA, conn.id, { externalId: 'ig-ws1' })),
      accountA2: await tx.accounts.upsertImported(
        imported(orgA, conn.id, { externalId: 'ig-ws2', name: 'Altro' }),
      ),
    }
  })
  const accountB = await inB(async (tx) => {
    const conn = await connection(tx, orgB)
    return tx.accounts.upsertImported(imported(orgB, conn.id, { externalId: 'ig-wsb' }))
  })

  expect(await inA((tx) => tx.workspaceAccounts.assign(orgA, wsA1, accountA.id))).toBe(true)
  expect(await inA((tx) => tx.workspaceAccounts.assign(orgA, wsA1, accountA.id))).toBe(false)
  expect(await inA((tx) => tx.workspaceAccounts.assign(orgA, wsA2, accountA.id))).toBe(true)
  expect(await inA((tx) => tx.workspaceAccounts.assign(orgA, wsA2, accountA2.id))).toBe(true)
  expect(await inA((tx) => tx.workspaceAccounts.listForWorkspace(orgA, wsA1))).toEqual([
    accountA.id,
  ])
  const inWorkspaces = await inA((tx) => tx.accounts.list(orgA, { workspaceIds: [wsA1, wsA2] }))
  expect(inWorkspaces.map((x) => x.id).sort()).toEqual([accountA.id, accountA2.id].sort())
  expect(await inA((tx) => tx.accounts.list(orgA, { workspaceIds: [] }))).toEqual([])

  // an account of B in a workspace of A, and an account of A in a workspace of B: both refused,
  // even in the system scope, where row level security would let them through
  for (const [org, ws, account] of [
    [orgA, wsA1, accountB.id],
    [orgB, wsA1, accountB.id],
    [orgB, wsB, accountA.id],
  ] as const) {
    await expect(
      withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
        c.query(
          'insert into workspace_accounts (organization_id, workspace_id, account_id) values ($1, $2, $3)',
          [org, ws, account],
        ),
      ),
    ).rejects.toThrow(/workspace_accounts_(workspace|account)_fk/)
  }

  expect(await inA((tx) => tx.workspaceAccounts.unassign(orgA, wsA1, accountA.id))).toBe(true)
  expect(await inA((tx) => tx.workspaceAccounts.unassign(orgA, wsA1, accountA.id))).toBe(false)
})

test('the active count follows markInactive, and imports of one agency wait for each other', async () => {
  const before = await inA((tx) => tx.accounts.countActive(orgA))
  const account = await inA(async (tx) => {
    const conn = await connection(tx, orgA)
    return tx.accounts.upsertImported(imported(orgA, conn.id, { externalId: 'ig-count' }))
  })
  expect(await inA((tx) => tx.accounts.countActive(orgA))).toBe(before + 1)
  await inA((tx) => tx.accounts.markInactive(orgA, account.connectionId, [account.id]))
  expect(await inA((tx) => tx.accounts.countActive(orgA))).toBe(before)

  // the second import starts only after the first has committed
  const order: string[] = []
  let releaseFirst!: () => void
  const firstHolds = new Promise<void>((r) => (releaseFirst = r))
  let firstLocked!: () => void
  const locked = new Promise<void>((r) => (firstLocked = r))
  const first = inA(async (tx) => {
    await tx.accounts.lockImport(orgA)
    firstLocked()
    await firstHolds
    order.push('first')
  })
  await locked
  const second = inA(async (tx) => {
    await tx.accounts.lockImport(orgA)
    order.push('second')
  })
  // another agency is not held up
  await inB((tx) => tx.accounts.lockImport(orgB))
  await new Promise((r) => setTimeout(r, 100))
  expect(order).toEqual([])
  releaseFirst()
  await Promise.all([first, second])
  expect(order).toEqual(['first', 'second'])
})

test('a login attempt is used once, by its own person, before it expires', async () => {
  const stateHash = randomBytes(32)
  const expiresAt = new Date(now.getTime() + 10 * 60_000)
  await inA((tx) =>
    tx.connectionAttempts.create({
      id: newId(),
      organizationId: orgA,
      userId: ownerA,
      kind: 'meta_business_login',
      stateHash,
      expiresAt,
    }),
  )
  // another kind, another person, another agency, or too late: refused, and it stays usable
  expect(
    await inA((tx) =>
      tx.connectionAttempts.consume(orgA, 'meta_system_user', stateHash, ownerA, now),
    ),
  ).toBeNull()
  expect(
    await inA((tx) =>
      tx.connectionAttempts.consume(orgA, 'meta_business_login', stateHash, memberA, now),
    ),
  ).toBeNull()
  expect(
    await inB((tx) =>
      tx.connectionAttempts.consume(orgB, 'meta_business_login', stateHash, ownerA, now),
    ),
  ).toBeNull()
  expect(
    await inA((tx) =>
      tx.connectionAttempts.consume(orgA, 'meta_business_login', stateHash, ownerA, expiresAt),
    ),
  ).toBeNull()

  const results = await Promise.all(
    [1, 2].map(() =>
      inA((tx) =>
        tx.connectionAttempts.consume(orgA, 'meta_business_login', stateHash, ownerA, now),
      ),
    ),
  )
  const used = results.filter((r) => r !== null)
  expect(used).toHaveLength(1)
  expect(used[0]).toMatchObject({ userId: ownerA, kind: 'meta_business_login', usedAt: now })
  expect(
    await inA((tx) =>
      tx.connectionAttempts.consume(orgA, 'meta_business_login', stateHash, ownerA, now),
    ),
  ).toBeNull()
})

test('a login attempt belongs to a member of its agency', async () => {
  await expect(
    inA((tx) =>
      tx.connectionAttempts.create({
        id: newId(),
        organizationId: orgA,
        userId: ownerB,
        kind: 'meta_business_login',
        stateHash: randomBytes(32),
        expiresAt: now,
      }),
    ),
  ).rejects.toMatchObject(refusedBy('connection_attempts_member_fk'))
})
