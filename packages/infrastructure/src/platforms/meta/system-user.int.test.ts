import { randomBytes, randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  connectWithToken,
  importAccounts,
  listConnections,
  listImportable,
  type AuthSessionInfo,
  type ConnectionsDeps,
} from '@app/application'
import type { OrgActor } from '@app/domain'
import { META_MOCK, startMetaMock, type MetaMock } from '@app/meta-mock'
import { createKeyRing } from '../../crypto/key-ring.js'
import { createConnectionTokens } from '../../db/accounts/connection-tokens.js'
import { createDb } from '../../db/client.js'
import type { DbHandle } from '../../db/client.js'
import { createIntegrationStore } from '../../db/integrations/integration-store.js'
import { createUnitOfWork } from '../../db/unit-of-work.js'
import { createLogger } from '../../logging/logger.js'
import { systemClock } from '../../system/clock.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, withScope } from '../../testing/index.js'
import type { TestDatabase } from '../../testing/index.js'
import { createMetaGraphClient } from './graph-client.js'
import { createMetaSystemUserConnector } from './system-user-connector.js'

// The pasted token and the import (plan 03 Task 6), against the fake Graph API only. Roles and
// other agencies are in the HTTP matrix and the isolation battery, not here.

let tdb: TestDatabase
let handle: DbHandle
let admin: pg.Client
let mock: MetaMock
let deps: ConnectionsDeps
let owner: OrgActor
let logs: string[]
let queued: { name: string; data: unknown; opts: unknown }[]

const IP = '203.0.113.7'
const TOKEN = META_MOCK.tokens.systemUser
const { pages, instagram } = META_MOCK
const platformKey = randomBytes(32)
const keyRing = createKeyRing({ platformKey, clock: systemClock })
const integrations = createIntegrationStore({ keyRing })
const logger = createLogger({
  service: 'web',
  level: 'debug',
  destination: new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString())
      done()
    },
  }),
})

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

const connect = (token: string = TOKEN, over: Partial<AuthSessionInfo> = {}) =>
  connectWithToken(
    deps,
    owner,
    session(owner, over),
    { kind: 'meta_system_user', token },
    { ip: IP },
  )

const importing = (connectionId: string, externalIds: string[]) =>
  importAccounts(deps, owner, { connectionId, externalIds }, { ip: IP })

const rows = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
  (await admin.query<T>(sql, params)).rows

/** The ids of the case's agency in `table`: other tests share the database. */
const ownRows = (table: string, more = '') =>
  rows(`select * from ${table} where organization_id = $1 ${more}`, [owner.organizationId])

async function agencyWithOwner(opts: { app?: boolean } = {}): Promise<OrgActor> {
  const { organizationId, userId } = await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const user = await s.user()
    await s.member(org, user, 'owner')
    return { organizationId: org, userId: user }
  })
  await deps.uow.run({ organizationId, userId }, async (tx) => {
    await keyRing.createOrganizationKey(tx, organizationId)
    if (opts.app !== false)
      await integrations.replace(tx, organizationId, 'meta', {
        config: {
          appId: META_MOCK.app.id,
          configId: null,
          businessId: null,
          dataUseCheckupDueOn: null,
        },
        secret: META_MOCK.app.secret,
        updatedBy: userId,
        expectedVersion: null,
        verifiedAt: new Date(),
      })
  })
  return { userId, platformRole: null, organizationId, orgRole: 'owner', memberships: new Map() }
}

/** A second connection of the agency that sees what the system user sees (choice 2). */
async function secondConnection(): Promise<string> {
  const { organizationId, userId } = owner
  return deps.uow.run({ organizationId, userId }, async (tx) => {
    const id = randomUUID()
    const sealed = await deps.tokens.seal(tx, { organizationId, id }, TOKEN)
    await tx.connections.create({
      id,
      organizationId,
      kind: 'meta_business_login',
      externalUserId: '4999999999999999',
      connectedBy: userId,
      ...sealed,
      expiresAt: null,
    })
    return id
  })
}

