import { randomBytes, randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/node-postgres'
import type pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Tx } from '@app/application'
import { drizzleOrganizationKeys } from '../db/organizations/organization-keys-repository.js'
import * as schema from '../db/schema/index.js'
import { fixedClock, startTestDatabase, withScope } from '../testing/index.js'
import type { TestDatabase } from '../testing/index.js'
import { createKeyRing } from './key-ring.js'

let tdb: TestDatabase
const ring = createKeyRing({
  platformKey: randomBytes(32),
  clock: fixedClock(new Date('2026-10-18T10:00:00Z')),
})
const txOf = (c: pg.Client): Tx => ({
  organizationKeys: drizzleOrganizationKeys(drizzle(c, { schema })),
})
const inOrg = <T>(organizationId: string, fn: (tx: Tx, c: pg.Client) => Promise<T>) =>
  withScope(tdb.runtimeUrl, { kind: 'organization', organizationId }, (c) => fn(txOf(c), c))
const boxFor = (org: string) => inOrg(org, (tx) => ring.forOrganization(tx, org))
const rotate = (org: string) => inOrg(org, (tx) => ring.rotateOrganizationKey(tx, org))
const rawOrgKey = (org: string) =>
  withScope(tdb.runtimeUrl, { kind: 'system' }, async (c) => {
    const { rows } = await c.query<{ key_enc: string }>(
      'select key_enc from organization_keys where organization_id = $1 order by version limit 1',
      [org],
    )
    return rows[0]
  })

const orgA = randomUUID()
const orgB = randomUUID()
beforeAll(async () => {
  tdb = await startTestDatabase()
  await withScope(tdb.runtimeUrl, { kind: 'system' }, async (c) => {
    for (const o of [orgA, orgB]) {
      await c.query('insert into organizations (id, name, slug) values ($1, $2, $3)', [o, 'Ag', o])
    }
  })
  for (const o of [orgA, orgB]) await inOrg(o, (tx) => ring.createOrganizationKey(tx, o))
}, 120_000)
afterAll(async () => {
  await tdb.stop()
})

test('stored organization key is encrypted', async () => {
  expect((await rawOrgKey(orgA))?.key_enc).toMatch(/^v1\.1\./)
})

test('secret sealed for org A cannot be opened with org B key', async () => {
  const a = await boxFor(orgA)
  const b = await boxFor(orgB)
  expect(() => b.open(a.seal('x', 'integrations:meta'), 'integrations:meta')).toThrow()
})

test('an agency transaction cannot load another agency key', async () => {
  await expect(inOrg(orgB, (tx) => ring.forOrganization(tx, orgA))).rejects.toThrow(/no data key/)
  await expect(inOrg(orgB, (tx) => ring.rotateOrganizationKey(tx, orgA))).rejects.toThrow()
  const orgC = randomUUID()
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query('insert into organizations (id, name, slug) values ($1, $2, $3)', [orgC, 'Ag', orgC]),
  )
  // drizzle wraps the driver error: the RLS refusal is its cause
  const error: unknown = await inOrg(orgB, (tx) => ring.createOrganizationKey(tx, orgC)).catch(
    (e: unknown) => e,
  )
  expect(String((error as Error).cause)).toMatch(/row-level security/)
})

test('rotation keeps old secrets readable and seals new ones with new version', async () => {
  const before = (await boxFor(orgA)).seal('x', 'k')
  await rotate(orgA)
  const after = await boxFor(orgA)
  expect(after.open(before, 'k')).toBe('x')
  expect(after.seal('y', 'k')).toMatch(/^v1\.2\./)
})
