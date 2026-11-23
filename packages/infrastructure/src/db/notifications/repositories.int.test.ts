import { DEFAULT_NOTIFICATION_SETTINGS } from '@app/domain'
import type { Logger, NewNotification, UnitOfWork } from '@app/application'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, withScope, type TestDatabase } from '../../testing/index.js'
import { createDb, type DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'

// The outbox as the dispatcher reads it and the notification tables' repositories (plan 08
// Task 4); row level security is in rls.int.test.ts next to this file.
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
let org: string, user: string

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 4, applicationName: 'notifications-test' })
  uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger })
  ;({ org, user } = await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const user = await s.user()
    await s.member(org, user, 'owner')
    return { org, user }
  }))
})

afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

const inOrg = { organizationId: '', userId: null } as const
const scope = () => ({ ...inOrg, organizationId: org })
const clearOutbox = () =>
  withScope(tdb.runtimeUrl, { kind: 'system' }, (c) => c.query('delete from outbox_events'))

test('an event with a key already written is not written again', async () => {
  await clearOutbox()
  const event = {
    organizationId: org,
    type: 'meta.reminder',
    payload: { reminder: 'token_expiring' },
    dedupeKey: 'conn:token_expiring:2026-12-01',
  } as const
  expect(await uow.run(scope(), (tx) => tx.outbox.record(event))).toBe(true)
  expect(await uow.run(scope(), (tx) => tx.outbox.record(event))).toBe(false)
  // without a key, every event is written
  const plain = { organizationId: org, type: 'post.confirmed', payload: {} } as const
  expect(await uow.run(scope(), (tx) => tx.outbox.record(plain))).toBe(true)
  expect(await uow.run(scope(), (tx) => tx.outbox.record(plain))).toBe(true)
  const pending = await uow.runAsSystem('test', (tx) => tx.outbox.takePending(10))
  expect(pending.map((e) => e.type)).toEqual(['meta.reminder', 'post.confirmed', 'post.confirmed'])
  expect(pending[0]?.dedupeKey).toBe(event.dedupeKey)
})

test('two dispatchers take different events, oldest first, and a sent one is not taken again', async () => {
  await clearOutbox()
  for (let i = 0; i < 4; i++)
    await uow.run(scope(), (tx) =>
      tx.outbox.record({ organizationId: org, type: 'post.target_failed', payload: { i } }),
    )
  let release: () => void = () => undefined
  const held = new Promise<void>((r) => (release = r))
  let firstTook: number[] = []
  const first = uow.runAsSystem('test', async (tx) => {
    firstTook = (await tx.outbox.takePending(2)).map((e) => Number(e.payload.i))
    await held
  })
  // the first holds its two until it ends
  await new Promise((r) => setTimeout(r, 100))
  const second = await uow.runAsSystem('test', async (tx) => {
    const taken = await tx.outbox.takePending(10)
    await tx.outbox.markDispatched(
      taken.map((e) => e.id),
      new Date(),
    )
    return taken.map((e) => Number(e.payload.i))
  })
  release()
  await first
  expect(firstTook).toEqual([0, 1])
  expect(second).toEqual([2, 3])
  const left = await uow.runAsSystem('test', (tx) => tx.outbox.takePending(10))
  expect(left.map((e) => Number(e.payload.i))).toEqual([0, 1])
})

test('only the system scope reads or marks the outbox', async () => {
  await expect(uow.run(scope(), (tx) => tx.outbox.takePending(1))).rejects.toThrow(/system/)
  await expect(uow.run(scope(), (tx) => tx.outbox.markDispatched([], new Date()))).rejects.toThrow(
    /system/,
  )
})

test('a notification is written once per person and event, with its deliveries', async () => {
  const notification: NewNotification = {
    organizationId: org,
    userId: user,
    eventId: uuidV7Generator.newId(),
    kind: 'post.target_failed',
    level: 'error',
    workspaceId: null,
    payload: { postId: 'p' },
    deliveries: [
      { channel: 'panel', status: 'sent', nextAttemptAt: null, error: null },
      { channel: 'email', status: 'pending', nextAttemptAt: new Date(), error: null },
      {
        channel: 'telegram',
        status: 'skipped',
        nextAttemptAt: null,
        error: 'Telegram non collegato',
      },
    ],
  }
  expect(await uow.run(scope(), (tx) => tx.notifications.create(notification))).toBe(true)
  expect(await uow.run(scope(), (tx) => tx.notifications.create(notification))).toBe(false)
  const rows = await withScope(
    tdb.runtimeUrl,
    { kind: 'system' },
    async (c) =>
      (
        await c.query<{ channel: string; status: string; sent: boolean; kind: string }>(
          `select channel, status, sent_at is not null as sent, kind from notification_deliveries
          order by channel`,
        )
      ).rows,
  )
  expect(rows).toEqual([
    { channel: 'email', status: 'pending', sent: false, kind: 'post.target_failed' },
    { channel: 'panel', status: 'sent', sent: true, kind: 'post.target_failed' },
    { channel: 'telegram', status: 'skipped', sent: false, kind: 'post.target_failed' },
  ])
})

test('settings and preferences: the defaults without a row, then what the person saved', async () => {
  const mine = { userId: user }
  expect(await uow.run(mine, (tx) => tx.notificationPrefs.getSettings(user))).toEqual(
    DEFAULT_NOTIFICATION_SETTINGS,
  )
  const saved = {
    minLevel: 'warning',
    quietHours: { start: '22:00', end: '07:00' },
    digest: { enabled: true, time: '07:30', days: [1, 2, 3, 4, 5] },
    everythingEverywhere: false,
  } as const
  await uow.run(mine, (tx) => tx.notificationPrefs.saveSettings(user, saved))
  await uow.run(mine, (tx) =>
    tx.notificationPrefs.saveSettings(user, { ...saved, everythingEverywhere: true }),
  )
  expect(await uow.run(mine, (tx) => tx.notificationPrefs.getSettings(user))).toEqual({
    ...saved,
    everythingEverywhere: true,
  })

  await uow.run(mine, (tx) =>
    tx.notificationPrefs.setPref(user, 'post.confirmed', { channels: ['panel'] }),
  )
  await uow.run(mine, (tx) => tx.notificationPrefs.setPref(user, 'post.paused', { channels: [] }))
  await uow.run(mine, (tx) =>
    tx.notificationPrefs.setPref(user, 'post.confirmed', { channels: ['panel', 'email'] }),
  )
  expect(await uow.run(mine, (tx) => tx.notificationPrefs.listPrefs(user))).toEqual(
    new Map([
      ['post.confirmed', { channels: ['panel', 'email'] }],
      ['post.paused', { channels: [] }],
    ]),
  )
  await uow.run(mine, (tx) => tx.notificationPrefs.setPref(user, 'post.paused', null))
  expect([...(await uow.run(mine, (tx) => tx.notificationPrefs.listPrefs(user))).keys()]).toEqual([
    'post.confirmed',
  ])
})
