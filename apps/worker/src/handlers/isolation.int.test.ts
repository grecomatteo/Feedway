import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  callExternalWatch,
  createPlanItem,
  startBulkImport,
  type QueueName,
  type QueueScopes,
} from '@app/application'
import { instantToZoned, zonedToInstant } from '@app/domain'
import { QUEUES, type Runtime } from '@app/infrastructure'
import {
  imageFixture,
  seed,
  startTestDatabase,
  type TestDatabase,
} from '@app/infrastructure/testing'
import { META_MOCK, startMetaMock, type MetaMock } from '@app/meta-mock'
import { TELEGRAM_MOCK, startTelegramMock, type TelegramMock } from '@app/telegram-mock'
import type { JobHandler, JobHandlerDeps } from '../job-handler.js'
import { accountsAvatar } from './accounts-avatar.js'
import { accountsHealth } from './accounts-health.js'
import { accountsSync } from './accounts-sync.js'
import { bulkImport } from './bulk-import.js'
import { mediaDeleteFiles } from './media-delete-files.js'
import { mediaProcess } from './media-process.js'
import { mediaPublishCopies } from './media-publish-copies.js'
import { notifyDeliver, notifyDeliverPlatform, notifyDispatch, telegramPoll } from './notify.js'
import { planDueScan } from './plan.js'
import { reportDaily, reportDigest } from './report.js'
import { targetPrepare, targetPublish, targetReconcile, targetVerify } from './target-steps.js'
import {
  postsDeps,
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
// added without a case here fails the first test. The queues of the system and of a person
// (plan 08) have a case of their own, at the end; those from before the tappa 8 are listed.

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
let telegram: TelegramMock

// two agencies, each with a bot of its own (plan 08 Task 7)
const BOT_OF_A = TELEGRAM_MOCK.bots.agency
const BOT_OF_B = {
  token: '1000000003:AAmock-other-agency-bot-token-00000',
  id: 1000000003,
  username: 'altra_agenzia_mock_bot',
  firstName: 'Altra agenzia',
}

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
async function targetsWorld(
  status: 'scheduled' | 'ready' | 'unknown' | 'published',
): Promise<World> {
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
        // ready at the time, as a preparation leaves it: 20 minutes late, so too late (D-77 b)
        `update post_targets set status = 'ready', step = 'publish',
                next_attempt_at = now() - interval '20 minutes' where post_id = $1`,
        [postId],
      )
    if (status === 'unknown' || status === 'published')
      // an uncertain call nothing came of, or a post out without its id: the step reads Meta,
      // finds nothing, and writes the next round or the problem, on its own agency only
      await admin.query(
        `update post_targets set status = $2, step = $3, next_attempt_at = now()
          where post_id = $1`,
        [postId, status, status === 'unknown' ? 'publish' : 'verify'],
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

/** An email to send of each agency's Owner, due a minute ago (plan 08 Task 5). */
async function deliveriesWorld(): Promise<World> {
  const a = await agency(tdb, runtime)
  const b = await agency(tdb, runtime)
  const deliveryOf = (of: Agency) =>
    runtime.uow.run({ organizationId: of.organizationId, userId: of.ownerId }, async (tx) => {
      const created = await tx.notifications.create({
        organizationId: of.organizationId,
        userId: of.ownerId,
        eventId: runtime.ids.newId(),
        kind: 'account.quota_low',
        level: 'warning',
        workspaceId: null,
        payload: { accountId: runtime.ids.newId(), left: 1, total: 50 },
        deliveries: [
          {
            channel: 'email',
            status: 'pending',
            nextAttemptAt: new Date(Date.now() - 60_000),
            error: null,
          },
        ],
      })
      const [delivery] = created ?? []
      if (!delivery) throw new Error('no delivery')
      return delivery.id
    })
  const ofA = await deliveryOf(a)
  const ofB = await deliveryOf(b)
  return {
    a,
    b,
    ofA: { organizationId: a.organizationId, deliveryId: ofA, recipientUserId: a.ownerId },
    // A's agency naming B's delivery, for B's Owner
    crossing: { organizationId: a.organizationId, deliveryId: ofB, recipientUserId: b.ownerId },
  }
}

/**
 * An import in bulk of each agency, waiting for the worker (plan 09 Task 10): one row without a
 * file, which becomes a draft. A job of A naming B's import finds nothing.
 */
async function bulkWorld(): Promise<World> {
  const a = await publishingWorld(tdb, runtime)
  const b = await publishingWorld(tdb, runtime)
  const tomorrow = instantToZoned(new Date(Date.now() + 86_400_000), 'Europe/Rome').localDate
  const importOf = (w: PublishingWorld) =>
    startBulkImport(postsDeps(runtime), w.actor, {
      workspaceId: w.workspaceId,
      source: 'files',
      rows: [
        {
          type: 'photo',
          mediaIds: [],
          cover: null,
          caption: { common: 'Pane caldo' },
          destinations: [{ accountId: w.accounts.instagram }],
          when: { localDate: tomorrow, localTime: '12:00' },
          shareToFeed: true,
          choices: [],
          labelIds: [],
        },
      ],
    })
  const ofA = await importOf(a)
  const ofB = await importOf(b)
  return {
    a,
    b,
    ofA: { organizationId: a.organizationId, bulkImportId: ofA.id, userId: a.ownerId },
    crossing: { organizationId: a.organizationId, bulkImportId: ofB.id, userId: a.ownerId },
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
  'target.reconcile': { handler: targetReconcile, world: () => targetsWorld('unknown') },
  'target.verify': { handler: targetVerify, world: () => targetsWorld('published') },
  'notify.deliver': { handler: notifyDeliver, world: deliveriesWorld },
  'bulk.import': { handler: bulkImport, world: bulkWorld },
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
  'select * from notifications where organization_id = $1 order by id',
  'select * from notification_deliveries where organization_id = $1 order by id',
  'select * from bulk_imports where organization_id = $1 order by id',
]

async function snapshot(of: Agency): Promise<unknown[]> {
  const out: unknown[] = []
  for (const q of SNAPSHOT_QUERIES) out.push((await admin.query(q, [of.organizationId])).rows)
  return out
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  telegram = await startTelegramMock({ bots: [TELEGRAM_MOCK.bots.platform, BOT_OF_A, BOT_OF_B] })
  runtime = await accountsRuntime(tdb, mock, { telegramApiUrl: telegram.url })
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
}, 120_000)

afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 })
  await runtime.close()
  await admin.end()
  await mock.stop()
  await telegram.stop()
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

