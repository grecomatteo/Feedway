import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { QueueName, QueueScopes } from '@app/application'
import { QUEUES, type Runtime } from '@app/infrastructure'
import {
  imageFixture,
  seed,
  startTestDatabase,
  type TestDatabase,
} from '@app/infrastructure/testing'
import { META_MOCK, startMetaMock, type MetaMock } from '@app/meta-mock'
import type { JobHandler, JobHandlerDeps } from '../job-handler.js'
import { accountsAvatar } from './accounts-avatar.js'
import { accountsHealth } from './accounts-health.js'
import { accountsSync } from './accounts-sync.js'
import { mediaDeleteFiles } from './media-delete-files.js'
import { mediaProcess } from './media-process.js'
import { mediaPublishCopies } from './media-publish-copies.js'
import { targetPrepare, targetPublish } from './target-steps.js'
import {
  publishingWorld,
  readyPhoto,
  scheduledPost,
  targetsOf,
  type PublishingWorld,
} from '../../tests/publishing.js'
import {
  FORNO_LUCE,
  accountsRuntime,
  agency,
  connection,
  handlerDeps,
  recordingQueue,
  type Agency,
} from '../../tests/accounts-jobs.js'

// Isolation battery of the jobs (plan 03 Task 10): every queue of scope `organization` in the
// registry reads and writes only the agency named in its data, and fails without it. A queue
// added without a case here fails the first test.

type OrganizationQueue = {
  [N in QueueName]: QueueScopes[N] extends 'organization' ? N : never
}[QueueName]

interface World {
  a: Agency
  b: Agency
  /** The data of a job of A, and of A naming something of B. */
  ofA: Record<string, unknown>
  crossing: Record<string, unknown>
}

interface IsolationCase<N extends OrganizationQueue> {
  handler: JobHandler<N>
  /** Two agencies with what the job works on; the job of A must change something of A. */
  world(): Promise<World>
}

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client

async function connectionsWorld(): Promise<World> {
  const a = await agency(tdb, runtime)
  const b = await agency(tdb, runtime)
  const ofA = await connection(runtime, a, { accounts: FORNO_LUCE })
  const ofB = await connection(runtime, b, { accounts: FORNO_LUCE })
  return {
    a,
    b,
    ofA: { organizationId: a.organizationId, connectionId: ofA.id },
    crossing: { organizationId: a.organizationId, connectionId: ofB.id },
  }
}

async function picturesWorld(): Promise<World> {
  const a = await agency(tdb, runtime)
  const b = await agency(tdb, runtime)
  const avatarUrl = `${mock.url}/pictures/fornoluce.jpg?oh=cc33&oe=6A00`
  const seeded = FORNO_LUCE.map((s) => ({ ...s, avatarUrl }))
  const ofA = await connection(runtime, a, { accounts: seeded })
  const ofB = await connection(runtime, b, { accounts: seeded })
  const ig = META_MOCK.instagram.ofPage
  return {
    a,
    b,
    ofA: { organizationId: a.organizationId, accountId: ofA.accounts[ig] },
    crossing: { organizationId: a.organizationId, accountId: ofB.accounts[ig] },
  }
}

/** A deleted file of the agency, with its copy still stored. */
async function deletedMedia(of: Agency): Promise<string> {
  const mediaId = await seed(tdb.runtimeUrl, async (s) => {
    const workspace = await s.workspace(of.organizationId)
    return s.media(of.organizationId, workspace, { uploadedBy: of.ownerId, status: 'deleted' })
  })
  const key = `org/${of.organizationId}/media/${mediaId}/preview.mp4`
  await runtime.storage.put(key, Buffer.from('ftyp'), { contentType: 'video/mp4' })
  await admin.query(
    `insert into media_variants (id, organization_id, media_id, purpose, storage_key, mime, size_bytes)
     values (gen_random_uuid(), $1, $2, 'preview', $3, 'video/mp4', 4)`,
    [of.organizationId, mediaId, key],
  )
  return mediaId
}

async function mediaWorld(): Promise<World> {
  const a = await agency(tdb, runtime)
  const b = await agency(tdb, runtime)
  const ofA = await deletedMedia(a)
  const ofB = await deletedMedia(b)
  return {
    a,
    b,
    ofA: { organizationId: a.organizationId, mediaId: ofA },
    crossing: { organizationId: a.organizationId, mediaId: ofB },
  }
}

