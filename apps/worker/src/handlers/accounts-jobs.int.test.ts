import pg from 'pg'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { requestSync, type PlatformConnector } from '@app/application'
import type { OrgActor } from '@app/domain'
import type { Runtime } from '@app/infrastructure'
import { startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { META_MOCK, startMetaMock, type MetaMock } from '@app/meta-mock'
import { startWorker } from '../start-worker.js'
import { accountsHealth } from './accounts-health.js'
import { accountsSync } from './accounts-sync.js'
import {
  FORNO_LUCE,
  accountsRuntime,
  agency,
  connection,
  handlerDeps,
  recordingQueue,
  type Agency,
} from '../../tests/accounts-jobs.js'

// The account jobs (spec §8.4, plan 03 Task 10) against the fake Graph API and the real queue.
// Other agencies are the isolation battery's (isolation.int.test.ts).

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client

const { pages, instagram } = META_MOCK
const DAY = 86_400_000

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  runtime = await accountsRuntime(tdb, mock)
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
}, 120_000)

afterEach(() => {
  mock.scenario('default')
})

afterAll(async () => {
  // the last test's worker has stopped it already
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 }).catch(() => undefined)
  await runtime.close()
  await admin.end()
  await mock.stop()
  await tdb.stop()
})

const job = (of: Agency, connectionId: string) => ({
  id: 'lavoro',
  data: { organizationId: of.organizationId, connectionId },
})

interface AccountRow {
  external_id: string
  name: string
  active: boolean
  health: string | null
  health_message: string | null
  quota_used: number | null
  quota_total: number | null
  connection_id: string
}

const accountsOf = async (of: Agency) =>
  (
    await admin.query<AccountRow>(
      `select external_id, name, active, health, health_message, quota_used, quota_total,
              connection_id
         from social_accounts where organization_id = $1 order by external_id`,
      [of.organizationId],
    )
  ).rows

const byId = async (of: Agency) =>
  Object.fromEntries((await accountsOf(of)).map((a) => [a.external_id, a]))

const connectionRow = async (id: string) =>
  (
    await admin.query<{
      status: string
      token_enc: string
      expires_at: Date | null
      last_refreshed_at: Date | null
      last_usage: unknown
    }>(
      'select status, token_enc, expires_at, last_refreshed_at, last_usage from account_connections where id = $1',
      [id],
    )
  ).rows[0]

test('the sync refreshes names and closes what the owner no longer sees; another connection’s account stays', async () => {
  const of = await agency(tdb, runtime)
  const a = await connection(runtime, of, {
    accounts: [{ ...FORNO_LUCE[0], name: 'Vecchio nome' }, FORNO_LUCE[1]],
  })
  // a second connection of the agency owns one account the first one does not see
  await connection(runtime, of, {
    kind: 'meta_business_login',
    externalUserId: META_MOCK.users.clientIntegration,
    accounts: [{ platform: 'instagram', externalId: instagram.clientOnly }],
  })
  mock.scenario('asset_removed', { id: instagram.ofPage })
  const queue = recordingQueue()
  await accountsSync(job(of, a.id), handlerDeps(runtime, queue))

  const after = await byId(of)
  expect(after[pages.withInstagram]).toMatchObject({ name: 'Forno Luce', active: true })
  expect(after[instagram.ofPage]).toMatchObject({ active: false })
  expect(after[instagram.clientOnly]).toMatchObject({ active: true })
  // the accounts not imported are not created by the sync (plan 03, choice 3)
  expect(Object.keys(after).sort()).toEqual(
    [pages.withInstagram, instagram.ofPage, instagram.clientOnly].sort(),
  )
  // then the health check of the same connection, ids only
  expect(queue.sent).toEqual([
    {
      name: 'accounts.health',
      data: { organizationId: of.organizationId, connectionId: a.id },
      opts: { singletonKey: a.id },
    },
  ])
})

test('the health check: green with the quota, the page green, the usage kept', async () => {
  const of = await agency(tdb, runtime)
  const a = await connection(runtime, of, { accounts: FORNO_LUCE })
  await accountsHealth(job(of, a.id), handlerDeps(runtime))
  const after = await byId(of)
  expect(after[instagram.ofPage]).toMatchObject({
    health: 'ok',
    health_message: null,
    quota_used: expect.any(Number) as unknown,
    quota_total: expect.any(Number) as unknown,
  })
  expect(after[pages.withInstagram]).toMatchObject({ health: 'ok', quota_used: null })
  expect((await connectionRow(a.id))?.last_usage).toMatchObject({
    business: expect.any(Array) as unknown,
  })
})

