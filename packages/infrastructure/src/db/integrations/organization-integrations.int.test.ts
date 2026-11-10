import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Tx } from '@app/application'
import type { MetaIntegrationConfig } from '@app/domain/platforms/meta'
import { createKeyRing } from '../../crypto/key-ring.js'
import { createLogger } from '../../logging/logger.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { fixedClock, seed, startTestDatabase, withScope } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'
import { createDb } from '../client.js'
import type { DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'
import { createIntegrationStore } from './integration-store.js'

// An agency's integrations (Meta, plan 03 Task 4): sealed with the agency's data key, visible
// only inside that agency.

let tdb: TestDatabase
let handle: DbHandle
let orgA: string, orgB: string, ownerA: string, ownerB: string
let uow: ReturnType<typeof createUnitOfWork>
const keyRing = createKeyRing({ platformKey: randomBytes(32), clock: fixedClock(new Date()) })
const store = createIntegrationStore({ keyRing })
const logger = createLogger({ service: 'worker', level: 'error' })

const config = (over: Partial<MetaIntegrationConfig> = {}): MetaIntegrationConfig => ({
  appId: '1000000000000001',
  configId: '2000000000000001',
  businessId: null,
  dataUseCheckupDueOn: null,
  ...over,
})
const SECRET = 'segreto-app-meta-agenzia-a'

const inA = <T>(fn: (tx: Tx) => Promise<T>) => uow.run({ organizationId: orgA, userId: ownerA }, fn)
const inB = <T>(fn: (tx: Tx) => Promise<T>) => uow.run({ organizationId: orgB, userId: ownerB }, fn)

const rawRows = () =>
  withScope(tdb.runtimeUrl, { kind: 'system' }, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      "select * from integrations where kind = 'meta'",
    )
    return rows
  })

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'test' })
  uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger })
  ;({ orgA, orgB, ownerA, ownerB } = await seed(tdb.runtimeUrl, async (s) => {
    const a = await s.organization()
    const b = await s.organization()
    const oa = await s.user()
    const ob = await s.user()
    await s.member(a, oa, 'owner')
    await s.member(b, ob, 'owner')
    return { orgA: a, orgB: b, ownerA: oa, ownerB: ob }
  }))
  await inA((tx) => keyRing.createOrganizationKey(tx, orgA))
  await inB((tx) => keyRing.createOrganizationKey(tx, orgB))
}, 120_000)
afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

test('A stores its Meta app: the view holds no secret, the credentials open it', async () => {
  expect(await inA((tx) => store.get(tx, orgA, 'meta'))).toBeNull()
  const view = await inA((tx) =>
    store.replace(tx, orgA, 'meta', {
      config: config(),
      secret: SECRET,
      updatedBy: ownerA,
      expectedVersion: null,
      verifiedAt: new Date('2026-11-09T10:00:00Z'),
    }),
  )
  expect(view).toMatchObject({ kind: 'meta', config: config(), updatedBy: ownerA })
  expect(view?.verifiedAt?.toISOString()).toBe('2026-11-09T10:00:00.000Z')
  expect(JSON.stringify(view)).not.toContain('segreto')
  const credentials = await inA((tx) => store.credentials(tx, orgA, 'meta'))
  expect(credentials).toMatchObject({ kind: 'meta', config: config(), secret: SECRET })

  // at rest: sealed with A's key (version 1), nothing of the secret in clear
  const [row] = await rawRows()
  expect(row).toMatchObject({ organization_id: orgA, key_version: 1 })
  expect(JSON.stringify(row)).not.toContain('segreto')
})