// The system's and a person's queues (plan 08 Task 5): a system job that reads every agency keeps
// what it writes in each one's place; one of the platform never touches an agency's rows.

type SystemQueue = {
  [N in QueueName]: QueueScopes[N] extends 'system' ? N : never
}[QueueName]
type UserQueue = {
  [N in QueueName]: QueueScopes[N] extends 'user' ? N : never
}[QueueName]

/** Before the tappa 8: proved in their own tests, without a case here. A new one needs its case. */
const EARLIER_SYSTEM_QUEUES: readonly SystemQueue[] = [
  'system.selftest',
  'identity.account_locked_notice',
  'identity.account_locked_notice_email',
  'identity.retention',
  'accounts.daily',
  'media.uploads_cleanup',
  'media.publish_copies_cleanup',
  'scheduler.reconcile',
]
const EARLIER_USER_QUEUES: readonly UserQueue[] = [
  'identity.security_email',
  'identity.password_reset_email',
  'identity.account_recovery_email',
  'identity.email_change',
  'identity.data_export',
  'identity.anonymization_notice',
]

const anyRun = (handler: unknown, data: Record<string, unknown>) =>
  (handler as AnyDataHandler)({ id: 'lavoro', data }, handlerDeps(runtime, recordingQueue()))

/** Each agency's event becomes notifications of that agency only, for its own members. */
async function dispatchCase(): Promise<void> {
  const a = await agency(tdb, runtime)
  const b = await agency(tdb, runtime)
  const markOf = new Map<Agency, string>()
  for (const of of [a, b]) {
    const mark = runtime.ids.newId()
    markOf.set(of, mark)
    await runtime.uow.runAsSystem('test: an event', (tx) =>
      tx.outbox.record({
        organizationId: of.organizationId,
        type: 'account.token_invalid',
        payload: { connectionId: mark, status: 'expired' },
      }),
    )
  }
  await anyRun(notifyDispatch, {})
  for (const of of [a, b]) {
    const { rows } = await admin.query<{ organization_id: string; user_id: string }>(
      `select organization_id, user_id from notifications where payload->>'connectionId' = $1`,
      [markOf.get(of)],
    )
    expect(rows).toEqual([{ organization_id: of.organizationId, user_id: of.ownerId }])
  }
}

