import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  getMetaIntegration,
  replaceMetaIntegration,
  testMetaIntegration,
  type AuthSessionInfo,
  type MetaIntegrationDeps,
} from '@app/application'
import type { OrgActor } from '@app/domain'
import { META_MOCK, startMetaMock, type MetaMock } from '@app/meta-mock'
import { createKeyRing } from '../../crypto/key-ring.js'
import { createDb } from '../../db/client.js'
import type { DbHandle } from '../../db/client.js'
import { createIntegrationStore } from '../../db/integrations/integration-store.js'
import { createUnitOfWork } from '../../db/unit-of-work.js'
import { createLogger } from '../../logging/logger.js'
import { systemClock } from '../../system/clock.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'
import { createMetaAppConnector } from './app-connector.js'
import { createMetaGraphClient } from './graph-client.js'

// Impostazioni → Integrazioni → Meta (plan 03 Task 4), against the fake Graph API only. Roles
// (Admin read only, Member 404) are in the HTTP matrix, not here.

let tdb: TestDatabase
let handle: DbHandle
let admin: pg.Client
let mock: MetaMock
let deps: MetaIntegrationDeps
let owner: OrgActor
let ownerOfB: OrgActor
let verifyCalls: { appId: string; appSecret: string }[]
let duringVerify: (() => Promise<void>) | null

const logger = createLogger({ service: 'web', level: 'error' })
const IP = '203.0.113.7'
const APP = { appId: META_MOCK.app.id, appSecret: META_MOCK.app.secret }

function session(actor: OrgActor, over: Partial<AuthSessionInfo> = {}): AuthSessionInfo {
  const now = new Date()
  return {
    id: 'sessione',
    userId: actor.userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 3_600_000),
    updatedAt: now,
    ipAddress: null,
    userAgent: null,
    authMethod: 'passkey',
    reauthenticatedAt: now,
    ...over,
  }
}

const save = (input: Parameters<typeof replaceMetaIntegration>[3], actor = owner) =>
  replaceMetaIntegration(deps, actor, session(actor), input, { ip: IP })

const storedSecret = async (organizationId: string) =>
  (
    await deps.uow.run({ organizationId, userId: owner.userId }, (tx) =>
      deps.integrations.credentials(tx, organizationId, 'meta'),
    )
  )?.secret

const auditRows = async (action: string) =>
  (
    await admin.query<{ data: Record<string, unknown>; ip: string | null }>(
      'select data, ip::text as ip from audit_log where action = $1 order by created_at',
      [action],
    )
  ).rows

async function agencyWithOwner(): Promise<OrgActor> {
  const { organizationId, userId } = await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const user = await s.user()
    await s.member(org, user, 'owner')
    return { organizationId: org, userId: user }
  })
  const keyRing = createKeyRing({ platformKey, clock: systemClock })
  await deps.uow.run({ organizationId, userId }, (tx) =>
    keyRing.createOrganizationKey(tx, organizationId),
  )
  return { userId, platformRole: null, organizationId, orgRole: 'owner', memberships: new Map() }
}

const platformKey = randomBytes(32)

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'test' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  mock = await startMetaMock()
  const real = createMetaAppConnector(
    createMetaGraphClient({
      mode: 'mock',
      version: 'v25.0',
      baseUrl: mock.url,
      clock: systemClock,
      logger,
      timeoutMs: 500,
      retryBaseDelayMs: 1,
    }),
  )
  deps = {
    uow: createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger }),
    clock: systemClock,
    integrations: createIntegrationStore({
      keyRing: createKeyRing({ platformKey, clock: systemClock }),
    }),
    meta: {
      async verifyApp(app) {
        verifyCalls.push(app)
        await duringVerify?.()
        return real.verifyApp(app)
      },
    },
  }
}, 120_000)

beforeEach(async () => {
  verifyCalls = []
  duringVerify = null
  owner = await agencyWithOwner()
  ownerOfB = await agencyWithOwner()
})

afterEach(() => {
  mock.scenario('default')
})

afterAll(async () => {
  await mock.stop()
  await admin.end()
  await handle.close()
  await tdb.stop()
})

test('the Owner saves the app: tried with Meta first, the view holds nothing of the secret', async () => {
  expect(await getMetaIntegration(deps, owner)).toBeNull()
  const view = await save({ ...APP, configId: META_MOCK.app.configId })
  expect(verifyCalls).toEqual([APP])
  expect(view).toMatchObject({
    appId: APP.appId,
    configId: META_MOCK.app.configId,
    businessId: null,
    dataUseCheckupDueOn: null,
  })
  expect(view.verifiedAt).toBeInstanceOf(Date)
  expect(JSON.stringify(view)).not.toContain(APP.appSecret)
  expect(JSON.stringify(await getMetaIntegration(deps, owner))).not.toContain(APP.appSecret)
  expect(await storedSecret(owner.organizationId)).toBe(APP.appSecret)
})