test('RLS: B neither sees nor overwrites the row of A, and a copy of it does not open in B', async () => {
  expect(await inB((tx) => store.get(tx, orgA, 'meta'))).toBeNull()
  expect(await inB((tx) => store.credentials(tx, orgA, 'meta'))).toBeNull()
  // B cannot pretend to be A: the row it would write fails the policy
  const refused = await inB((tx) =>
    store.replace(tx, orgA, 'meta', {
      config: config(),
      secret: 'segreto-di-b',
      updatedBy: ownerB,
      expectedVersion: null,
      verifiedAt: null,
    }),
  ).catch((e: unknown) => e)
  expect(refused).toBeInstanceOf(Error)

  // A's sealed value copied into B's row: another key and another AAD, it never opens
  const [rowA] = await rawRows()
  await inB((tx) =>
    store.replace(tx, orgB, 'meta', {
      config: config(),
      secret: 'segreto-di-b',
      updatedBy: ownerB,
      expectedVersion: null,
      verifiedAt: null,
    }),
  )
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query(
      "update integrations set secret_enc = $1 where organization_id = $2 and kind = 'meta'",
      [rowA?.['secret_enc'], orgB],
    ),
  )
  await expect(inB((tx) => store.credentials(tx, orgB, 'meta'))).rejects.toThrow()
  expect((await inA((tx) => store.credentials(tx, orgA, 'meta')))?.secret).toBe(SECRET)
})

test('a replacement over a version that changed meanwhile writes nothing', async () => {
  const read = await inA((tx) => store.credentials(tx, orgA, 'meta'))
  if (read === null) throw new Error('A has no row')
  const replacement = {
    config: config({ businessId: '3000000000000001' }),
    secret: SECRET,
    updatedBy: ownerA,
    verifiedAt: null,
  }
  const first = await inA((tx) =>
    store.replace(tx, orgA, 'meta', { ...replacement, expectedVersion: read.updatedAt }),
  )
  expect(first?.config.businessId).toBe('3000000000000001')
  // the same version again: someone else already moved it
  const second = await inA((tx) =>
    store.replace(tx, orgA, 'meta', {
      ...replacement,
      config: config({ businessId: '4000000000000001' }),
      expectedVersion: read.updatedAt,
    }),
  )
  expect(second).toBeNull()
  // and "no row yet" when there is one
  expect(
    await inA((tx) => store.replace(tx, orgA, 'meta', { ...replacement, expectedVersion: null })),
  ).toBeNull()
  expect((await inA((tx) => store.get(tx, orgA, 'meta')))?.config.businessId).toBe(
    '3000000000000001',
  )
})

test('markVerified marks only the version it tried, and leaves updatedAt as it is', async () => {
  const current = await inA((tx) => store.get(tx, orgA, 'meta'))
  if (current === null) throw new Error('A has no row')
  const at = new Date('2026-11-09T12:00:00Z')
  expect(await inA((tx) => tx.integrations.markVerified(orgA, 'meta', at, new Date(0)))).toBe(false)
  expect(await inA((tx) => tx.integrations.markVerified(orgA, 'meta', at, current.updatedAt))).toBe(
    true,
  )
  const after = await inA((tx) => store.get(tx, orgA, 'meta'))
  expect(after?.verifiedAt?.toISOString()).toBe(at.toISOString())
  expect(after?.updatedAt.getTime()).toBe(current.updatedAt.getTime())
})

test('the table refuses a platform Meta row and an agency SMTP row', async () => {
  const insert = (organizationId: string | null, kind: string) =>
    withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
      c.query(
        `insert into integrations (id, organization_id, kind, config, secret_enc, key_version)
         values (gen_random_uuid(), $1, $2, '{}', 'v1.1.x', 1)`,
        [organizationId, kind],
      ),
    )
  await expect(insert(null, 'meta')).rejects.toThrow(/integrations_meta_agency_only/)
  await expect(insert(orgA, 'smtp')).rejects.toThrow(/integrations_smtp_platform_only/)
})

test('a config that is not valid is refused before anything is sealed', async () => {
  await expect(
    inA((tx) =>
      store.replace(tx, orgA, 'meta', {
        config: config({ appId: 'non-un-id' }),
        secret: SECRET,
        updatedBy: ownerA,
        expectedVersion: null,
        verifiedAt: null,
      }),
    ),
  ).rejects.toMatchObject({ code: 'VALIDATION' })
})
