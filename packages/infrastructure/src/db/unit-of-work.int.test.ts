import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { StoreUnavailableError, type AuditEntry, type Logger } from '@app/application'
import type { OrgActor } from '@app/domain'
import { uuidV7Generator } from '../system/id-generator.js'
import { seed, startTestDatabase, withScope } from '../testing/index.js'
import type { TestDatabase } from '../testing/index.js'
import { createDb } from './client.js'
import type { DbHandle } from './client.js'
import { createUnitOfWork, executorOf } from './unit-of-work.js'

let tdb: TestDatabase
let handle: DbHandle
const infos: { obj: object; msg: string | undefined }[] = []
const logger: Logger = {
  debug: () => undefined,
  info: (obj, msg) => infos.push({ obj, msg }),
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}
const uow = () => createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger })

let orgA: string, orgB: string, ownerA: string, workspaceOfB: string
const owner = (organizationId: string, userId: string): OrgActor => ({
  userId,
  platformRole: null,
  organizationId,
  orgRole: 'owner',
  memberships: new Map(),
})

beforeAll(async () => {
  tdb = await startTestDatabase()
  // one connection: proves the scope does not survive on a reused connection
  handle = createDb(tdb.runtimeUrl, { max: 1, applicationName: 'uow-test' })
  await seed(tdb.runtimeUrl, async (s) => {
    orgA = await s.organization()
    orgB = await s.organization()
    ownerA = await s.user()
    await s.member(orgA, ownerA, 'owner')
    await s.workspace(orgA)
    workspaceOfB = await s.workspace(orgB)
  })
})
afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

const settings = (tx: Parameters<Parameters<ReturnType<typeof uow>['run']>[1]>[0]) =>
  executorOf(tx).execute<{ org: string | null; usr: string | null; scope: string | null }>(
    sql`select current_setting('app.organization_id', true) as org,
               current_setting('app.user_id', true) as usr,
               current_setting('app.scope', true) as scope`,
  )

test('run sets the organization and user for the transaction only', async () => {
  const inside = await uow().run({ organizationId: orgA, userId: ownerA }, settings)
  expect(inside.rows[0]).toMatchObject({ org: orgA, usr: ownerA })
  expect(inside.rows[0]?.scope).not.toBe('system')

  const after = await handle.db.execute<{ org: string | null; usr: string | null }>(
    sql`select current_setting('app.organization_id', true) as org,
               current_setting('app.user_id', true) as usr`,
  )
  expect(after.rows[0]?.org ?? '').toBe('')
  expect(after.rows[0]?.usr ?? '').toBe('')
})

test('a user-only scope sets no organization', async () => {
  const { rows } = await uow().run({ userId: ownerA }, settings)
  expect(rows[0]?.org ?? '').toBe('')
  expect(rows[0]?.usr).toBe(ownerA)
})

test('an agency job sets the organization and no person', async () => {
  const { rows } = await uow().run({ organizationId: orgA, userId: null }, settings)
  expect(rows[0]).toMatchObject({ org: orgA, usr: '' })
  const seen = await uow().run({ organizationId: orgA, userId: null }, (tx) =>
    executorOf(tx).execute<{ organization_id: string }>(
      sql`select organization_id from workspaces`,
    ),
  )
  expect(new Set(seen.rows.map((r) => r.organization_id))).toEqual(new Set([orgA]))
})

test('runAsSystem opens the system scope, logs the reason and does not leak it', async () => {
  const { rows } = await uow().runAsSystem('test.reason', settings)
  expect(rows[0]?.scope).toBe('system')
  expect(infos).toContainEqual(expect.objectContaining({ obj: { reason: 'test.reason' } }))
  const after = await handle.db.execute<{ scope: string | null }>(
    sql`select current_setting('app.scope', true) as scope`,
  )
  expect(after.rows[0]?.scope ?? '').toBe('')
})

