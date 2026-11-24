import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Tx } from '@app/application'
import { createKeyRing } from '../../crypto/key-ring.js'
import { createLogger } from '../../logging/logger.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { fixedClock, seed, startTestDatabase } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'
import { createDb } from '../client.js'
import type { DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'
import { createIntegrationStore } from './integration-store.js'

// The Telegram bots (plan 08 Task 7): the platform's in the system scope, an agency's inside
// that agency; each can be taken away, an agency's only over the version that was read.

let tdb: TestDatabase
let handle: DbHandle
let orgA: string, orgB: string, ownerA: string, ownerB: string
let uow: ReturnType<typeof createUnitOfWork>
const keyRing = createKeyRing({ platformKey: randomBytes(32), clock: fixedClock(new Date()) })
const store = createIntegrationStore({ keyRing })
const logger = createLogger({ service: 'worker', level: 'error' })
const TOKEN = '1000000002:AAsegreto-del-bot-agenzia-0000000000'

const inA = <T>(fn: (tx: Tx) => Promise<T>) => uow.run({ organizationId: orgA, userId: ownerA }, fn)
const inB = <T>(fn: (tx: Tx) => Promise<T>) => uow.run({ organizationId: orgB, userId: ownerB }, fn)
const asSystem = <T>(fn: (tx: Tx) => Promise<T>) => uow.runAsSystem('test', fn)

const saveA = () =>
  inA((tx) =>
    store.replace(tx, orgA, 'telegram', {
      config: { botId: 1000000002, botUsername: 'agenzia_mock_bot' },
      secret: TOKEN,
      updatedBy: ownerA,
      expectedVersion: null,
      verifiedAt: new Date(),
    }),
  )

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

test('an agency bot is stored with its name; the token only comes back as credentials', async () => {
  const view = await saveA()
  expect(view).toMatchObject({ kind: 'telegram', config: { botUsername: 'agenzia_mock_bot' } })
  expect(JSON.stringify(view)).not.toContain('segreto')
  expect(await inA((tx) => store.credentials(tx, orgA, 'telegram'))).toMatchObject({
    secret: TOKEN,
  })
})

test('a bot name that is not one is refused', async () => {
  const refused = await inB((tx) =>
    store.replace(tx, orgB, 'telegram', {
      config: { botId: 1000000003, botUsername: 'no spaces' },
      secret: TOKEN,
      updatedBy: ownerB,
      expectedVersion: null,
      verifiedAt: null,
    }),
  ).catch((e: unknown) => e)
  expect(refused).toMatchObject({ code: 'VALIDATION' })
})

test('the agency bot goes away only over the version read, and never from another agency', async () => {
  const stored = await inA((tx) => tx.integrations.findForOrganization(orgA, 'telegram'))
  if (!stored) throw new Error('no row')
  expect(
    await inA((tx) => tx.integrations.deleteForOrganization(orgA, 'telegram', new Date(0))),
  ).toBe(false)
  expect(
    await inB((tx) => tx.integrations.deleteForOrganization(orgA, 'telegram', stored.updatedAt)),
  ).toBe(false)
  expect(
    await inA((tx) => tx.integrations.deleteForOrganization(orgA, 'telegram', stored.updatedAt)),
  ).toBe(true)
  expect(await inA((tx) => store.get(tx, orgA, 'telegram'))).toBeNull()
})

test('the platform bot is the system scope’s: an agency neither sees nor removes it', async () => {
  await asSystem((tx) =>
    store.replacePlatform(tx, 'telegram', {
      config: { botId: 1000000001, botUsername: 'feedway_mock_bot' },
      secret: '1000000001:AAsegreto-del-bot-piattaforma-000000',
      updatedBy: null,
    }),
  )
  expect(await inA((tx) => store.getPlatform(tx, 'telegram'))).toBeNull()
  expect(await inA((tx) => tx.integrations.deletePlatform('telegram'))).toBe(false)
  expect(await asSystem((tx) => store.getPlatform(tx, 'telegram'))).toMatchObject({
    config: { botId: 1000000001, botUsername: 'feedway_mock_bot' },
  })
  expect(await asSystem((tx) => tx.integrations.deletePlatform('telegram'))).toBe(true)
  expect(await asSystem((tx) => store.getPlatform(tx, 'telegram'))).toBeNull()
})

test('one bot serves one place: another agency or the platform cannot save it too', async () => {
  await saveA()
  const sameBot = (botUsername: string) => ({
    config: { botId: 1000000002, botUsername },
    secret: TOKEN,
    updatedBy: null,
  })
  const inOtherAgency = await inB((tx) =>
    store.replace(tx, orgB, 'telegram', {
      ...sameBot('agenzia_mock_bot'),
      updatedBy: ownerB,
      expectedVersion: null,
      verifiedAt: null,
    }),
  ).catch((e: unknown) => e)
  expect(inOtherAgency).toMatchObject({ code: 'CONFLICT' })
  const onPlatform = await asSystem((tx) =>
    store.replacePlatform(tx, 'telegram', sameBot('agenzia_mock_bot')),
  ).catch((e: unknown) => e)
  expect(onPlatform).toMatchObject({ code: 'CONFLICT' })
  // the same agency saving its own bot again is no clash
  const stored = await inA((tx) => store.get(tx, orgA, 'telegram'))
  expect(
    await inA((tx) =>
      store.replace(tx, orgA, 'telegram', {
        ...sameBot('agenzia_mock_bot'),
        updatedBy: ownerA,
        expectedVersion: stored?.updatedAt ?? null,
        verifiedAt: null,
      }),
    ),
  ).toMatchObject({ config: { botId: 1000000002 } })
})

test('a bot id that is not one is refused', async () => {
  const refused = await asSystem((tx) =>
    store.replacePlatform(tx, 'telegram', {
      config: { botId: -1, botUsername: 'feedway_mock_bot' },
      secret: TOKEN,
      updatedBy: null,
    }),
  ).catch((e: unknown) => e)
  expect(refused).toMatchObject({ code: 'VALIDATION' })
})