/**
 * A file of A waiting for the worker, and one of B already processed. `media.process` is a
 * wake-up that picks the next waiting file of any agency (ADR 021, approved exception): B's
 * file is not waiting, so a job of A naming it must leave it alone, and A's file is processed in
 * A's scope.
 */
async function processingWorld(): Promise<World> {
  const a = await agency(tdb, runtime)
  const b = await agency(tdb, runtime)
  const photo = await imageFixture('photo.png')
  const file = (of: Agency, status: 'processing' | 'ready') =>
    seed(tdb.runtimeUrl, async (s) => {
      const workspace = await s.workspace(of.organizationId)
      return s.media(of.organizationId, workspace, {
        uploadedBy: of.ownerId,
        kind: 'image',
        status,
      })
    })
  const ofA = await file(a, 'processing')
  await runtime.storage.put(`org/${a.organizationId}/media/${ofA}/original`, photo, {
    contentType: 'image/png',
  })
  const ofB = await file(b, 'ready')
  return {
    a,
    b,
    ofA: { organizationId: a.organizationId, mediaId: ofA },
    crossing: { organizationId: a.organizationId, mediaId: ofB },
  }
}

/**
 * A copy to publish of A waiting, and one of B already made. `media.publish_copies` is a wake-up
 * as `media.process`: B's copy is not waiting, so a job of A naming B's post leaves it alone.
 */
async function copiesWorld(): Promise<World> {
  const a = await agency(tdb, runtime)
  const b = await agency(tdb, runtime)
  const photo = await imageFixture('photo.png')
  const copy = async (of: Agency, status: 'pending' | 'ready') => {
    const mediaId = await seed(tdb.runtimeUrl, async (s) => {
      const workspace = await s.workspace(of.organizationId)
      return s.media(of.organizationId, workspace, {
        uploadedBy: of.ownerId,
        kind: 'image',
        status: 'ready',
      })
    })
    const prefix = `org/${of.organizationId}/media/${mediaId}`
    await runtime.storage.put(`${prefix}/master.jpg`, photo, { contentType: 'image/png' })
    await admin.query(
      `insert into media_variants (id, organization_id, media_id, purpose, storage_key, mime,
         size_bytes, recipe, status)
       values (gen_random_uuid(), $1, $2, 'master', $3, 'image/jpeg', 1, '', 'ready'),
              (gen_random_uuid(), $1, $2, 'ig_feed', $4, 'image/jpeg', 0, 'pad-8000', $5)`,
      [
        of.organizationId,
        mediaId,
        `${prefix}/master.jpg`,
        `${prefix}/ig_feed-pad-8000.jpg`,
        status,
      ],
    )
    return mediaId
  }
  await copy(a, 'pending')
  await copy(b, 'ready')
  return {
    a,
    b,
    ofA: { organizationId: a.organizationId, postId: null },
    crossing: { organizationId: a.organizationId, postId: null },
  }
}

/**
 * A scheduled destination of each agency whose time passed 20 minutes ago (D-77 b): the step
 * fails it without calling Meta, which is enough to see where it writes.
 */
async function targetsWorld(status: 'scheduled' | 'ready'): Promise<World> {
  const a = await publishingWorld(tdb, runtime)
  const b = await publishingWorld(tdb, runtime)
  const ofEach = async (w: PublishingWorld) => {
    const photo = await readyPhoto(tdb, runtime, admin, w)
    const { postId } = await scheduledPost(runtime, w, {
      at: new Date(Date.now() + 40 * 60_000),
      mediaIds: [photo],
      accounts: [w.accounts.instagram],
    })
    await admin.query(
      "update posts set scheduled_at = now() - interval '20 minutes' where id = $1",
      [postId],
    )
    if (status === 'ready')
      await admin.query(
        "update post_targets set status = 'ready', step = 'publish' where post_id = $1",
        [postId],
      )
    const [target] = await targetsOf(admin, postId)
    if (!target) throw new Error('no destination')
    return { targetId: target.id, generation: target.generation }
  }
  const ofA = await ofEach(a)
  const ofB = await ofEach(b)
  return {
    a,
    b,
    ofA: { organizationId: a.organizationId, ...ofA },
    crossing: { organizationId: a.organizationId, ...ofB },
  }
}