test('an empty scope is refused before touching the database', async () => {
  await expect(uow().run({ userId: '' }, () => Promise.resolve())).rejects.toThrow(/userId/)
  // a job without its agency is not a job of the agency
  await expect(uow().run({ userId: null } as never, () => Promise.resolve())).rejects.toThrow(
    /userId/,
  )
  await expect(
    uow().run({ organizationId: '', userId: ownerA }, () => Promise.resolve()),
  ).rejects.toThrow(/organizationId/)
})

test('a user-only scope sees no agency rows', async () => {
  const { rows } = await uow().run({ userId: ownerA }, (tx) =>
    executorOf(tx).execute(sql`select id from workspaces`),
  )
  expect(rows).toEqual([])
})

test('repository never returns another organization rows even if asked by id', async () => {
  const actor = owner(orgA, ownerA)
  const found = await uow().run({ organizationId: orgA, userId: ownerA }, (tx) =>
    tx.workspaces.findVisibleById(actor, workspaceOfB),
  )
  expect(found).toBeNull()
})

test('RLS still isolates when the SQL filter is missing', async () => {
  const { rows } = await uow().run({ organizationId: orgA, userId: ownerA }, (tx) =>
    executorOf(tx).execute<{ organization_id: string }>(
      sql`select organization_id from workspaces`,
    ),
  )
  expect(rows.length).toBeGreaterThan(0)
  expect(rows.every((w) => w.organization_id === orgA)).toBe(true)
})

test('rollback discards audit entries too', async () => {
  const entry: AuditEntry = {
    organizationId: orgA,
    actorId: ownerA,
    source: 'panel',
    action: 'workspace.created',
    entity: 'workspace',
    entityId: randomUUID(),
    workspaceId: null,
    ip: null,
  }
  await expect(
    uow().run({ organizationId: orgA, userId: ownerA }, async (tx) => {
      await tx.audit.record(entry)
      throw new Error('boom')
    }),
  ).rejects.toThrow('boom')
  const { rows } = await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query<{ n: number }>('select count(*)::int as n from audit_log where entity_id = $1', [
      entry.entityId,
    ]),
  )
  expect(rows[0]?.n).toBe(0)
})

// R1 and R2 of the tappa 8 review: a transaction that asks for a second connection of a full
// pool, and the failures that pass on their own.

test('a transaction that waits for a connection of a full pool fails as unavailable, and saves nothing', async () => {
  // the pool has one connection: the transaction inside asks for a second one
  const failure = await uow()
    .runAsSystem('test: outer', () => uow().runAsSystem('test: inner', () => Promise.resolve(1)))
    .catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(StoreUnavailableError)
  expect(String((failure as Error).cause)).toContain('timeout exceeded when trying to connect')
  // the connection came back to the pool
  expect(await uow().runAsSystem('test: after', () => Promise.resolve('free'))).toBe('free')
}, 10_000)

test('a serialization failure leaves as unavailable, the error of the data as it is', async () => {
  const serialization = await uow()
    .runAsSystem('test: a conflict', (tx) =>
      executorOf(tx).execute(
        sql`do $$ begin raise exception 'conflict' using errcode = 'serialization_failure'; end $$`,
      ),
    )
    .catch((error: unknown) => error)
  expect(serialization).toBeInstanceOf(StoreUnavailableError)
  const invalid = await uow()
    .runAsSystem('test: bad data', (tx) => executorOf(tx).execute(sql`select 'x'::uuid`))
    .catch((error: unknown) => error)
  expect(invalid).toBeInstanceOf(Error)
  expect(invalid).not.toBeInstanceOf(StoreUnavailableError)
})

test('a routine reason is logged at debug, the others at info', async () => {
  const debugs: unknown[] = []
  const quiet = createUnitOfWork({
    db: handle.db,
    ids: uuidV7Generator,
    logger: { ...logger, debug: (obj) => debugs.push(obj) },
  })
  infos.length = 0
  await quiet.runAsSystem('test: every minute', () => Promise.resolve(), { routine: true })
  expect(debugs).toEqual([{ reason: 'test: every minute' }])
  expect(infos).toEqual([])
  await quiet.runAsSystem('test: rare', () => Promise.resolve())
  expect(infos).toEqual([{ obj: { reason: 'test: rare' }, msg: 'system scope transaction' }])
})
