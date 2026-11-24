import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { NewPlanItem, Tx, UnitOfWork } from '@app/application'
import { EMPTY_POST_OPTIONS } from '@app/domain'
import { createDb, type DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'
import { createLogger } from '../../logging/logger.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, withScope, type TestDatabase } from '../../testing/index.js'

// The plan's repository (plan 09 Task 5): the contents of a day written and read back with the
// version, the post they became (one at most, of the same client), a deleted post that frees
// the content (ON DELETE SET NULL) and two agencies that never see each other's contents.

let tdb: TestDatabase
let handle: DbHandle
let uow: UnitOfWork
let org: string, other: string, user: string, ws: string, ws2: string

const scope = () => ({ organizationId: org, workspaceId: ws })
const run = <T>(fn: (tx: Tx) => Promise<T>) => uow.run({ organizationId: org, userId: user }, fn)
// drizzle wraps the driver error: the constraint is on its cause
const refusedBy = (constraint: string) => ({ cause: { constraint } })

const item = (over: Partial<NewPlanItem> = {}): NewPlanItem => ({
  id: uuidV7Generator.newId(),
  organizationId: org,
  workspaceId: ws,
  localDate: '2026-12-20',
  localTime: '18:00',
  type: 'reel',
  title: 'Reel del pane',
  note: 'Usa la luce del mattino',
  createdBy: user,
  ...over,
})

async function newPost(workspaceId = ws) {
  const id = uuidV7Generator.newId()
  await run((tx) =>
    tx.posts.insert({
      id,
      organizationId: org,
      workspaceId,
      type: 'reel',
      caption: '',
      captionByPlatform: {},
      scheduledAt: null,
      timezone: 'Europe/Rome',
      options: EMPTY_POST_OPTIONS,
      createdBy: user,
    }),
  )
  return id
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'plan-repository' })
  uow = createUnitOfWork({
    db: handle.db,
    ids: uuidV7Generator,
    logger: createLogger({ service: 'web', level: 'error' }),
  })
  ;({ org, other, user, ws, ws2 } = await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const other = await s.organization()
    const user = await s.user()
    await s.member(org, user, 'owner')
    return {
      org,
      other,
      user,
      ws: await s.workspace(org),
      ws2: await s.workspace(org),
    }
  }))
}, 120_000)

afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

test('a content is written and read back at version 1, without a post', async () => {
  const created = await run((tx) => tx.plan.create(item()))
  expect(created).toMatchObject({
    organizationId: org,
    workspaceId: ws,
    localDate: '2026-12-20',
    localTime: '18:00',
    type: 'reel',
    title: 'Reel del pane',
    note: 'Usa la luce del mattino',
    postId: null,
    createdBy: user,
    updatedBy: user,
    version: 1,
  })
  expect(await run((tx) => tx.plan.find(scope(), created.id))).toEqual(created)
  // another client of the same agency does not find it
  expect(
    await run((tx) => tx.plan.find({ organizationId: org, workspaceId: ws2 }, created.id)),
  ).toBeNull()
  expect(await run((tx) => tx.plan.find(scope(), 'not-an-id'))).toBeNull()
})

test('a change carries the version it read', async () => {
  const { id } = await run((tx) => tx.plan.create(item({ localTime: null })))
  const change = {
    localDate: '2026-12-21',
    localTime: '09:30',
    type: 'carousel' as const,
    title: 'Menu di Natale',
    note: '',
    updatedBy: user,
  }
  expect(await run((tx) => tx.plan.update(scope(), id, change, 1))).toBe(2)
  expect(await run((tx) => tx.plan.update(scope(), id, change, 1))).toBeNull()
  expect(await run((tx) => tx.plan.find(scope(), id))).toMatchObject({ ...change, version: 2 })
})

test('the days of a period, by day and time, a content without a time last', async () => {
  const day = '2027-01-15'
  const late = await run((tx) => tx.plan.create(item({ localDate: day, localTime: '20:00' })))
  const whole = await run((tx) => tx.plan.create(item({ localDate: day, localTime: null })))
  const early = await run((tx) => tx.plan.create(item({ localDate: day, localTime: '08:00' })))
  await run((tx) => tx.plan.create(item({ localDate: '2027-01-17' })))
  const list = await run((tx) =>
    tx.plan.listInRange(org, [ws, ws2], { from: day, to: '2027-01-16' }),
  )
  expect(list.map((i) => i.id)).toEqual([early.id, late.id, whole.id])
  expect(await run((tx) => tx.plan.listInRange(org, [], { from: day, to: day }))).toEqual([])
})