test('a token Meta calls expired: the connection is expired and its accounts red; another connection goes on', async () => {
  const of = await agency(tdb, runtime)
  const a = await connection(runtime, of, {
    token: META_MOCK.tokens.businessLogin,
    kind: 'meta_business_login',
    externalUserId: META_MOCK.users.clientIntegration,
    accounts: [{ platform: 'instagram', externalId: instagram.clientOnly }],
  })
  const b = await connection(runtime, of, { accounts: FORNO_LUCE })
  mock.scenario('token_expired', { token: META_MOCK.tokens.businessLogin })
  await accountsHealth(job(of, a.id), handlerDeps(runtime))
  await accountsHealth(job(of, b.id), handlerDeps(runtime))

  expect((await connectionRow(a.id))?.status).toBe('expired')
  expect((await connectionRow(b.id))?.status).toBe('active')
  const after = await byId(of)
  expect(after[instagram.clientOnly]).toMatchObject({
    health: 'error',
    health_message: expect.stringContaining('collegalo di nuovo') as unknown,
    active: true,
  })
  expect(after[instagram.ofPage]?.health).toBe('ok')
  // a connection that no longer works is not checked again
  const calls = mock.calls().length
  await accountsHealth(job(of, a.id), handlerDeps(runtime))
  expect(mock.calls()).toHaveLength(calls)
})

test('the client took the access away: revoked', async () => {
  const of = await agency(tdb, runtime)
  const a = await connection(runtime, of, { accounts: FORNO_LUCE })
  mock.scenario('token_expired', { token: META_MOCK.tokens.systemUser, subcode: 458 })
  await accountsHealth(job(of, a.id), handlerDeps(runtime))
  expect((await connectionRow(a.id))?.status).toBe('revoked')
  expect((await accountsOf(of)).map((r) => r.health)).toEqual(['error', 'error'])
})

test('a token past its expiry that cannot be renewed: expired, without asking Meta', async () => {
  const of = await agency(tdb, runtime)
  const a = await connection(runtime, of, {
    accounts: FORNO_LUCE,
    expiresAt: new Date(Date.now() - DAY),
  })
  const calls = mock.calls().length
  await accountsHealth(job(of, a.id), handlerDeps(runtime))
  expect(mock.calls()).toHaveLength(calls)
  expect((await connectionRow(a.id))?.status).toBe('expired')
  expect((await accountsOf(of)).every((r) => r.health === 'error')).toBe(true)
})

test('a token close to its expiry and renewable: a new expiry and a new sealed token', async () => {
  const of = await agency(tdb, runtime)
  const a = await connection(runtime, of, {
    accounts: FORNO_LUCE,
    expiresAt: new Date(Date.now() + 2 * DAY),
  })
  const before = await connectionRow(a.id)
  const later = new Date(Date.now() + 60 * DAY)
  const deps = handlerDeps(runtime)
  const meta = deps.connectors.meta_system_user as PlatformConnector
  // the system user's tokens do not expire: a kind that renews is stood in for here
  const renewing: PlatformConnector = {
    ...meta,
    refresh: () =>
      Promise.resolve({ ok: true, token: META_MOCK.tokens.systemUser, expiresAt: later }),
  }
  await accountsHealth(job(of, a.id), {
    ...deps,
    connectors: { meta_system_user: renewing },
  })
  const after = await connectionRow(a.id)
  expect(after?.status).toBe('active')
  expect(after?.expires_at?.toISOString()).toBe(later.toISOString())
  expect(after?.token_enc).not.toBe(before?.token_enc)
  expect(after?.last_refreshed_at).not.toBeNull()
  // checked with the new token
  expect((await accountsOf(of)).every((r) => r.health === 'ok')).toBe(true)
})

test('the person who connected is disabled: the connection stays active and is checked', async () => {
  const of = await agency(tdb, runtime)
  const a = await connection(runtime, of, { accounts: FORNO_LUCE })
  await admin.query(
    "update organization_members set status = 'disabled' where organization_id = $1 and user_id = $2",
    [of.organizationId, of.ownerId],
  )
  await accountsHealth(job(of, a.id), handlerDeps(runtime))
  expect((await connectionRow(a.id))?.status).toBe('active')
  expect((await accountsOf(of)).every((r) => r.health === 'ok')).toBe(true)
})

