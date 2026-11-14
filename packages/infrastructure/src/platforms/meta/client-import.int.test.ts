import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  connectWithToken,
  createWorkspace,
  importAccounts,
  listImportable,
  listProfilesWithoutClient,
  undoClientImport,
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
import { createMetaPictureDownloader } from './picture-download.js'
import { createMetaSystemUserConnector } from './system-user-connector.js'

// The pasted token and the import (plan 03 Task 6), against the fake Graph API only. Roles and

let tdb: TestDatabase
let handle: DbHandle
let admin: pg.Client
let mock: MetaMock
let deps: ConnectionsDeps
let owner: OrgActor

const IP = '203.0.113.7'
const REQ = { ip: IP }
const { pages, instagram } = META_MOCK
const platformKey = randomBytes(32)
const keyRing = createKeyRing({ platformKey, clock: systemClock })
const integrations = createIntegrationStore({ keyRing })
const logger = createLogger({ service: 'web', level: 'error' })

function session(actor: OrgActor): AuthSessionInfo {
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
  }
}

async function connect(): Promise<string> {
  const result = await connectWithToken(
    deps,
    owner,
    session(owner),
    { kind: 'meta_system_user', token: META_MOCK.tokens.systemUser },
    REQ,
  )
  return result.connection?.id ?? ''
}

const ALL = [pages.withInstagram, instagram.ofPage, pages.withoutInstagram, instagram.agencyOnly]

const rows = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
  (await admin.query<T>(sql, params)).rows

const workspacesOf = (organizationId: string) =>
  rows<{ id: string; name: string; slug: string; archived: boolean }>(
    'select id, name, slug, archived_at is not null as archived from workspaces where organization_id = $1 order by slug',
    [organizationId],
  )

const assignmentsOf = (organizationId: string) =>
  rows<{ workspace_id: string; external_id: string }>(
    `select wa.workspace_id, a.external_id from workspace_accounts wa
       join social_accounts a on a.id = wa.account_id
      where wa.organization_id = $1 order by a.external_id`,
    [organizationId],
  )

const actions = async (organizationId: string) =>
  (
    await rows<{ action: string }>(
      'select action from audit_log where organization_id = $1 order by created_at, action',
      [organizationId],
    )
  ).map((r) => r.action)

async function agencyWithOwner(): Promise<OrgActor> {
  const { organizationId, userId } = await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const user = await s.user()
    await s.member(org, user, 'owner')
    return { organizationId: org, userId: user }
  })
  await deps.uow.run({ organizationId, userId }, async (tx) => {
    await keyRing.createOrganizationKey(tx, organizationId)
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

async function memberOf(organizationId: string, workspaceId?: string): Promise<OrgActor> {
  const userId = await seed(tdb.runtimeUrl, async (s) => {
    const user = await s.user()
    await s.member(organizationId, user, 'member')
    if (workspaceId) await s.workspaceMember(organizationId, workspaceId, user, 'manager')
    return user
  })
  return {
    userId,
    platformRole: null,
    organizationId,
    orgRole: 'member',
    memberships: new Map(workspaceId ? [[workspaceId, 'manager' as const]] : []),
  }
}

const setLimits = (organizationId: string, limits: Record<string, number>) =>
  withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query('update organizations set limits = $2 where id = $1', [
      organizationId,
      JSON.stringify(limits),
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
  const connector = createMetaSystemUserConnector({
    client,
    integrations,
    pictures: createMetaPictureDownloader({ mode: 'mock', mockUrl: mock.url }),
  })
  deps = {
    uow: createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger }),
    clock: systemClock,
    ids: uuidV7Generator,
    tokens: createConnectionTokens({ keyRing }),
    connectors: { meta_system_user: connector, meta_business_login: connector },
    queue: { send: () => Promise.resolve('job') },
    logger,
  }
}, 120_000)

beforeEach(async () => {
  owner = await agencyWithOwner()
})

afterAll(async () => {
  await mock.stop()
  await admin.end()
  await handle.close()
  await tdb.stop()
})