/** The platform's job sends its own delivery, and names an agency's in vain. */
async function deliverPlatformCase(): Promise<void> {
  const world = await deliveriesWorld()
  const platformAdmin = await seed(tdb.runtimeUrl, (s) => s.user())
  await admin.query("update users set platform_role = 'admin' where id = $1", [platformAdmin])
  const own = await runtime.uow.runAsSystem('test: a platform notification', async (tx) => {
    const created = await tx.notifications.create({
      organizationId: null,
      userId: platformAdmin,
      eventId: runtime.ids.newId(),
      kind: 'system.backup_failed',
      level: 'critical',
      workspaceId: null,
      payload: {},
      deliveries: [
        { channel: 'email', status: 'pending', nextAttemptAt: new Date(0), error: null },
      ],
    })
    const [delivery] = created ?? []
    if (!delivery) throw new Error('no delivery')
    return delivery.id
  })
  const statusOf = async (id: string) =>
    (
      await admin.query<{ status: string }>(
        'select status from notification_deliveries where id = $1',
        [id],
      )
    ).rows[0]?.status
  await anyRun(notifyDeliverPlatform, { deliveryId: own, recipientUserId: platformAdmin })
  expect(await statusOf(own)).not.toBe('pending')

  const beforeA = await snapshot(world.a)
  const { deliveryId, recipientUserId } = world.ofA
  await anyRun(notifyDeliverPlatform, { deliveryId, recipientUserId })
  expect(await snapshot(world.a)).toEqual(beforeA)
}

/**
 * Each agency's bot links its own members only: a code started for A works only on A's bot, and
 * a bot taken away from B takes only B's links.
 */
