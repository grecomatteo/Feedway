import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  getBulkImport,
  runBulkImport,
  startBulkImport,
  undoBulkImport,
  updatePost,
  type BulkRowInput,
  type PostsDeps,
  type UnitOfWork,
} from '@app/application'
import { addDays, instantToZoned } from '@app/domain'
import type { Runtime } from '@app/infrastructure'
import { startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { startMetaMock, type MetaMock } from '@app/meta-mock'
import { accountsRuntime, recordingQueue } from '../../tests/accounts-jobs.js'
import {
  postsDeps,
  publishingWorld,
  readyPhoto,
  testClock,
  type PublishingWorld,
} from '../../tests/publishing.js'

// `bulk.import` (spec §11.6, plan 09 Task 10, P5): one row per transaction, its outcome written
// with its post; a run killed halfway goes on from the first row without an outcome; «Annulla»
// for 10 seconds removes only the posts nobody touched since.

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  runtime = await accountsRuntime(tdb, mock)
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
}, 120_000)

afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 }).catch(() => undefined)
  await runtime.close()
  await admin.end()
  await mock.stop()
  await tdb.stop()
})

const today = () => instantToZoned(new Date(), 'Europe/Rome').localDate

/** Row `n`: a photo on its own day at 12:00, with a text of its own (no duplicate warning). */
function row(w: PublishingWorld, n: number, mediaIds: string[]): BulkRowInput {
  return {
    type: 'photo',
    mediaIds,
    cover: null,
    caption: { common: `Pane caldo, giorno ${String(n)}` },
    destinations: [{ accountId: w.accounts.instagram }],
    when: { localDate: addDays(today(), n + 1), localTime: '12:00' },
    shareToFeed: true,
    choices: [],
    labelIds: [],
  }
}

/** 20 rows: the 4th and the 15th without a file, so their checks block. */
async function twentyRows(w: PublishingWorld) {
  const photo = await readyPhoto(tdb, runtime, admin, w)
  return Array.from({ length: 20 }, (_, i) => row(w, i, i === 3 || i === 14 ? [] : [photo]))
}

/** The unit of work, killed at its `at`-th transaction: a worker stopped halfway. */
function killedAt(uow: UnitOfWork, at: number): UnitOfWork {
  let calls = 0
  return {
    ...uow,
    run: (scope: never, fn: never) => {
      calls += 1
      if (calls === at) throw new Error('worker killed')
      return uow.run(scope, fn)
    },
  }
}

const postsOf = async (workspaceId: string) =>
  (
    await admin.query<{ id: string; status: string }>(
      'select id, status from posts where workspace_id = $1 order by created_at',
      [workspaceId],
    )
  ).rows

test('20 rows with 2 blocked: 18 scheduled and 2 drafts, the event for who started it', async () => {
  const w = await publishingWorld(tdb, runtime)
  const queue = recordingQueue()
  const deps = postsDeps(runtime, queue)
  const started = await startBulkImport(deps, w.actor, {
    workspaceId: w.workspaceId,
    source: 'files',
    rows: await twentyRows(w),
  })
  expect(started).toMatchObject({ status: 'pending', total: 20, done: 0 })
  expect(queue.sent).toContainEqual(
    expect.objectContaining({
      name: 'bulk.import',
      data: { organizationId: w.organizationId, bulkImportId: started.id, userId: w.ownerId },
    }),
  )

  const report = await runBulkImport(deps, {
    organizationId: w.organizationId,
    bulkImportId: started.id,
    userId: w.ownerId,
  })
  expect(report).toEqual({ rows: 20, finished: true })
  const done = await getBulkImport(deps, w.actor, {
    workspaceId: w.workspaceId,
    importId: started.id,
  })
  expect(done.status).toBe('done')
  expect(done.summary).toEqual({ scheduled: 18, drafts: 2, failed: 0, removed: 0, kept: 0 })
  expect(done.rows[3]).toMatchObject({ status: 'draft', reason: 'blocked' })
  expect(done.rows[3]?.status === 'draft' && done.rows[3].codes.length).toBeGreaterThan(0)
  expect(done.rows[0]).toMatchObject({ status: 'scheduled' })
  expect(done.undoUntil).not.toBeNull()

  const posts = await postsOf(w.workspaceId)
  expect(posts.filter((p) => p.status === 'scheduled')).toHaveLength(18)
  expect(posts.filter((p) => p.status === 'draft')).toHaveLength(2)
  // each scheduled post asked for its first step after its commit
  expect(queue.sent.filter((j) => j.name === 'target.prepare')).toHaveLength(18)

  const events = await admin.query<{ type: string; payload: Record<string, unknown> }>(
    'select type, payload from outbox_events where organization_id = $1 and type = $2',
    [w.organizationId, 'bulk.completed'],
  )
  expect(events.rows).toEqual([
    {
      type: 'bulk.completed',
      payload: {
        workspaceId: w.workspaceId,
        bulkImportId: started.id,
        scheduled: 18,
        drafts: 2,
        failed: 0,
      },
    },
  ])

  // a run again (the job retried) writes nothing more
  expect(
    await runBulkImport(deps, {
      organizationId: w.organizationId,
      bulkImportId: started.id,
      userId: w.ownerId,
    }),
  ).toEqual({ rows: 0, finished: false })
  expect(await postsOf(w.workspaceId)).toHaveLength(20)
}, 120_000)