test('a post comes from one content at most, of the same client', async () => {
  const post = await newPost()
  const first = await run((tx) => tx.plan.create(item()))
  const second = await run((tx) => tx.plan.create(item()))
  expect(await run((tx) => tx.plan.linkPost(scope(), first.id, post, user))).toBe(true)
  expect(await run((tx) => tx.plan.linkPost(scope(), randomUUID(), post, user))).toBe(false)
  expect(await run((tx) => tx.plan.linkPost(scope(), 'nope', post, user))).toBe(false)
  expect(await run((tx) => tx.plan.find(scope(), first.id))).toMatchObject({
    postId: post,
    version: 2,
  })
  expect((await run((tx) => tx.plan.findByPostIds(org, [post]))).map((i) => i.id)).toEqual([
    first.id,
  ])
  await expect(run((tx) => tx.plan.linkPost(scope(), second.id, post, user))).rejects.toMatchObject(
    refusedBy('plan_items_post_idx'),
  )
  // a post of another client is refused by the composite key
  const elsewhere = await newPost(ws2)
  await expect(
    run((tx) => tx.plan.linkPost(scope(), second.id, elsewhere, user)),
  ).rejects.toMatchObject(refusedBy('plan_items_post_fk'))
})

test('a deleted post frees the content; a removed content leaves the post (rules 4 and 5)', async () => {
  const post = await newPost()
  const content = await run((tx) => tx.plan.create(item()))
  await run((tx) => tx.plan.linkPost(scope(), content.id, post, user))
  await run((tx) => tx.posts.delete(scope(), post))
  expect(await run((tx) => tx.plan.find(scope(), content.id))).toMatchObject({
    postId: null,
    organizationId: org,
    workspaceId: ws,
  })
  const kept = await newPost()
  const removed = await run((tx) => tx.plan.create(item()))
  await run((tx) => tx.plan.linkPost(scope(), removed.id, kept, user))
  expect(await run((tx) => tx.plan.remove(scope(), removed.id))).toBe(true)
  expect(await run((tx) => tx.plan.remove(scope(), removed.id))).toBe(false)
  expect(await run((tx) => tx.posts.find(scope(), kept))).not.toBeNull()
})

test('another agency neither reads nor writes the contents (row level security)', async () => {
  const mine = await run((tx) => tx.plan.create(item()))
  const seen = await withScope(
    tdb.runtimeUrl,
    { kind: 'organization', organizationId: other },
    (c) => c.query('select id from plan_items'),
  )
  expect(seen.rows).toEqual([])
  await expect(
    withScope(tdb.runtimeUrl, { kind: 'organization', organizationId: other }, (c) =>
      c.query(
        `insert into plan_items (id, organization_id, workspace_id, local_date, type, title,
                                 created_by, updated_by)
         values (gen_random_uuid(), $1, $2, '2026-12-20', 'reel', 'X', $3, $3)`,
        [org, ws, user],
      ),
    ),
  ).rejects.toThrow(/row-level security/)
  // even naming the right agency and client, a session of another agency gets nothing
  const asOther = <T>(fn: (tx: Tx) => Promise<T>) =>
    uow.run({ organizationId: other, userId: user }, fn)
  expect(await asOther((tx) => tx.plan.find(scope(), mine.id))).toBeNull()
  expect(
    await asOther((tx) =>
      tx.plan.update(
        scope(),
        mine.id,
        {
          localDate: '2026-12-20',
          localTime: null,
          type: 'reel',
          title: 'Preso',
          note: '',
          updatedBy: user,
        },
        1,
      ),
    ),
  ).toBeNull()
  expect(await asOther((tx) => tx.plan.linkPost(scope(), mine.id, null, user))).toBe(false)
  expect(await asOther((tx) => tx.plan.remove(scope(), mine.id))).toBe(false)
  expect(await run((tx) => tx.plan.find(scope(), mine.id))).toMatchObject({
    title: 'Reel del pane',
  })
})

test('the database refuses a type, a title, a note or a time out of bounds', async () => {
  const refused = (change: Partial<NewPlanItem>, constraint: string) =>
    expect(run((tx) => tx.plan.create(item(change)))).rejects.toMatchObject(refusedBy(constraint))
  await refused({ type: 'video' as never }, 'plan_items_type')
  await refused({ title: '' }, 'plan_items_title')
  await refused({ title: 'x'.repeat(81) }, 'plan_items_title')
  await refused({ note: 'x'.repeat(2001) }, 'plan_items_note')
  await refused({ localTime: '24:00' }, 'plan_items_local_time')
  await refused({ localTime: '10:00:30' }, 'plan_items_local_time')
})
