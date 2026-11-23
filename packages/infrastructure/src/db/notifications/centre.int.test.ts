import type { CentreCursor, Logger, NotificationFilter, UnitOfWork } from '@app/application'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, type TestDatabase } from '../../testing/index.js'
import { createDb, type DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'

// The notification centre as the person reads it (plan 08 Task 6, P6): their own rows of the
// agencies asked for, newest first, page by page; read marks only theirs.
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
let a: string, b: string, gone: string, giulia: string, sara: string, piero: string
let client: string

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 4, applicationName: 'centre-test' })
  uow = createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger })
  ;({ a, b, gone, giulia, sara, piero, client } = await seed(tdb.runtimeUrl, async (s) => {
    const a = await s.organization()
    const b = await s.organization()
    const gone = await s.organization()
    const giulia = await s.user()
    const sara = await s.user()
    await s.member(a, giulia, 'owner')
    await s.member(b, giulia, 'member')
    // an agency she has left: her rows there are not hers to read any more
    await s.member(gone, giulia, 'member', 'disabled')
    await s.member(a, sara, 'member')
    const piero = await s.user()
    await s.member(b, piero, 'member')
    const client = await s.workspace(a)
    return { a, b, gone, giulia, sara, piero, client }
  }))
  let n = 0
  const write = (organizationId: string | null, userId: string, extra = {}) =>
    uow.runAsSystem('test', (tx) =>
      tx.notifications.create({
        organizationId,
        userId,
        eventId: uuidV7Generator.newId(),
        kind: 'post.target_failed',
        level: 'error',
        workspaceId: null,
        payload: { n: n++ },
        deliveries: [
          { channel: 'panel', status: 'sent', nextAttemptAt: null, error: null },
          {
            channel: 'email',
            status: 'skipped',
            nextAttemptAt: null,
            error: 'Email non configurata',
          },
        ],
        ...extra,
      }),
    )
  await write(a, giulia, { workspaceId: client })
  await write(a, giulia, { kind: 'post.confirmed', level: 'success' })
  await write(b, giulia)
  await write(gone, giulia)
  await write(null, giulia, { kind: 'system.worker_down', level: 'critical' })
  await write(a, sara)
})

afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

const mine = (over: Partial<NotificationFilter> = {}): NotificationFilter => ({
  organizationIds: [a, b],
  platform: true,
  ...over,
})

test('the person reads their rows of the agencies asked for, newest first, with each delivery', async () => {
  const rows = await uow.run({ userId: giulia }, (tx) =>
    tx.notifications.listForUser(giulia, mine(), { after: null, limit: 10 }),
  )
  expect(rows.map((r) => r.organizationId)).toEqual([null, b, a, a])
  expect(rows[3]?.deliveries.map((d) => [d.channel, d.status])).toEqual([
    ['panel', 'sent'],
    ['email', 'skipped'],
  ])
  expect(rows[3]?.deliveries[1]?.error).toBe('Email non configurata')
  // the left agency's row is not there even when asked for: row level security (P6)
  const left = await uow.run({ userId: giulia }, (tx) =>
    tx.notifications.listForUser(giulia, mine({ organizationIds: [gone], platform: false }), {
      after: null,
      limit: 10,
    }),
  )
  expect(left).toEqual([])
})

test('the filters narrow by agency, client, level, kind and unread; the platform only when asked', async () => {
  const list = (f: Partial<NotificationFilter>) =>
    uow.run({ userId: giulia }, (tx) =>
      tx.notifications.listForUser(giulia, mine(f), { after: null, limit: 10 }),
    )
  expect((await list({ organizationId: a })).map((r) => r.organizationId)).toEqual([a, a])
  expect((await list({ workspaceId: client })).map((r) => r.workspaceId)).toEqual([client])
  expect((await list({ level: 'success' })).map((r) => r.kind)).toEqual(['post.confirmed'])
  expect((await list({ kind: 'system.worker_down' })).map((r) => r.organizationId)).toEqual([null])
  expect(await list({ platform: false })).toHaveLength(3)
  // an agency she is not asked into gives nothing, even named
  expect(await list({ organizationIds: [b], organizationId: a })).toEqual([])
})