test('a worker killed at row 7 of 20 goes on from row 7, without a post twice', async () => {
  const w = await publishingWorld(tdb, runtime)
  const deps = postsDeps(runtime)
  const started = await startBulkImport(deps, w.actor, {
    workspaceId: w.workspaceId,
    source: 'csv',
    rows: await twentyRows(w),
  })
  const data = { organizationId: w.organizationId, bulkImportId: started.id, userId: w.ownerId }
  // the first transaction starts the run, then one per row: the 8th is row 7
  await expect(runBulkImport({ ...deps, uow: killedAt(runtime.uow, 8) }, data)).rejects.toThrow(
    'worker killed',
  )
  const halfway = await getBulkImport(deps, w.actor, {
    workspaceId: w.workspaceId,
    importId: started.id,
  })
  expect(halfway).toMatchObject({ status: 'running', done: 6 })
  expect(await postsOf(w.workspaceId)).toHaveLength(6)

  expect(await runBulkImport(deps, data)).toEqual({ rows: 14, finished: true })
  const posts = await postsOf(w.workspaceId)
  expect(posts).toHaveLength(20)
  const done = await getBulkImport(deps, w.actor, {
    workspaceId: w.workspaceId,
    importId: started.id,
  })
  expect(new Set(done.rows.map((r) => (r && r.status !== 'failed' ? r.postId : null)))).toEqual(
    new Set(posts.map((p) => p.id)),
  )
}, 120_000)

test('a row whose label was deleted meanwhile fails with its code, the others go on', async () => {
  const w = await publishingWorld(tdb, runtime)
  const deps = postsDeps(runtime)
  const photo = await readyPhoto(tdb, runtime, admin, w)
  const label = (
    await admin.query<{ id: string }>(
      `insert into labels (id, organization_id, workspace_id, name, color)
       values (gen_random_uuid(), $1, $2, 'Promo', 'blu') returning id`,
      [w.organizationId, w.workspaceId],
    )
  ).rows[0]?.id
  if (!label) throw new Error('no label')
  const started = await startBulkImport(deps, w.actor, {
    workspaceId: w.workspaceId,
    source: 'files',
    rows: [{ ...row(w, 0, [photo]), labelIds: [label] }, row(w, 1, [photo])],
  })
  await admin.query('delete from labels where id = $1', [label])
  await runBulkImport(deps, {
    organizationId: w.organizationId,
    bulkImportId: started.id,
    userId: w.ownerId,
  })
  const done = await getBulkImport(deps, w.actor, {
    workspaceId: w.workspaceId,
    importId: started.id,
  })
  expect(done.rows).toEqual([
    { status: 'failed', code: 'not_found' },
    expect.objectContaining({ status: 'scheduled' }),
  ])
  expect(await postsOf(w.workspaceId)).toHaveLength(1)
}, 120_000)

test('«Annulla» removes the posts nobody touched, keeps a draft changed since, and closes after 10 seconds', async () => {
  const w = await publishingWorld(tdb, runtime)
  const clock = testClock()
  const deps: PostsDeps = { ...postsDeps(runtime), clock }
  const photo = await readyPhoto(tdb, runtime, admin, w)
  const rows = [row(w, 0, [photo]), row(w, 1, []), row(w, 2, [])]
  const started = await startBulkImport(deps, w.actor, {
    workspaceId: w.workspaceId,
    source: 'files',
    rows,
  })
  const data = { organizationId: w.organizationId, bulkImportId: started.id, userId: w.ownerId }
  await runBulkImport(deps, data)
  const done = await getBulkImport(deps, w.actor, {
    workspaceId: w.workspaceId,
    importId: started.id,
  })
  // someone changes the second draft meanwhile
  const touched = done.rows[1]
  if (touched?.status !== 'draft') throw new Error('expected a draft')
  await updatePost(
    deps,
    w.actor,
    touched.postId,
    { workspaceId: w.workspaceId, version: touched.version, caption: { common: 'Cambiato' } },
    { ip: null },
  )

  // someone else of the agency does not see the import
  const ip = { ip: null }
  const undone = await undoBulkImport(
    deps,
    w.actor,
    { workspaceId: w.workspaceId, importId: started.id },
    ip,
  )
  expect(undone.status).toBe('undone')
  expect(undone.summary).toMatchObject({ removed: 2, kept: 1 })
  expect(undone.rows[1]).toMatchObject({ undo: 'kept' })
  const left = await postsOf(w.workspaceId)
  expect(left.map((p) => p.id)).toEqual([touched.postId])
  // the scheduled one went with its destinations
  const targets = await admin.query('select 1 from post_targets where organization_id = $1', [
    w.organizationId,
  ])
  expect(targets.rows).toHaveLength(1)

  // a second import, undone too late
  const late = await startBulkImport(deps, w.actor, {
    workspaceId: w.workspaceId,
    source: 'files',
    rows: [row(w, 5, [])],
  })
  await runBulkImport(deps, { ...data, bulkImportId: late.id })
  clock.set(new Date(clock.now().getTime() + 10_000))
  await expect(
    undoBulkImport(deps, w.actor, { workspaceId: w.workspaceId, importId: late.id }, ip),
  ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'bulk_undo_closed' } })
}, 120_000)
