import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  getAgencyTelegramBot,
  removeAgencyTelegramBot,
  replaceAgencyTelegramBot,
  type AgencyTelegramBotDeps,
  type AuthSessionInfo,
} from '@app/application'
import type { OrgActor } from '@app/domain'
import { TELEGRAM_MOCK, startTelegramMock, type TelegramMock } from '@app/telegram-mock'
import { createKeyRing } from '../crypto/key-ring.js'
import { createDb } from '../db/client.js'
import type { DbHandle } from '../db/client.js'
import { createIntegrationStore } from '../db/integrations/integration-store.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createLogger } from '../logging/logger.js'
import { systemClock } from '../system/clock.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { seed, startTestDatabase } from '../testing/index.js'
import type { TestDatabase } from '../testing/index.js'
import { createTelegramBotApi } from './telegram-bot-api.js'

// Impostazioni → Integrazioni → Telegram (plan 08 Task 7), against the fake Bot API only: the
// guards of a change. Roles (Admin read only, Member 404) are in the HTTP matrix.

let tdb: TestDatabase
let handle: DbHandle
let admin: pg.Client
let mock: TelegramMock
let deps: AgencyTelegramBotDeps
let owner: OrgActor
let ownerOfB: OrgActor
let getMeCalls: number
let duringGetMe: (() => Promise<void>) | null

const logger = createLogger({ service: 'web', level: 'error' })
const IP = '203.0.113.7'
const AGENCY_BOT = TELEGRAM_MOCK.bots.agency.token
const platformKey = randomBytes(32)

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

const save = (actor = owner, token = AGENCY_BOT) =>
  replaceAgencyTelegramBot(deps, actor, session(actor), { token }, { ip: IP })

const auditRows = async (action: string, actor = owner) =>
  (
    await admin.query<{ data: Record<string, unknown> }>(
      'select data from audit_log where action = $1 and organization_id = $2 order by created_at',
      [action, actor.organizationId],
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

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'test' })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  mock = await startTelegramMock()
  const real = createTelegramBotApi({ baseUrl: new URL(mock.url), timeoutMs: 500 })
  deps = {
    uow: createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger }),
    clock: systemClock,
    integrations: createIntegrationStore({
      keyRing: createKeyRing({ platformKey, clock: systemClock }),
    }),
    telegram: {
      async getMe(token, signal) {
        getMeCalls += 1
        await duringGetMe?.()
        return real.getMe(token, signal)
      },
    },
  }
}, 120_000)

beforeEach(async () => {
  getMeCalls = 0
  duringGetMe = null
  // every test its own bot: one bot serves one agency only
  await admin.query("delete from integrations where kind = 'telegram'")
  owner = await agencyWithOwner()
  ownerOfB = await agencyWithOwner()
})

afterEach(() => {
  mock.reset()
})

afterAll(async () => {
  await mock.stop()
  await admin.end()
  await handle.close()
  await tdb.stop()
})

test('the Owner saves the bot: tried with Telegram, named in the activity, never the token', async () => {
  const view = await save()
  expect(view).toMatchObject({ botUsername: 'agenzia_mock_bot', rejectedAt: null })
  expect(JSON.stringify(view)).not.toContain(AGENCY_BOT)
  expect(await getAgencyTelegramBot(deps, owner)).toMatchObject({
    botUsername: 'agenzia_mock_bot',
  })
  expect(await getAgencyTelegramBot(deps, ownerOfB)).toBeNull()
  const rows = await auditRows('integration.telegram_changed')
  expect(rows.map((r) => r.data)).toEqual([{ botUsername: 'agenzia_mock_bot' }])
})

test('without a recent reauth: neither a change nor a removal, Telegram never called', async () => {
  const stale = session(owner, { reauthenticatedAt: null })
  await expect(
    replaceAgencyTelegramBot(deps, owner, stale, { token: AGENCY_BOT }, { ip: IP }),
  ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' })
  expect(getMeCalls).toBe(0)
  await save()
  await expect(removeAgencyTelegramBot(deps, owner, stale, { ip: IP })).rejects.toMatchObject({
    code: 'REAUTH_REQUIRED',
  })
  expect(await getAgencyTelegramBot(deps, owner)).not.toBeNull()
})

test('Telegram down is not a refusal, and nothing is saved', async () => {
  mock.unavailable({ times: 1 })
  await expect(save()).rejects.toMatchObject({ code: 'PLATFORM_UNAVAILABLE' })
  expect(await getAgencyTelegramBot(deps, owner)).toBeNull()
})

test('a bot saved by someone else while Telegram answered stays: the late save is a conflict', async () => {
  duringGetMe = async () => {
    duringGetMe = null
    await save()
  }
  await expect(save()).rejects.toMatchObject({ code: 'CONFLICT' })
  expect(await auditRows('integration.telegram_changed')).toHaveLength(1)
})

test('an Owner demoted while Telegram answered saves nothing', async () => {
  duringGetMe = async () => {
    await admin.query(
      "update organization_members set role = 'admin' where organization_id = $1 and user_id = $2",
      [owner.organizationId, owner.userId],
    )
  }
  await expect(save()).rejects.toMatchObject({ code: 'FORBIDDEN' })
  expect(await getAgencyTelegramBot(deps, owner)).toBeNull()
})

test('the bot of one agency cannot be saved by another', async () => {
  await save()
  await expect(save(ownerOfB)).rejects.toMatchObject({ code: 'CONFLICT' })
  expect(await getAgencyTelegramBot(deps, ownerOfB)).toBeNull()
  expect(await getAgencyTelegramBot(deps, owner)).toMatchObject({
    botUsername: 'agenzia_mock_bot',
  })
})

test('the removal forgets the bot and says so in the activity; nothing set, nothing done', async () => {
  await removeAgencyTelegramBot(deps, owner, session(owner), { ip: IP })
  expect(await auditRows('integration.telegram_removed')).toHaveLength(0)
  await save()
  await removeAgencyTelegramBot(deps, owner, session(owner), { ip: IP })
  expect(await getAgencyTelegramBot(deps, owner)).toBeNull()
  const rows = await auditRows('integration.telegram_removed')
  expect(rows.map((r) => r.data)).toEqual([{ botUsername: 'agenzia_mock_bot' }])
  // the bot is free again for another agency
  expect(await save(ownerOfB)).toMatchObject({ botUsername: 'agenzia_mock_bot' })
})