async function telegramPollCase(): Promise<void> {
  const a = await agency(tdb, runtime)
  const b = await agency(tdb, runtime)
  const codes = new Map<Agency, string>()
  for (const [of, bot] of [
    [a, BOT_OF_A],
    [b, BOT_OF_B],
  ] as const) {
    await runtime.uow.run({ organizationId: of.organizationId, userId: of.ownerId }, (tx) =>
      runtime.integrations.replace(tx, of.organizationId, 'telegram', {
        config: { botId: bot.id, botUsername: bot.username },
        secret: bot.token,
        updatedBy: of.ownerId,
        expectedVersion: null,
        verifiedAt: new Date(),
      }),
    )
    const { token, hash } = runtime.tokens.generate()
    codes.set(of, token)
    await runtime.uow.run({ organizationId: of.organizationId, userId: of.ownerId }, (tx) =>
      tx.telegramLinks.startLink({
        organizationId: of.organizationId,
        userId: of.ownerId,
        codeHash: hash.toString('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    )
  }
  // A's code written to B's bot links nobody; each code on its own bot links its own owner
  telegram.userWrites(BOT_OF_B.token, { chatId: 7001, text: `/start ${codes.get(a) ?? ''}` })
  telegram.userWrites(BOT_OF_A.token, { chatId: 7002, text: `/start ${codes.get(a) ?? ''}` })
  telegram.userWrites(BOT_OF_B.token, { chatId: 7003, text: `/start ${codes.get(b) ?? ''}` })
  await anyRun(telegramPoll, {})
  const linked = async () =>
    (
      await admin.query<{ organization_id: string; user_id: string; chat_id: string }>(
        `select organization_id, user_id, chat_id from telegram_links
          where chat_id is not null and organization_id = any($1) order by chat_id`,
        [[a.organizationId, b.organizationId]],
      )
    ).rows
  expect(await linked()).toEqual([
    { organization_id: a.organizationId, user_id: a.ownerId, chat_id: '7002' },
    { organization_id: b.organizationId, user_id: b.ownerId, chat_id: '7003' },
  ])
  await admin.query("delete from integrations where kind = 'telegram' and organization_id = $1", [
    b.organizationId,
  ])
  await anyRun(telegramPoll, {})
  expect(await linked()).toEqual([
    { organization_id: a.organizationId, user_id: a.ownerId, chat_id: '7002' },
  ])
}

/** Each person due gets a digest job of their own, with their id and no agency's. */
async function digestStartCase(): Promise<void> {
  const a = await agency(tdb, runtime)
  const b = await agency(tdb, runtime)
  const queue = recordingQueue()
  // 8:00 in Rome today: every person with the defaults is due
  const day = instantToZoned(new Date(), 'Europe/Rome').localDate
  const at8 = zonedToInstant(day, '08:00', 'Europe/Rome').instant
  await reportDaily(
    { id: 'lavoro', data: {} },
    { ...handlerDeps(runtime, recordingQueue()), queue, clock: { now: () => at8 } },
  )
  for (const of of [a, b]) {
    const own = queue.sent.filter((j) => (j.data as { userId: string }).userId === of.ownerId)
    expect(own).toEqual([
      {
        name: 'report.digest',
        data: { userId: of.ownerId, date: day, dueAt: at8.toISOString() },
        opts: { dedupeKey: `${of.ownerId}:${day}` },
      },
    ])
  }
}

/** A person's digest tells only what their agencies hold: never another agency's account. */
async function digestCase(): Promise<void> {
  const a = await agency(tdb, runtime)
  const b = await agency(tdb, runtime)
  const [page] = FORNO_LUCE
  await connection(runtime, a, { accounts: [{ ...page, name: 'Profilo di A' }] })
  await connection(runtime, b, { accounts: [{ ...page, name: 'Profilo di B' }] })
  await admin.query(
    "update social_accounts set health = 'error' where organization_id = any($1::uuid[])",
    [[a.organizationId, b.organizationId]],
  )
  const sent: { to: string; text: string }[] = []
  const deps = {
    ...handlerDeps(runtime, recordingQueue()),
    mailer: {
      isConfigured: () => Promise.resolve(true),
      send: (m: { to: string; text: string }) => {
        sent.push(m)
        return Promise.resolve('sent' as const)
      },
    },
  }
  const now = new Date()
  await reportDigest(
    { id: 'lavoro', data: { userId: a.ownerId, date: '2026-11-23', dueAt: now.toISOString() } },
    deps,
  )
  expect(sent).toHaveLength(1)
  expect(sent[0]?.text).toContain('Profilo di A')
  expect(sent[0]?.text).not.toContain('Profilo di B')
}

/** The plan's scan writes each agency's notice in that agency, for its own content only. */
async function planScanCase(): Promise<void> {
  const contents: { organizationId: string; itemId: string }[] = []
  for (const of of [await agency(tdb, runtime), await agency(tdb, runtime)]) {
    const workspaceId = await seed(tdb.runtimeUrl, (s) => s.workspace(of.organizationId))
    const item = await createPlanItem(
      { uow: runtime.uow, clock: runtime.clock, ids: { newId: () => randomUUID() } },
      {
        userId: of.ownerId,
        platformRole: null,
        organizationId: of.organizationId,
        orgRole: 'owner',
        memberships: new Map(),
      },
      { workspaceId, localDate: '2027-04-21', localTime: '10:00', type: 'photo', title: 'Pane' },
    )
    contents.push({ organizationId: of.organizationId, itemId: item.id })
  }
  const now = zonedToInstant('2027-04-20', '10:00', 'Europe/Rome').instant
  await planDueScan(
    { id: 'lavoro', data: {} },
    { ...handlerDeps(runtime, recordingQueue()), clock: { now: () => now } },
  )
  for (const { organizationId, itemId } of contents) {
    const { rows } = await admin.query<{ organization_id: string }>(
      "select organization_id from outbox_events where type = 'plan.due_soon' and payload->>'planItemId' = $1",
      [itemId],
    )
    expect(rows).toEqual([{ organization_id: organizationId }])
  }
}

/** The external watch, now the web's round (R4), reads and writes the platform's row only. */
async function externalWatchCase(): Promise<void> {
  const a = await agency(tdb, runtime)
  await runtime.uow.runAsSystem('test: the external watch', (tx) =>
    runtime.integrations.replacePlatform(tx, 'heartbeat', {
      config: {},
      secret: 'https://hc-ping.com/isolamento',
      updatedBy: null,
    }),
  )
  const before = await snapshot(a)
  await callExternalWatch({
    uow: runtime.uow,
    clock: runtime.clock,
    logger: runtime.logger,
    integrations: runtime.integrations,
    pinger: { ping: () => Promise.resolve({ ok: true, status: 200 }) },
  })
  expect(await snapshot(a)).toEqual(before)
  const { rows } = await admin.query<{ organization_id: string | null; state: { ok?: boolean } }>(
    "select organization_id, state from integrations where kind = 'heartbeat'",
  )
  expect(rows.map((r) => [r.organization_id, r.state.ok])).toEqual([[null, true]])
}

const SYSTEM_CASES: Partial<Record<SystemQueue, () => Promise<void>>> = {
  'telegram.poll': telegramPollCase,
  'notify.dispatch': dispatchCase,
  'notify.deliver_platform': deliverPlatformCase,
  'report.daily': digestStartCase,
  'plan.due_scan': planScanCase,
}
const USER_CASES: Partial<Record<UserQueue, () => Promise<void>>> = {
  'report.digest': digestCase,
}

test('every system and person queue has its case, or is from before the tappa 8', () => {
  const listed = (scope: string, earlier: readonly string[], cases: object) => {
    expect(
      QUEUES.filter((q) => q.scope === scope)
        .map((q) => q.name)
        .sort(),
    ).toEqual([...earlier, ...Object.keys(cases)].sort())
  }
  listed('system', EARLIER_SYSTEM_QUEUES, SYSTEM_CASES)
  listed('user', EARLIER_USER_QUEUES, USER_CASES)
})

test.each(Object.keys({ ...SYSTEM_CASES, ...USER_CASES }))(
  '%s keeps each agency in its place',
  async (name) => {
    const run = { ...SYSTEM_CASES, ...USER_CASES }[name as SystemQueue]
    if (!run) throw new Error(`no case for ${name}`)
    await run()
  },
)

test('the external watch keeps each agency in its place', externalWatchCase)
