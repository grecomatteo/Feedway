import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { AuditEntry, Logger, UnitOfWork } from '@app/application'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, withScope } from '../../testing/index.js'
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

let orgA: string, orgB: string, ownerA: string

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'audit-repos-test' })
  uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger: silent })
  await seed(tdb.runtimeUrl, async (s) => {
    orgA = await s.organization()
    orgB = await s.organization()
    ownerA = await s.user()
    await s.member(orgA, ownerA, 'owner')
  })
})
afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  organizationId: orgA,
  actorId: ownerA,
  source: 'panel',
  action: 'workspace.created',
  entity: 'workspace',
  entityId: randomUUID(),
  workspaceId: null,
  ip: '203.0.113.7',
  ...over,
})
const rowsFor = (entityId: string | null) =>
  withScope(tdb.runtimeUrl, { kind: 'system' }, async (c) => {
    const { rows } = await c.query<{
      organization_id: string | null
      action: string
      ip: string
      data: unknown
    }>('select organization_id, action, host(ip) as ip, data from audit_log where entity_id = $1', [
      entityId,
    ])
    return rows
  })

test('an agency entry is written with its data inside the agency scope', async () => {
  const e = entry({ data: { name: 'Alfa' } })
  await uow.run({ organizationId: orgA, userId: ownerA }, (tx) => tx.audit.record(e))
  expect(await rowsFor(e.entityId)).toEqual([
    {
      organization_id: orgA,
      action: 'workspace.created',
      ip: '203.0.113.7',
      data: { name: 'Alfa' },
    },
  ])
})

test('a personal entry is written from a user-only scope', async () => {
  const e = entry({ organizationId: null, action: 'auth.login', entity: 'user', entityId: ownerA })
  await uow.run({ userId: ownerA }, (tx) => tx.audit.record(e))
  const rows = await rowsFor(ownerA)
  expect(rows).toContainEqual(
    expect.objectContaining({ organization_id: null, action: 'auth.login' }),
  )
})

test('a personal action inside an agency is refused', async () => {
  const e = entry({ action: 'auth.login', entity: 'user', entityId: ownerA })
  await expect(
    uow.run({ organizationId: orgA, userId: ownerA }, (tx) => tx.audit.record(e)),
  ).rejects.toThrow(/personal/)
})

test('an agency cannot write entries for another agency', async () => {
  const e = entry({ organizationId: orgB })
  await expect(
    uow.run({ organizationId: orgA, userId: ownerA }, (tx) => tx.audit.record(e)),
  ).rejects.toThrow()
  expect(await rowsFor(e.entityId)).toEqual([])
})

test('a user cannot write a personal entry as someone else', async () => {
  const e = entry({
    organizationId: null,
    action: 'auth.logout',
    actorId: randomUUID(),
    entityId: randomUUID(),
  })
  await expect(uow.run({ userId: ownerA }, (tx) => tx.audit.record(e))).rejects.toThrow()
})
