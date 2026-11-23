import { MODULES, type Logger, type NewNotification, type UnitOfWork } from '@app/application'
import { DEFAULT_NOTIFICATION_SETTINGS } from '@app/domain'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, withScope, type TestDatabase } from '../../testing/index.js'
import { createDb, type DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'

// The notifications' part of an anonymization (§10.4, plan 08 Task 4): the person's links,
// preferences, settings and notifications go in every agency; another person's stay. Repeatable.
let tdb: TestDatabase
let handle: DbHandle
let uow: UnitOfWork
const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
}
let orgA: string, orgB: string, gone: string, stays: string

const handler = MODULES.find((m) => m.name === 'notifications')?.onUserAnonymized

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 4, applicationName: 'notifications-anonymize-test' })
  uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger })
  ;({ orgA, orgB, gone, stays } = await seed(tdb.runtimeUrl, async (s) => {
    const orgA = await s.organization()
    const orgB = await s.organization()
    const gone = await s.user()
    const stays = await s.user()
    await s.member(orgA, gone, 'admin')
    await s.member(orgB, gone, 'owner')
    await s.member(orgA, stays, 'owner')
    return { orgA, orgB, gone, stays }
  }))
})

afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

const notificationOf = (userId: string, organizationId: string | null): NewNotification => ({
  organizationId,
  userId,
  eventId: uuidV7Generator.newId(),
  kind: organizationId === null ? 'system.worker_down' : 'post.target_failed',
  level: 'error',
  workspaceId: null,
  payload: {},
  deliveries: [
    { channel: 'panel', status: 'sent', nextAttemptAt: null, error: null },
    { channel: 'email', status: 'pending', nextAttemptAt: new Date(), error: null },
  ],
})

async function personalData(userId: string) {
  return withScope(tdb.runtimeUrl, { kind: 'system' }, async (c) => {
    const count = async (table: string) =>
      Number(
        (
          await c.query<{ n: string }>(`select count(*) as n from ${table} where user_id = $1`, [
            userId,
          ])
        ).rows[0]?.n,
      )
    return {
      notifications: await count('notifications'),
      deliveries: await count('notification_deliveries'),
      prefs: await count('notification_prefs'),
      settings: await count('notification_settings'),
      telegram: await count('telegram_links'),
    }
  })
}

async function seedPerson(userId: string, organizations: readonly (string | null)[]) {
  await uow.runAsSystem('test: notifications of a person', async (tx) => {
    for (const organizationId of organizations)
      await tx.notifications.create(notificationOf(userId, organizationId))
    await tx.notificationPrefs.saveSettings(userId, {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      minLevel: 'warning',
    })
    await tx.notificationPrefs.setPref(userId, 'post.confirmed', { channels: ['panel'] })
  })
  await withScope(tdb.runtimeUrl, { kind: 'system' }, async (c) => {
    for (const organizationId of organizations)
      await c.query(
        `insert into telegram_links (id, organization_id, user_id, chat_id, linked_at)
         values ($1, $2, $3, $4, now())`,
        [uuidV7Generator.newId(), organizationId, userId, Math.floor(Math.random() * 1e9)],
      )
  })
}

test('the person’s links, preferences, settings and notifications go everywhere; twice is fine', async () => {
  expect(handler).toBeDefined()
  // in both agencies and with the platform's bot
  await seedPerson(gone, [orgA, orgB, null])
  await seedPerson(stays, [orgA])
  const before = await personalData(stays)

  await handler?.({ userId: gone, source: 'system' }, { uow })
  // an interrupted anonymization runs every handler again
  await handler?.({ userId: gone, source: 'system' }, { uow })

  expect(await personalData(gone)).toEqual({
    notifications: 0,
    deliveries: 0,
    prefs: 0,
    settings: 0,
    telegram: 0,
  })
  expect(before).toEqual({
    notifications: 1,
    deliveries: 2,
    prefs: 1,
    settings: 1,
    telegram: 1,
  })
  expect(await personalData(stays)).toEqual(before)
})