test('«Crea N clienti»: the import creates each client with its profile, and records it', async () => {
  const connectionId = await connect()
  const result = await importAccounts(
    deps,
    owner,
    {
      connectionId,
      externalIds: ALL,
      newWorkspaces: [
        { name: 'Forno Luce', externalIds: [instagram.ofPage, pages.withInstagram] },
        { name: 'Studio Bianchi', externalIds: [pages.withoutInstagram] },
      ],
    },
    REQ,
  )
  const { organizationId } = owner
  const spaces = await workspacesOf(organizationId)
  expect(spaces.map((w) => [w.name, w.slug, w.archived])).toEqual([
    ['Forno Luce', 'forno-luce', false],
    ['Studio Bianchi', 'studio-bianchi', false],
  ])
  const forno = spaces[0]?.id
  const studio = spaces[1]?.id
  expect(await assignmentsOf(organizationId)).toEqual(
    [
      { workspace_id: forno, external_id: instagram.ofPage },
      { workspace_id: forno, external_id: pages.withInstagram },
      { workspace_id: studio, external_id: pages.withoutInstagram },
    ].sort((a, b) => a.external_id.localeCompare(b.external_id)),
  )
  expect(result.created.map((w) => w.name)).toEqual(['Forno Luce', 'Studio Bianchi'])
  expect(result.undo.workspaceIds.sort()).toEqual([forno, studio].sort())
  const log = await actions(organizationId)
  expect(log.filter((a) => a === 'workspace.created')).toHaveLength(2)
  expect(log.filter((a) => a === 'account.assigned')).toHaveLength(3)
  expect(log).toContain('accounts.imported')
  // the agency's own Instagram, imported without a client, waits in «Sistemali»
  const left = await listProfilesWithoutClient(deps, owner)
  expect(left.map((p) => p.accounts.map((a) => a.externalId))).toEqual([[instagram.agencyOnly]])
})