test('the pages follow each other without a double or a gap', async () => {
  const seen: string[] = []
  let after: CentreCursor | null = null
  for (;;) {
    const page = await uow.run({ userId: giulia }, (tx) =>
      tx.notifications.listForUser(giulia, mine(), { after, limit: 1 }),
    )
    const [row] = page
    if (!row) break
    seen.push(row.id)
    after = { createdAt: row.createdAt, id: row.id }
  }
  expect(seen).toHaveLength(4)
  expect(new Set(seen).size).toBe(4)
})

test('rows written in one transaction share now() to the microsecond and still page one by one', async () => {
  // the dispatcher writes a whole batch in one transaction: the cursor must not skip the ties
  await uow.runAsSystem('test', async (tx) => {
    for (let i = 0; i < 3; i++)
      await tx.notifications.create({
        organizationId: b,
        userId: piero,
        eventId: uuidV7Generator.newId(),
        kind: 'post.target_failed',
        level: 'error',
        workspaceId: null,
        payload: { i },
        deliveries: [{ channel: 'panel', status: 'sent', nextAttemptAt: null, error: null }],
      })
  })
  const seen: string[] = []
  let after: CentreCursor | null = null
  for (;;) {
    const page = await uow.run({ userId: piero }, (tx) =>
      tx.notifications.listForUser(
        piero,
        { organizationIds: [b], platform: false },
        { after, limit: 1 },
      ),
    )
    const [row] = page
    if (!row) break
    seen.push(row.id)
    // the cursor travels as an ISO string: milliseconds only
    after = { createdAt: new Date(row.createdAt.toISOString()), id: row.id }
  }
  expect(seen).toHaveLength(3)
  expect(new Set(seen).size).toBe(3)
})

test('read marks only her rows; another person’s by id is not found', async () => {
  const unread = () =>
    uow.run({ userId: giulia }, (tx) => tx.notifications.countUnread(giulia, mine()))
  expect(await unread()).toBe(4)
  const [saraRow] = await uow.run({ userId: sara }, (tx) =>
    tx.notifications.listForUser(
      sara,
      { organizationIds: [a], platform: false },
      {
        after: null,
        limit: 1,
      },
    ),
  )
  expect(saraRow).toBeDefined()
  const id = saraRow?.id ?? ''
  expect(await uow.run({ userId: giulia }, (tx) => tx.notifications.findForUser(giulia, id))).toBe(
    null,
  )
  expect(
    await uow.run({ userId: giulia }, (tx) =>
      tx.notifications.markRead(giulia, mine(), [id], new Date()),
    ),
  ).toBe(0)
  const [first] = await uow.run({ userId: giulia }, (tx) =>
    tx.notifications.listForUser(giulia, mine(), { after: null, limit: 1 }),
  )
  expect(
    await uow.run({ userId: giulia }, (tx) =>
      tx.notifications.markRead(giulia, mine(), [first?.id ?? ''], new Date()),
    ),
  ).toBe(1)
  expect(await unread()).toBe(3)
  expect(
    await uow.run({ userId: giulia }, (tx) =>
      tx.notifications.markRead(giulia, mine({ organizationId: a }), 'all', new Date()),
    ),
  ).toBe(2)
  expect(await unread()).toBe(1)
  // Sara's stays unread
  expect(
    await uow.run({ userId: sara }, (tx) =>
      tx.notifications.countUnread(sara, { organizationIds: [a], platform: false }),
    ),
  ).toBe(1)
})

test('the centre is read only in the person’s own scope', async () => {
  await expect(
    uow.run({ organizationId: a, userId: giulia }, (tx) =>
      tx.notifications.listForUser(giulia, mine(), { after: null, limit: 1 }),
    ),
  ).rejects.toThrow(/own scope/)
})