test('credentials Meta refuses: the stored ones stay as they were', async () => {
  await save(APP)
  const before = await getMetaIntegration(deps, owner)
  await expect(
    save({ appId: APP.appId, appSecret: 'segreto-sbagliato', businessId: '3000000000000001' }),
  ).rejects.toMatchObject({ code: 'VALIDATION', details: { field: 'appSecret' } })
  expect(await getMetaIntegration(deps, owner)).toEqual(before)
  expect(await storedSecret(owner.organizationId)).toBe(APP.appSecret)
  // and a first save that Meta refuses keeps nothing
  await expect(
    save({ appId: APP.appId, appSecret: 'segreto-sbagliato' }, ownerOfB),
  ).rejects.toMatchObject({ code: 'VALIDATION' })
  expect(await getMetaIntegration(deps, ownerOfB)).toBeNull()
})

test('Meta not answering is not a refusal, and nothing is saved', async () => {
  mock.scenario('html_5xx', { path: '/debug_token' })
  await expect(save(APP)).rejects.toMatchObject({ code: 'PLATFORM_UNAVAILABLE' })
  expect(await getMetaIntegration(deps, owner)).toBeNull()
})

test('changing only configId with the secret left empty keeps the old secret, still valid', async () => {
  await save(APP)
  const view = await save({ appId: APP.appId, appSecret: '', configId: META_MOCK.app.configId })
  expect(view.configId).toBe(META_MOCK.app.configId)
  // Meta was asked with the stored secret, which the browser never had
  expect(verifyCalls.at(-1)).toEqual(APP)
  expect(await storedSecret(owner.organizationId)).toBe(APP.appSecret)
  expect((await auditRows('integration.meta_changed')).at(-1)?.data).toEqual({
    fields: ['configId'],
  })
})

test('the same settings again change nothing and do not call Meta', async () => {
  const first = await save({ ...APP, configId: META_MOCK.app.configId })
  const calls = verifyCalls.length
  const again = await save({ appId: APP.appId, configId: META_MOCK.app.configId })
  expect(verifyCalls).toHaveLength(calls)
  expect(again.updatedAt.getTime()).toBe(first.updatedAt.getTime())
})

test('a pasted secret is trimmed', async () => {
  await save({ appId: APP.appId, appSecret: `  ${APP.appSecret}\n` })
  expect(await storedSecret(owner.organizationId)).toBe(APP.appSecret)
})

test('"Prova" while someone saves other settings: a conflict, the new ones stay unverified', async () => {
  await save(APP)
  duringVerify = async () => {
    duringVerify = null
    await save({ appId: APP.appId, businessId: '4000000000000001' })
    await admin.query('update integrations set verified_at = null where organization_id = $1', [
      owner.organizationId,
    ])
  }
  await expect(testMetaIntegration(deps, owner, { ip: IP })).rejects.toMatchObject({
    code: 'CONFLICT',
  })
  expect((await getMetaIntegration(deps, owner))?.verifiedAt).toBeNull()
})

test('the first save needs the secret', async () => {
  await expect(save({ appId: APP.appId })).rejects.toMatchObject({
    code: 'VALIDATION',
    details: { field: 'appSecret' },
  })
  expect(verifyCalls).toEqual([])
})