test('«Aggiungi a un cliente esistente»; a client of another agency is not found', async () => {
  const connectionId = await connect()
  const { organizationId } = owner
  const existing = await seed(tdb.runtimeUrl, (s) => s.workspace(organizationId, { name: 'Bar' }))
  const result = await importAccounts(
    deps,
    owner,
    {
      connectionId,
      externalIds: [instagram.agencyOnly],
      assignTo: [{ workspaceId: existing, externalIds: [instagram.agencyOnly] }],
    },
    REQ,
  )
  expect(await assignmentsOf(organizationId)).toEqual([
    { workspace_id: existing, external_id: instagram.agencyOnly },
  ])
  expect(result.undo.assignments).toEqual([
    { workspaceId: existing, accountId: result.accounts[0]?.id },
  ])

  const other = await agencyWithOwner()
  const foreign = await seed(tdb.runtimeUrl, (s) => s.workspace(other.organizationId))
  await expect(
    importAccounts(
      deps,
      owner,
      {
        connectionId,
        externalIds: [pages.withoutInstagram],
        assignTo: [{ workspaceId: foreign, externalIds: [pages.withoutInstagram] }],
      },
      REQ,
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  // nothing of the refused import stays
  const imported = await rows(
    'select 1 from social_accounts where organization_id = $1 and external_id = $2',
    [organizationId, pages.withoutInstagram],
  )
  expect(imported).toEqual([])
})

test('a client may only take accounts of the same import, each once', async () => {
  const connectionId = await connect()
  const bad = [
    {
      externalIds: [pages.withoutInstagram],
      newWorkspaces: [{ name: 'Altro', externalIds: [instagram.agencyOnly] }],
    },
    {
      externalIds: [pages.withoutInstagram],
      newWorkspaces: [
        { name: 'Uno', externalIds: [pages.withoutInstagram] },
        { name: 'Due', externalIds: [pages.withoutInstagram] },
      ],
    },
    { externalIds: [pages.withoutInstagram], newWorkspaces: [{ name: 'Tre', externalIds: [] }] },
    {
      externalIds: [pages.withoutInstagram],
      newWorkspaces: [{ name: 'x', externalIds: [pages.withoutInstagram] }],
    },
  ]
  for (const input of bad)
    await expect(
      importAccounts(deps, owner, { connectionId, ...input }, REQ),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  expect(await workspacesOf(owner.organizationId)).toEqual([])
})

test('«Annulla» takes away the clients and assignments of that import, and only those', async () => {
  const connectionId = await connect()
  const { organizationId } = owner
  const before = await seed(tdb.runtimeUrl, (s) => s.workspace(organizationId, { name: 'Prima' }))
  await importAccounts(
    deps,
    owner,
    {
      connectionId,
      externalIds: [pages.withoutInstagram],
      assignTo: [{ workspaceId: before, externalIds: [pages.withoutInstagram] }],
    },
    REQ,
  )
  const result = await importAccounts(
    deps,
    owner,
    {
      connectionId,
      externalIds: [pages.withInstagram, instagram.ofPage, instagram.agencyOnly],
      newWorkspaces: [{ name: 'Forno Luce', externalIds: [pages.withInstagram, instagram.ofPage] }],
      assignTo: [{ workspaceId: before, externalIds: [instagram.agencyOnly] }],
    },
    REQ,
  )
  await undoClientImport(deps, owner, result.undo, REQ)

  const spaces = await workspacesOf(organizationId)
  expect(spaces.map((w) => [w.name, w.archived]).sort()).toEqual([
    ['Forno Luce', true],
    ['Prima', false],
  ])
  // the assignment of the first import stays; the accounts stay imported
  expect(await assignmentsOf(organizationId)).toEqual([
    { workspace_id: before, external_id: pages.withoutInstagram },
  ])
  const left = await listProfilesWithoutClient(deps, owner)
  expect(left.map((p) => p.accounts.map((a) => a.externalId))).toEqual([
    [instagram.ofPage, pages.withInstagram],
    [instagram.agencyOnly],
  ])
  const log = await actions(organizationId)
  expect(log).toContain('workspace.archived')
  expect(log.filter((a) => a === 'account.unassigned')).toHaveLength(3)
  // a second «Annulla» changes nothing
  await undoClientImport(deps, owner, result.undo, REQ)
  expect((await actions(organizationId)).length).toBe(log.length)
})

test('«Annulla» leaves a client that has people working in it', async () => {
  const connectionId = await connect()
  const result = await importAccounts(
    deps,
    owner,
    {
      connectionId,
      externalIds: [pages.withoutInstagram],
      newWorkspaces: [{ name: 'Studio', externalIds: [pages.withoutInstagram] }],
    },
    REQ,
  )
  const id = result.undo.workspaceIds[0] ?? ''
  await memberOf(owner.organizationId, id)
  await expect(undoClientImport(deps, owner, result.undo, REQ)).rejects.toMatchObject({
    code: 'CONFLICT',
  })
  expect((await workspacesOf(owner.organizationId)).map((w) => w.archived)).toEqual([false])
})

test('a client from a profile already imported', async () => {
  const connectionId = await connect()
  const { accounts } = await importAccounts(
    deps,
    owner,
    { connectionId, externalIds: [pages.withInstagram, instagram.ofPage] },
    REQ,
  )
  const created = await createWorkspace(
    deps,
    owner,
    { name: 'Forno Luce', accountIds: accounts.map((a) => a.id) },
    REQ,
  )
  expect(created).toMatchObject({ name: 'Forno Luce', slug: 'forno-luce' })
  expect((await assignmentsOf(owner.organizationId)).map((a) => a.workspace_id)).toEqual([
    created.id,
    created.id,
  ])
  expect(await listProfilesWithoutClient(deps, owner)).toEqual([])
  // an account that does not exist, or of another agency, creates nothing
  const other = await agencyWithOwner()
  await expect(
    createWorkspace(deps, other, { name: 'Furbo', accountIds: [accounts[0]?.id ?? ''] }, REQ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect(await workspacesOf(other.organizationId)).toEqual([])
})

test('the workspaces limit reached imports and creates nothing', async () => {
  const connectionId = await connect()
  const { organizationId } = owner
  await setLimits(organizationId, { workspaces: 1 })
  await expect(
    importAccounts(
      deps,
      owner,
      {
        connectionId,
        externalIds: [pages.withoutInstagram, instagram.agencyOnly],
        newWorkspaces: [
          { name: 'Uno', externalIds: [pages.withoutInstagram] },
          { name: 'Due', externalIds: [instagram.agencyOnly] },
        ],
      },
      REQ,
    ),
  ).rejects.toMatchObject({ code: 'LIMIT_REACHED', details: { limit: 1 } })
  expect(await workspacesOf(organizationId)).toEqual([])
  expect(
    await rows('select 1 from social_accounts where organization_id = $1', [organizationId]),
  ).toEqual([])
})

test('two profiles with the same name get two slugs', async () => {
  const connectionId = await connect()
  await importAccounts(
    deps,
    owner,
    {
      connectionId,
      externalIds: [pages.withoutInstagram, instagram.agencyOnly],
      newWorkspaces: [
        { name: 'Gelateria', externalIds: [pages.withoutInstagram] },
        { name: 'Gelateria', externalIds: [instagram.agencyOnly] },
      ],
    },
    REQ,
  )
  const slugs = (await workspacesOf(owner.organizationId)).map((w) => w.slug)
  expect(new Set(slugs).size).toBe(2)
  expect(slugs).toContain('gelateria')
})

test('an account already in a client is marked, so it is not proposed', async () => {
  const connectionId = await connect()
  await importAccounts(
    deps,
    owner,
    {
      connectionId,
      externalIds: [pages.withoutInstagram, instagram.agencyOnly],
      newWorkspaces: [{ name: 'Studio', externalIds: [pages.withoutInstagram] }],
    },
    REQ,
  )
  const { accounts } = await listImportable(deps, owner, { connectionId })
  const inClient = Object.fromEntries(accounts.map((a) => [a.externalId, a.inClient]))
  expect(inClient[pages.withoutInstagram]).toBe(true)
  expect(inClient[instagram.agencyOnly]).toBe(false)
  expect(inClient[instagram.ofPage]).toBe(false)
})

test('a Member neither sees «Sistemali» nor creates a client from a profile', async () => {
  const connectionId = await connect()
  const { accounts } = await importAccounts(
    deps,
    owner,
    { connectionId, externalIds: [instagram.agencyOnly] },
    REQ,
  )
  const member = await memberOf(owner.organizationId)
  await expect(listProfilesWithoutClient(deps, member)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await expect(
    createWorkspace(deps, member, { name: 'Nuovo', accountIds: [accounts[0]?.id ?? ''] }, REQ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  await expect(
    undoClientImport(deps, member, { workspaceIds: [], assignments: [] }, REQ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
})