test('a 100/33 on one account: it stays active and as it was; the others are checked', async () => {
  const of = await agency(tdb, runtime)
  const a = await connection(runtime, of, {
    accounts: [...FORNO_LUCE, { platform: 'instagram', externalId: instagram.agencyOnly }],
  })
  // a state no Meta answer of this test would give: only "left as it was" keeps it
  await admin.query(
    `update social_accounts set health = 'warning', health_message = 'prima'
      where organization_id = $1 and external_id = $2`,
    [of.organizationId, instagram.ofPage],
  )
  mock.scenario('error', {
    code: 100,
    subcode: 33,
    path: `/${instagram.ofPage}/content_publishing_limit`,
  })
  await accountsHealth(job(of, a.id), handlerDeps(runtime))
  const after = await byId(of)
  expect(after[instagram.ofPage]).toMatchObject({
    active: true,
    health: 'warning',
    health_message: 'prima',
  })
  expect(after[instagram.agencyOnly]?.health).toBe('ok')
  expect((await connectionRow(a.id))?.status).toBe('active')
})

test('the Instagram quota used up: yellow, with the reason', async () => {
  const of = await agency(tdb, runtime)
  const a = await connection(runtime, of, { accounts: FORNO_LUCE })
  mock.scenario('quota_exhausted', { igUserId: instagram.ofPage })
  await accountsHealth(job(of, a.id), handlerDeps(runtime))
  const ig = (await byId(of))[instagram.ofPage]
  expect(ig).toMatchObject({
    health: 'warning',
    health_message: expect.stringContaining('Quota') as unknown,
  })
  expect(ig?.quota_used).toBe(ig?.quota_total)
})

test('Meta failing on every attempt: the last state stays and the job fails', async () => {
  const of = await agency(tdb, runtime)
  const a = await connection(runtime, of, { accounts: FORNO_LUCE })
  await accountsHealth(job(of, a.id), handlerDeps(runtime))
  mock.scenario('transient_error', {})
  await expect(accountsHealth(job(of, a.id), handlerDeps(runtime))).rejects.toThrow()
  await expect(accountsSync(job(of, a.id), handlerDeps(runtime))).rejects.toThrow()
  expect((await connectionRow(a.id))?.status).toBe('active')
  expect((await accountsOf(of)).map((r) => [r.health, r.active])).toEqual([
    ['ok', true],
    ['ok', true],
  ])
})

const ownerOf = (of: Agency): OrgActor => ({
  userId: of.ownerId,
  platformRole: null,
  organizationId: of.organizationId,
  orgRole: 'owner',
  memberships: new Map(),
})

test('«Aggiorna»: through the real queue to the worker, sync then health; again within 5 minutes is refused', async () => {
  const of = await agency(tdb, runtime)
  const a = await connection(runtime, of, { accounts: FORNO_LUCE })
  const deps = handlerDeps(runtime)
  const worker = await startWorker({
    queue: runtime.queue,
    logger: runtime.logger,
    services: deps,
    heartbeatPath: '/tmp/accounts-jobs-heartbeat',
    heartbeatEveryMs: 60_000,
    queues: ['accounts.sync', 'accounts.health'],
  })
  try {
    const syncDeps = { uow: runtime.uow, queue: runtime.queue, rateLimiter: runtime.rateLimiter }
    // the answer says when the next sync is allowed, so the panel waits instead of asking again
    await expect(requestSync(syncDeps, ownerOf(of), { connectionId: a.id })).resolves.toEqual({
      retryAfterSeconds: 300,
    })
    // the same uuid in capitals is the same connection, and the same limit
    await expect(
      requestSync(syncDeps, ownerOf(of), { connectionId: a.id.toUpperCase() }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    await expect(requestSync(syncDeps, ownerOf(of), { connectionId: a.id })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
    // the jobs carry ids only
    const { rows } = await admin.query<{ name: string; data: Record<string, unknown> }>(
      "select name, data from pgboss.job where name in ('accounts.sync', 'accounts.health') and data->>'connectionId' = $1",
      [a.id],
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows)
      expect(Object.keys(r.data).sort()).toEqual(['connectionId', 'organizationId'])

    const deadline = Date.now() + 30_000
    while ((await accountsOf(of)).some((r) => r.health === null)) {
      if (Date.now() > deadline) throw new Error('the jobs did not run')
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    expect((await accountsOf(of)).every((r) => r.health === 'ok')).toBe(true)
  } finally {
    await worker.stop()
  }
})