const CASES: { [N in OrganizationQueue]: IsolationCase<N> } = {
  'accounts.sync': { handler: accountsSync, world: connectionsWorld },
  'accounts.health': { handler: accountsHealth, world: connectionsWorld },
  'accounts.avatar': { handler: accountsAvatar, world: picturesWorld },
  'media.delete_files': { handler: mediaDeleteFiles, world: mediaWorld },
  'media.process': { handler: mediaProcess, world: processingWorld },
  'media.publish_copies': { handler: mediaPublishCopies, world: copiesWorld },
  'target.prepare': { handler: targetPrepare, world: () => targetsWorld('scheduled') },
  'target.publish': { handler: targetPublish, world: () => targetsWorld('ready') },
}

// every row an agency's job could touch, by agency
const SNAPSHOT_QUERIES = [
  'select * from account_connections where organization_id = $1 order by id',
  'select * from social_accounts where organization_id = $1 order by id',
  'select * from workspace_accounts where organization_id = $1 order by account_id',
  'select * from media where organization_id = $1 order by id',
  'select * from media_variants where organization_id = $1 order by id',
  'select * from audit_log where organization_id = $1 order by id',
  'select * from posts where organization_id = $1 order by id',
  'select * from post_targets where organization_id = $1 order by id',
  'select * from target_attempts where organization_id = $1 order by id',
  'select * from outbox_events where organization_id = $1 order by id',
]

async function snapshot(of: Agency): Promise<unknown[]> {
  const out: unknown[] = []
  for (const q of SNAPSHOT_QUERIES) out.push((await admin.query(q, [of.organizationId])).rows)
  return out
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  runtime = await accountsRuntime(tdb, mock)
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
}, 120_000)

afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 })
  await runtime.close()
  await admin.end()
  await mock.stop()
  await tdb.stop()
})

const organizationQueues = QUEUES.filter((q) => q.scope === 'organization').map((q) => q.name)

test('every organization queue of the registry has its case', () => {
  expect(organizationQueues.length).toBeGreaterThan(0)
  expect([...organizationQueues].sort()).toEqual(Object.keys(CASES).sort())
})

/** Any data, as a producer with a bug could send it: the handler must judge it. */
type AnyDataHandler = (job: { id: string; data: unknown }, deps: JobHandlerDeps) => Promise<void>

const run = (name: OrganizationQueue, data: Record<string, unknown>) =>
  (CASES[name].handler as AnyDataHandler)(
    { id: 'lavoro', data },
    handlerDeps(runtime, recordingQueue()),
  )

test.each(organizationQueues as OrganizationQueue[])(
  '%s works on its own agency only',
  async (name) => {
    const world = await CASES[name].world()
    const beforeA = await snapshot(world.a)
    const beforeB = await snapshot(world.b)
    await run(name, world.ofA)
    // the job did its work in A (otherwise the case proves nothing), and nothing in B
    expect(await snapshot(world.a)).not.toEqual(beforeA)
    expect(await snapshot(world.b)).toEqual(beforeB)

    // A's agency naming B's things: B is not seen, so nothing happens anywhere
    const afterA = await snapshot(world.a)
    const calls = mock.calls().length
    await run(name, world.crossing)
    // and B's token is never opened for Meta
    expect(mock.calls()).toHaveLength(calls)
    expect(await snapshot(world.a)).toEqual(afterA)
    expect(await snapshot(world.b)).toEqual(beforeB)
  },
)

test.each(organizationQueues as OrganizationQueue[])(
  '%s fails without organizationId',
  async (name) => {
    const world = await CASES[name].world()
    const withoutAgency = { ...world.ofA }
    delete withoutAgency.organizationId
    const beforeA = await snapshot(world.a)
    await expect(run(name, withoutAgency)).rejects.toThrow(/organizationId/)
    await expect(run(name, { ...world.ofA, organizationId: '' })).rejects.toThrow(/organizationId/)
    expect(await snapshot(world.a)).toEqual(beforeA)
  },
)
