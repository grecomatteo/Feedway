import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { AuditEntry, Logger } from '@app/application'
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

test('runAsSystem opens the system scope, logs the reason and does not leak it', async () => {
  const { rows } = await uow().runAsSystem('test.reason', settings)
  expect(rows[0]?.scope).toBe('system')
  expect(infos).toContainEqual(expect.objectContaining({ obj: { reason: 'test.reason' } }))
  const after = await handle.db.execute<{ scope: string | null }>(
    sql`select current_setting('app.scope', true) as scope`,
  )
  expect(after.rows[0]?.scope ?? '').toBe('')
})

test('an empty scope is refused before touching the database', () => {
  expect(() => uow().run({ userId: '' }, () => Promise.resolve())).toThrow(/userId/)
  expect(() => uow().run({ organizationId: '', userId: ownerA }, () => Promise.resolve())).toThrow(
    /organizationId/,
  )
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