test('without a recent reauth: reauth error, Meta never called', async () => {
  await expect(
    replaceMetaIntegration(deps, owner, session(owner, { reauthenticatedAt: null }), APP, {
      ip: IP,
    }),
  ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
  expect(verifyCalls).toEqual([])
  expect(await getMetaIntegration(deps, owner)).toBeNull()
})

test('a field that is off is named, before Meta is called', async () => {
  await expect(save({ ...APP, dataUseCheckupDueOn: '2027-02-30' })).rejects.toMatchObject({
    code: 'VALIDATION',
    details: { field: 'dataUseCheckupDueOn' },
  })
  expect(verifyCalls).toEqual([])
})

test('settings saved by someone else while Meta answered stay: the late save is a conflict', async () => {
  await save(APP)
  duringVerify = async () => {
    duringVerify = null
    await save({ appId: APP.appId, businessId: '4000000000000001' })
  }
  await expect(save({ appId: APP.appId, businessId: '3000000000000001' })).rejects.toMatchObject({
    code: 'CONFLICT',
  })
  expect((await getMetaIntegration(deps, owner))?.businessId).toBe('4000000000000001')
})

test('RLS: what A saved is not seen from B', async () => {
  await save(APP)
  expect(await getMetaIntegration(deps, ownerOfB)).toBeNull()
  expect(await storedSecret(ownerOfB.organizationId)).toBeUndefined()
})

test('"Prova": marks verified_at with the stored app, says when nothing is set or Meta refuses', async () => {
  expect(await testMetaIntegration(deps, owner, { ip: IP })).toEqual({
    ok: false,
    result: 'not_configured',
  })
  await save(APP)
  await admin.query('update integrations set verified_at = null where organization_id = $1', [
    owner.organizationId,
  ])
  expect(await testMetaIntegration(deps, owner, { ip: IP })).toEqual({
    ok: true,
    result: 'verified',
  })
  expect((await getMetaIntegration(deps, owner))?.verifiedAt).toBeInstanceOf(Date)

  mock.scenario('html_5xx', { path: '/debug_token' })
  expect(await testMetaIntegration(deps, owner, { ip: IP })).toEqual({
    ok: false,
    result: 'unavailable',
  })
  // the app was removed on Meta's side, say: its secret no longer works
  mock.scenario('default')
  await admin.query(
    "update integrations set config = jsonb_set(config, '{appId}', '\"1000000000000999\"') where organization_id = $1",
    [owner.organizationId],
  )
  expect(await testMetaIntegration(deps, owner, { ip: IP })).toEqual({
    ok: false,
    result: 'rejected',
  })
})

test('"Prova" refused by Meta: the app turns red until a test or a save works (D-1)', async () => {
  await save(APP)
  const view = async () => getMetaIntegration(deps, owner)
  expect((await view())?.rejectedAt).toBeNull()
  // the secret was reset on Meta: the stored one no longer works
  mock.scenario('error', { code: 100, status: 400, path: '/debug_token' })
  expect(await testMetaIntegration(deps, owner, { ip: IP })).toEqual({
    ok: false,
    result: 'rejected',
  })
  expect((await view())?.rejectedAt).toBeInstanceOf(Date)
  expect((await view())?.verifiedAt).toBeNull()
  // Meta not answering says nothing about the app: the red stays
  mock.scenario('html_5xx', { path: '/debug_token' })
  await testMetaIntegration(deps, owner, { ip: IP })
  expect((await view())?.rejectedAt).toBeInstanceOf(Date)
  // it works again: green
  mock.scenario('default')
  expect((await testMetaIntegration(deps, owner, { ip: IP })).ok).toBe(true)
  expect((await view())?.rejectedAt).toBeNull()
  expect((await view())?.verifiedAt).toBeInstanceOf(Date)

  // settings saved again (tried by Meta) clear it too
  mock.scenario('error', { code: 100, status: 400, path: '/debug_token' })
  await testMetaIntegration(deps, owner, { ip: IP })
  expect((await view())?.rejectedAt).toBeInstanceOf(Date)
  mock.scenario('default')
  await save({ ...APP, configId: META_MOCK.app.configId })
  expect((await view())?.rejectedAt).toBeNull()
})

test('a refusal of settings replaced while Meta answered does not mark the new ones (D-1)', async () => {
  await save(APP)
  duringVerify = async () => {
    duringVerify = null
    await save({ appId: APP.appId, businessId: '4000000000000001' })
    // Meta then refuses the settings read before the save
    mock.scenario('error', { code: 100, status: 400, path: '/debug_token' })
  }
  await testMetaIntegration(deps, owner, { ip: IP }).catch(() => undefined)
  const after = await getMetaIntegration(deps, owner)
  expect(after?.businessId).toBe('4000000000000001')
  expect(after?.rejectedAt).toBeNull()
})

test('the activity entries hold field names and outcomes, never a secret', async () => {
  await save(APP)
  await save({ appId: APP.appId, appSecret: 'segreto-sbagliato' }).catch(() => undefined)
  await testMetaIntegration(deps, owner, { ip: IP })
  const { rows } = await admin.query<{ action: string; data: unknown }>(
    "select action, data from audit_log where action like 'integration.meta_%' and organization_id = $1 order by created_at",
    [owner.organizationId],
  )
  expect(rows).toEqual([
    {
      action: 'integration.meta_changed',
      data: { fields: ['appId', 'configId', 'businessId', 'dataUseCheckupDueOn', 'appSecret'] },
    },
    { action: 'integration.meta_tested', data: { ok: true, result: 'verified' } },
  ])
  const all = JSON.stringify(
    (
      await admin.query('select * from audit_log where organization_id = $1', [
        owner.organizationId,
      ])
    ).rows,
  )
  expect(all).not.toContain(APP.appSecret)
  expect(all).not.toContain('segreto-sbagliato')
})