// limits change only in the system scope, as the platform sets them
const setLimit = (organizationId: string, limit: number) =>
  withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query('update organizations set limits = $2 where id = $1', [
      organizationId,
      JSON.stringify({ social_accounts: limit }),
    ]),
  )

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 4, applicationName: 'test' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  mock = await startMetaMock()
  const client = createMetaGraphClient({
    mode: 'mock',
    version: 'v25.0',
    baseUrl: mock.url,
    clock: systemClock,
    logger,
    timeoutMs: 500,
    retryBaseDelayMs: 1,
  })
  const connector = createMetaSystemUserConnector({ client, integrations })
  deps = {
    uow: createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger }),
    clock: systemClock,
    ids: uuidV7Generator,
    tokens: createConnectionTokens({ keyRing }),
    connectors: { meta_system_user: connector, meta_business_login: connector },
    queue: {
      send: (name, data, opts) => {
        queued.push({ name, data, opts })
        return Promise.resolve('job')
      },
    },
    logger,
  }
}, 120_000)

beforeEach(async () => {
  logs = []
  queued = []
  owner = await agencyWithOwner()
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

test('a valid token: green permissions, every assigned account once, pending', async () => {
  const result = await connect(` ${TOKEN}\n`)
  expect(result.outcome).toBe('connected')
  expect(result.permissions).toHaveLength(6)
  expect(result.permissions.every((p) => p.granted)).toBe(true)
  // Forno Luce's Instagram comes from the page and from the assigned ones: listed once, paired
  expect(result.accounts.map((a) => [a.platform, a.externalId, a.pageId, a.state])).toEqual([
    ['facebook', pages.withInstagram, pages.withInstagram, 'to_import'],
    ['instagram', instagram.ofPage, pages.withInstagram, 'to_import'],
    ['facebook', pages.withoutInstagram, pages.withoutInstagram, 'to_import'],
    ['instagram', instagram.agencyOnly, null, 'to_import'],
    ['instagram', instagram.shared, null, 'to_import'],
  ])
  expect(result.connection).toMatchObject({ kind: 'meta_system_user', status: 'pending' })
  expect(result.connection?.expiresAt).toBeNull()
  const [stored] = await rows<{
    external_user_id: string
    token_enc: string
    connected_by: string
  }>(
    'select external_user_id, token_enc, connected_by from account_connections where organization_id = $1',
    [owner.organizationId],
  )
  expect(stored).toMatchObject({
    external_user_id: META_MOCK.users.systemUser,
    connected_by: owner.userId,
  })
  expect(stored?.token_enc).not.toContain(TOKEN)
  expect(
    await rows('select data from audit_log where action = $1 and organization_id = $2', [
      'connection.created',
      owner.organizationId,
    ]),
  ).toEqual([{ data: { kind: 'meta_system_user' } }])
})

test('a page Meta gives without its token is shown as not importable: no role on it', async () => {
  mock.scenario('page_without_token', { pageId: pages.withoutInstagram })
  const { accounts, connection } = await connect()
  expect(accounts.find((a) => a.externalId === pages.withoutInstagram)).toMatchObject({
    state: 'not_importable',
    problem: 'role_missing',
  })
  await expect(importing(connection?.id ?? '', [pages.withoutInstagram])).rejects.toMatchObject({
    code: 'VALIDATION',
    details: { field: 'externalIds' },
  })
})

test('a missing permission is shown red and nothing is saved', async () => {
  mock.scenario('permission_missing', { permission: 'business_management' })
  const result = await connect()
  expect(result).toMatchObject({ outcome: 'permissions_missing', connection: null, accounts: [] })
  expect(result.permissions.filter((p) => !p.granted)).toEqual([
    { name: 'business_management', granted: false },
  ])
  expect(await ownRows('account_connections')).toEqual([])
})

test('without a recent reauth, or with a token Meta refuses, nothing is saved', async () => {
  await expect(connect(TOKEN, { reauthenticatedAt: null })).rejects.toMatchObject({
    code: 'REAUTH_REQUIRED',
  })
  await expect(connect('EAAtoken-che-non-esiste-1234567890')).rejects.toMatchObject({
    code: 'VALIDATION',
    details: { field: 'token' },
  })
  mock.scenario('token_expired')
  await expect(connect()).rejects.toMatchObject({ code: 'VALIDATION' })
  expect(await ownRows('account_connections')).toEqual([])
})

test('a token pasted while Meta refuses the app: nothing saved, the app turns red (D-1)', async () => {
  const rejectedAt = async () =>
    (await ownRows('integrations', "and kind = 'meta'"))[0]?.rejected_at as Date | null
  expect(await rejectedAt()).toBeNull()
  // the App Secret was reset on Meta: debug_token refuses the app
  mock.scenario('error', { code: 100, status: 400, path: '/debug_token' })
  await expect(connect()).rejects.toMatchObject({ code: 'CONFLICT' })
  expect(await ownRows('account_connections')).toEqual([])
  expect(await rejectedAt()).toBeInstanceOf(Date)
})

test('an agency without its Meta app is told to set it first', async () => {
  owner = await agencyWithOwner({ app: false })
  await expect(connect()).rejects.toMatchObject({ code: 'CONFLICT' })
})

test('import: the connection becomes active, accounts stay out of every workspace', async () => {
  const { connection } = await connect()
  const id = connection?.id ?? ''
  const result = await importing(id, [pages.withInstagram, instagram.ofPage])
  expect(result.connection.status).toBe('active')
  expect(result.accounts.map((a) => [a.platform, a.name, a.active, a.health])).toEqual([
    ['facebook', 'Forno Luce', true, null],
    ['instagram', 'Forno Luce', true, null],
  ])
  expect(await ownRows('workspace_accounts')).toEqual([])
  const live = await listImportable(deps, owner, { connectionId: id })
  expect(live.accounts.filter((a) => a.state === 'imported').map((a) => a.externalId)).toEqual([
    pages.withInstagram,
    instagram.ofPage,
  ])
  expect(
    await rows('select data from audit_log where action = $1 and organization_id = $2', [
      'accounts.imported',
      owner.organizationId,
    ]),
  ).toEqual([{ data: { count: 2 } }])
  // the first health check, ids only (§8.2, plan 03 Task 10)
  expect(queued).toEqual([
    {
      name: 'accounts.health',
      data: { organizationId: owner.organizationId, connectionId: id },
      opts: { singletonKey: id },
    },
  ])
})

test('the connections of the agency, a pending one too, never with their token', async () => {
  expect(await listConnections(deps, owner)).toEqual([])
  const { connection } = await connect()
  const listed = await listConnections(deps, owner)
  expect(listed).toEqual([
    {
      id: connection?.id,
      kind: 'meta_system_user',
      status: 'pending',
      expiresAt: null,
      createdAt: expect.any(Date) as Date,
    },
  ])
})

test('an external id the connection does not see is refused', async () => {
  const { connection } = await connect()
  await expect(importing(connection?.id ?? '', [instagram.clientOnly])).rejects.toMatchObject({
    code: 'VALIDATION',
  })
  expect(await ownRows('social_accounts')).toEqual([])
})

test('an import over the social_accounts limit is refused with the limit code', async () => {
  const { connection } = await connect()
  await setLimit(owner.organizationId, 1)
  await expect(
    importing(connection?.id ?? '', [pages.withInstagram, instagram.ofPage]),
  ).rejects.toMatchObject({ code: 'LIMIT_REACHED', details: { limit: 1 } })
  // importing again what is already active takes no new slot
  await importing(connection?.id ?? '', [pages.withInstagram])
  await importing(connection?.id ?? '', [pages.withInstagram])
})

test('two imports racing for the last slot: only one passes', async () => {
  const { connection } = await connect()
  await setLimit(owner.organizationId, 1)
  const outcomes = await Promise.allSettled([
    importing(connection?.id ?? '', [pages.withInstagram]),
    importing(connection?.id ?? '', [instagram.agencyOnly]),
  ])
  expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(outcomes.find((o) => o.status === 'rejected')).toMatchObject({
    reason: { code: 'LIMIT_REACHED' },
  })
  expect(await ownRows('social_accounts', 'and active')).toHaveLength(1)
})

test('an account of a working connection stays there; one of an expired connection moves', async () => {
  const { connection } = await connect()
  const first = connection?.id ?? ''
  await importing(first, [instagram.shared])
  const second = await secondConnection()
  const seen = await listImportable(deps, owner, { connectionId: second })
  expect(seen.accounts.find((a) => a.externalId === instagram.shared)?.state).toBe(
    'other_connection',
  )
  await expect(importing(second, [instagram.shared])).rejects.toMatchObject({ code: 'CONFLICT' })

  await admin.query(`update account_connections set status = 'expired' where id = $1`, [first])
  // red under the expired connection: the new owner has not checked it yet
  await admin.query(
    `update social_accounts set health = 'error', health_message = 'scaduto'
      where organization_id = $1`,
    [owner.organizationId],
  )
  const moved = await importing(second, [instagram.shared])
  expect(moved.accounts[0]).toMatchObject({
    connectionId: second,
    health: null,
    healthMessage: null,
  })
  // imported again by the same owner, an account keeps its health
  await importing(second, [instagram.shared])
  await admin.query(`update social_accounts set health = 'ok' where organization_id = $1`, [
    owner.organizationId,
  ])
  expect((await importing(second, [instagram.shared])).accounts[0]?.health).toBe('ok')
  await expect(listImportable(deps, owner, { connectionId: first })).rejects.toMatchObject({
    code: 'CONFLICT',
  })
})

test('the same system user twice: one connection, the new token, still active', async () => {
  const { connection } = await connect()
  const id = connection?.id ?? ''
  await importing(id, [pages.withInstagram])
  const [before] = await rows<{ token_enc: string }>(
    'select token_enc from account_connections where id = $1',
    [id],
  )
  const again = await connect()
  expect(again).toMatchObject({ outcome: 'replaced', connection: { id, status: 'active' } })
  expect(again.accounts.find((a) => a.externalId === pages.withInstagram)?.state).toBe('imported')
  const after = await rows<{ token_enc: string; last_refreshed_at: Date | null }>(
    'select token_enc, last_refreshed_at from account_connections where organization_id = $1',
    [owner.organizationId],
  )
  expect(after).toHaveLength(1)
  expect(after[0]?.token_enc).not.toBe(before?.token_enc)
  expect(after[0]?.last_refreshed_at).toBeInstanceOf(Date)
  expect(
    await rows('select action from audit_log where entity_id = $1 order by created_at', [id]),
  ).toEqual([
    { action: 'connection.created' },
    { action: 'accounts.imported' },
    { action: 'connection.token_replaced' },
  ])
})

test('Meta not answering: nothing saved, and the error says so', async () => {
  mock.scenario('html_5xx', { path: '/me/accounts' })
  await expect(connect()).rejects.toMatchObject({ code: 'PLATFORM_UNAVAILABLE' })
  expect(await ownRows('account_connections')).toEqual([])
})

test('the token is in no answer, activity entry or log line', async () => {
  const result = await connect()
  const id = result.connection?.id ?? ''
  const imported = await importing(id, [pages.withInstagram])
  const live = await listImportable(deps, owner, { connectionId: id })
  for (const answer of [result, imported, live]) expect(JSON.stringify(answer)).not.toContain(TOKEN)
  const audit = await ownRows('audit_log')
  expect(JSON.stringify(audit)).not.toContain(TOKEN)
  expect(logs.length).toBeGreaterThan(0)
  expect(logs.join('\n')).not.toContain(TOKEN)
  // the page tokens Meta hands out with me/accounts are never kept either
  expect(JSON.stringify([result, imported, live, logs])).not.toContain('mock-page-token')
})
