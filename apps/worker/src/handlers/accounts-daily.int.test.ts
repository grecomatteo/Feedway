import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Runtime } from '@app/infrastructure'
import { startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { startMetaMock, type MetaMock } from '@app/meta-mock'
import { accountsDaily } from './accounts-daily.js'
import {
  FORNO_LUCE,
  accountsRuntime,
  agency,
  connection,
  handlerDeps,
} from '../../tests/accounts-jobs.js'

// The daily run of the accounts (spec §8.4, plan 03 Task 11) with the real queue: what it
// queues and what it cleans up. The clean-up's own rules are the repositories' tests.

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  runtime = await accountsRuntime(tdb, mock)
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
}, 120_000)

afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 }).catch(() => undefined)
  await runtime.close()
  await admin.end()
  await mock.stop()
  await tdb.stop()
})

const run = () => accountsDaily({ id: 'giro', data: {} }, handlerDeps(runtime))

async function queuedSyncs(): Promise<{ data: Record<string, unknown> }[]> {
  const { rows } = await admin.query<{ data: Record<string, unknown> }>(
    "select data from pgboss.job where name = 'accounts.sync' order by created_on",
  )
  return rows
}

async function connectionIds(organizationId: string): Promise<string[]> {
  const { rows } = await admin.query<{ id: string }>(
    'select id from account_connections where organization_id = $1',
    [organizationId],
  )
  return rows.map((r) => r.id)
}

test('one sync per active connection, even with two runs at once; suspended agencies are skipped', async () => {
  const a = await agency(tdb, runtime)
  const working = await connection(runtime, a, { accounts: FORNO_LUCE })
  await connection(runtime, a, { externalUserId: 'su-expired', status: 'expired' })
  await connection(runtime, a, { externalUserId: 'su-revoked', status: 'revoked' })
  const suspended = await agency(tdb, runtime)
  await connection(runtime, suspended, { accounts: FORNO_LUCE })
  await runtime.uow.runAsSystem('test: suspend', (tx) =>
    tx.organizations.setStatus(suspended.organizationId, 'suspended', new Date()),
  )
  // the suspended agency's expired attempt stays until it is active again
  await runtime.uow.run({ organizationId: suspended.organizationId, userId: null }, (tx) =>
    tx.connectionAttempts.create({
      id: runtime.ids.newId(),
      organizationId: suspended.organizationId,
      userId: suspended.ownerId,
      kind: 'meta_business_login',
      stateHash: randomBytes(32),
      expiresAt: new Date(Date.now() - 60_000),
    }),
  )

  await Promise.all([run(), run()])
  await run()

  // ids only, and only the working connection of the active agency
  expect(await queuedSyncs()).toEqual([
    { data: { organizationId: a.organizationId, connectionId: working.id } },
  ])
  const { rows } = await admin.query(
    'select 1 from connection_attempts where organization_id = $1',
    [suspended.organizationId],
  )
  expect(rows).toHaveLength(1)
})

test('abandoned new connections and expired attempts go; a reconnected one is synced, untouched', async () => {
  const a = await agency(tdb, runtime)
  const abandoned = await connection(runtime, a, { externalUserId: 'su-old', status: 'pending' })
  const fresh = await connection(runtime, a, { externalUserId: 'su-new', status: 'pending' })
  // reconnected and never imported again: active at once (plan 03, choice 6)
  const reconnected = await connection(runtime, a, {
    externalUserId: 'su-back',
    accounts: [{ platform: 'facebook', externalId: '100000000000999', pageId: '100000000000999' }],
  })
  await admin.query(
    "update account_connections set created_at = now() - interval '2 days' where id = any($1)",
    [[abandoned.id, reconnected.id]],
  )
  await runtime.uow.run({ organizationId: a.organizationId, userId: null }, (tx) =>
    tx.connectionAttempts.create({
      id: runtime.ids.newId(),
      organizationId: a.organizationId,
      userId: a.ownerId,
      kind: 'meta_business_login',
      stateHash: randomBytes(32),
      expiresAt: new Date(Date.now() - 60_000),
    }),
  )
  const before = await admin.query('select * from account_connections where id = $1', [
    reconnected.id,
  ])

  await run()

  expect((await connectionIds(a.organizationId)).sort()).toEqual([fresh.id, reconnected.id].sort())
  const after = await admin.query('select * from account_connections where id = $1', [
    reconnected.id,
  ])
  expect(after.rows).toEqual(before.rows)
  expect((await queuedSyncs()).map((r) => r.data.connectionId)).toContain(reconnected.id)
  const attempts = await admin.query(
    'select 1 from connection_attempts where organization_id = $1',
    [a.organizationId],
  )
  expect(attempts.rows).toHaveLength(0)
})
