import pg from 'pg'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import {
  prepareTarget,
  publishTarget,
  reconcilePublishing,
  unschedulePost,
  updatePost,
  type PlatformPublisher,
} from '@app/application'
import type { Runtime } from '@app/infrastructure'
import { startTestDatabase, withScope, type TestDatabase } from '@app/infrastructure/testing'
import { startMetaMock, type MetaMock } from '@app/meta-mock'
import { accountsRuntime } from '../../tests/accounts-jobs.js'
import {
  postStatusOf,
  postsDeps,
  publicHost,
  publishingWorld,
  readyPhoto,
  scheduledPost,
  targetsOf,
  testClock,
  workerDeps,
  type PublishingWorld,
  type TargetRow,
} from '../../tests/publishing.js'

// The publishing's jobs (plan 07 Task 7) against the database, the real files and the fake
// Graph API: a scheduled post goes out at its time, once, whatever stops in between.

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client
let host: Awaited<ReturnType<typeof publicHost>>

const MINUTE = 60_000

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  runtime = await accountsRuntime(tdb, mock)
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  host = await publicHost()
}, 120_000)

afterEach(() => {
  mock.scenario('default')
})

afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 }).catch(() => undefined)
  await runtime.close()
  await admin.end()
  await mock.stop()
  await host.stop()
  await tdb.stop()
})

/** A time in the future on a whole minute, as the editor gives it. */
const inMinutes = (n: number) => new Date(Math.ceil((Date.now() + n * MINUTE) / MINUTE) * MINUTE)

const callsTo = (suffix: string, method = 'POST') =>
  mock.calls().filter((c) => c.method === method && c.path.endsWith(suffix)).length

const job = (world: PublishingWorld, t: Pick<TargetRow, 'id' | 'generation'>) => ({
  organizationId: world.organizationId,
  targetId: t.id,
  generation: t.generation,
})

async function setUp(opts: { at?: Date; accounts?: 'both' | 'instagram' } = {}) {
  const world = await publishingWorld(tdb, runtime)
  const photo = await readyPhoto(tdb, runtime, admin, world)
  const at = opts.at ?? inMinutes(40)
  const accounts =
    opts.accounts === 'instagram'
      ? [world.accounts.instagram]
      : [world.accounts.facebook, world.accounts.instagram]
  const post = await scheduledPost(runtime, world, { at, mediaIds: [photo], accounts })
  return { world, photo, at, post }
}

/** Runs every prepare and then every publish step of the post, as the queue would. */
async function runSteps(
  world: PublishingWorld,
  postId: string,
  clock: ReturnType<typeof testClock>,
  step: 'prepare' | 'publish',
) {
  const deps = workerDeps(runtime, clock, host.url)
  for (const t of await targetsOf(admin, postId))
    await (step === 'prepare' ? prepareTarget : publishTarget)(deps, job(world, t))
  return deps.queue
}

test('a scheduled photo is prepared 15 minutes before and goes out at its time on both accounts', async () => {
  const { world, at, post } = await setUp()
  const scheduled = await targetsOf(admin, post.postId)
  // the scheduling wrote when the preparation starts (prepareAt)
  expect(scheduled.map((t) => [t.status, t.next_attempt_at?.getTime()])).toEqual([
    ['scheduled', at.getTime() - 15 * MINUTE],
    ['scheduled', at.getTime() - 15 * MINUTE],
  ])
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  const containers = callsTo('/media')
  const queued = await runSteps(world, post.postId, clock, 'prepare')
  const ready = await targetsOf(admin, post.postId)
  expect(ready.map((t) => [t.status, t.step, t.claimed_until])).toEqual([
    ['ready', 'publish', null],
    ['ready', 'publish', null],
  ])
  expect(await postStatusOf(admin, post.postId)).toBe('publishing')
  expect(callsTo('/media')).toBe(containers + 1)
  // the publish steps are queued for the post's time, one key per destination and generation
  expect(queued.sent.map((s) => [s.name, (s.opts as { startAfter: Date }).startAfter])).toEqual([
    ['target.publish', at],
    ['target.publish', at],
  ])

  clock.set(at)
  const published = callsTo('/media_publish')
  await runSteps(world, post.postId, clock, 'publish')
  const out = await targetsOf(admin, post.postId)
  expect(out.map((t) => t.status)).toEqual(['published', 'published'])
  expect(out.every((t) => t.external_post_id !== null)).toBe(true)
  expect(out.every((t) => t.next_attempt_at?.getTime() === at.getTime() + 3 * MINUTE)).toBe(true)
  expect(callsTo('/media_publish')).toBe(published + 1)
  expect(await postStatusOf(admin, post.postId)).toBe('published')
  // one attempt per call, codes only
  const attempts = await admin.query<{ step: string; outcome: string }>(
    `select step, outcome from target_attempts
      where target_id = any($1::uuid[]) order by created_at`,
    [out.map((t) => t.id)],
  )
  expect(attempts.rows.filter((a) => a.outcome === 'done')).toHaveLength(4)
  // Meta downloaded the copies from the public host
  expect(host.paths.some((p) => p.startsWith('/m/'))).toBe(true)
})

test('the same job twice, and a job of an old generation, do nothing', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  const [first] = await targetsOf(admin, post.postId)
  if (!first) throw new Error('no destination')
  const deps = workerDeps(runtime, clock, host.url)
  const containers = callsTo('/media')
  expect(await prepareTarget(deps, job(world, first))).toMatchObject({ to: 'ready' })
  expect(await prepareTarget(deps, job(world, first))).toEqual({
    outcome: 'skipped',
    why: 'moved on',
  })
  expect(callsTo('/media')).toBe(containers + 1)
  clock.set(at)
  const [ready] = await targetsOf(admin, post.postId)
  if (!ready) throw new Error('no destination')
  const published = callsTo('/media_publish')
  await publishTarget(deps, job(world, ready))
  await publishTarget(deps, job(world, ready))
  expect(callsTo('/media_publish')).toBe(published + 1)
})

test('a worker stopped after the call that publishes: the reconciler takes it as uncertain, never publishes again', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  await runSteps(world, post.postId, clock, 'prepare')
  clock.set(at)
  const [ready] = await targetsOf(admin, post.postId)
  if (!ready) throw new Error('no destination')
  // the publisher goes out on Meta, then the process dies before writing the outcome
  const real = runtime.publishers.instagram as PlatformPublisher
  const dying: PlatformPublisher = {
    ...real,
    publish: async (target, files, ctx) => {
      await real.publish(target, files, ctx)
      throw new WorkerDied()
    },
  }
  const deps = workerDeps(runtime, clock, host.url)
  const published = callsTo('/media_publish')
  // a death the handler cannot see: the transaction of the outcome never runs
  await expect(
    publishTarget(
      { ...deps, publishers: { instagram: dying }, uow: diesAfterCall(deps.uow) },
      job(world, ready),
    ),
  ).rejects.toThrow(WorkerDied)
  const [left] = await targetsOf(admin, post.postId)
  expect(left?.status).toBe('publishing')
  // the job again (pg-boss retries it): nothing, the destination is not `ready` any more
  await publishTarget(deps, job(world, ready))
  expect(callsTo('/media_publish')).toBe(published + 1)
  // six minutes later the reconciler finds it and takes it as uncertain
  clock.set(new Date(at.getTime() + 7 * MINUTE))
  await reconcilePublishing(deps)
  const [after] = await targetsOf(admin, post.postId)
  expect(after).toMatchObject({ status: 'unknown', step: 'publish' })
  expect(after?.next_attempt_at?.getTime()).toBe(at.getTime() + 9 * MINUTE)
  await publishTarget(deps, job(world, after as TargetRow))
  expect(callsTo('/media_publish')).toBe(published + 1)
})

test('a worker stopped halfway through the preparation resumes from the saved ids', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  const [scheduled] = await targetsOf(admin, post.postId)
  if (!scheduled) throw new Error('no destination')
  const real = runtime.publishers.instagram as PlatformPublisher
  // the worker stops: the call is aborted, and the step leaves the destination as it is
  const stop = new AbortController()
  const dying: PlatformPublisher = {
    ...real,
    prepare: async (target, files, ctx) => {
      await real.prepare(target, files, ctx)
      stop.abort()
      throw new WorkerDied()
    },
  }
  const deps = workerDeps(runtime, clock, host.url)
  const containers = callsTo('/media')
  await expect(
    prepareTarget(
      { ...deps, publishers: { instagram: dying } },
      { ...job(world, scheduled), signal: stop.signal },
    ),
  ).rejects.toThrow(WorkerDied)
  const [left] = await targetsOf(admin, post.postId)
  expect(left?.status).toBe('preparing')
  expect(left?.meta_ids).not.toBeNull()
  // the reconciler sends the step again once the claim has expired
  clock.set(new Date(at.getTime() - 8 * MINUTE))
  await reconcilePublishing(deps)
  const sent = deps.queue.sent.filter(
    (s) =>
      s.name === 'target.prepare' && (s.data as { targetId: string }).targetId === scheduled.id,
  )
  expect(sent).toHaveLength(1)
  await prepareTarget(deps, sent[0]?.data as ReturnType<typeof job>)
  const [ready] = await targetsOf(admin, post.postId)
  expect(ready?.status).toBe('ready')
  // the container made before the stop is the one used
  expect(callsTo('/media')).toBe(containers + 1)
})

test('a post changed while ready is prepared again with the new text; the old jobs do nothing', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  await runSteps(world, post.postId, clock, 'prepare')
  const [ready] = await targetsOf(admin, post.postId)
  if (!ready) throw new Error('no destination')
  const version =
    (
      await admin.query<{ version: number }>('select version from posts where id = $1', [
        post.postId,
      ])
    ).rows[0]?.version ?? 0
  const queue = postsDeps(runtime).queue as ReturnType<typeof workerDeps>['queue']
  await updatePost(
    { ...postsDeps(runtime), queue },
    world.actor,
    post.postId,
    { workspaceId: world.workspaceId, version, caption: { common: 'Pane caldo alle 19' } },
    { ip: null },
  )
  const [again] = await targetsOf(admin, post.postId)
  expect(again).toMatchObject({ status: 'scheduled', step: null, attempts: 0 })
  expect(again?.generation).toBeGreaterThan(ready.generation)
  expect(again?.meta_ids).toHaveProperty('_discard')
  expect(await postStatusOf(admin, post.postId)).toBe('scheduled')
  // a new preparation is queued, and the publish step of the old round does nothing
  expect(queue.sent.map((s) => s.name)).toContain('target.prepare')
  clock.set(at)
  const deps = workerDeps(runtime, clock, host.url)
  const published = callsTo('/media_publish')
  expect(await publishTarget(deps, job(world, ready))).toEqual({
    outcome: 'skipped',
    why: 'moved on',
  })
  expect(callsTo('/media_publish')).toBe(published)
  // the new round: a new container with the new text, then out
  const containers = mock.calls().filter((c) => c.method === 'POST' && c.path.endsWith('/media'))
  await prepareTarget(deps, job(world, again as TargetRow))
  const made = mock.calls().filter((c) => c.method === 'POST' && c.path.endsWith('/media'))
  expect(made).toHaveLength(containers.length + 1)
  expect(made.at(-1)?.params['caption']).toBe('Pane caldo alle 19')
  const [readyAgain] = await targetsOf(admin, post.postId)
  expect(readyAgain?.meta_ids).not.toHaveProperty('_discard')
  await publishTarget(deps, job(world, readyAgain as TargetRow))
  expect((await targetsOf(admin, post.postId))[0]?.status).toBe('published')
})

test('back to draft while ready: the queued step does nothing', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  await runSteps(world, post.postId, clock, 'prepare')
  const [ready] = await targetsOf(admin, post.postId)
  const version =
    (
      await admin.query<{ version: number }>('select version from posts where id = $1', [
        post.postId,
      ])
    ).rows[0]?.version ?? 0
  await unschedulePost(
    postsDeps(runtime),
    world.actor,
    { workspaceId: world.workspaceId, postId: post.postId, version },
    { ip: null },
  )
  expect(await postStatusOf(admin, post.postId)).toBe('draft')
  clock.set(at)
  const published = callsTo('/media_publish')
  await publishTarget(workerDeps(runtime, clock, host.url), job(world, ready as TargetRow))
  expect(callsTo('/media_publish')).toBe(published)
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({
    status: 'draft',
    next_attempt_at: null,
  })
})

test('D-77: a worker stopped for 20 minutes does not publish late; the destination fails with too_late', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() + 20 * MINUTE))
  await runSteps(world, post.postId, clock, 'prepare')
  const [late] = await targetsOf(admin, post.postId)
  expect(late).toMatchObject({
    status: 'failed',
    last_error_code: 'too_late',
    next_attempt_at: null,
  })
  expect(await postStatusOf(admin, post.postId)).toBe('failed')
  const events = await admin.query<{ type: string; payload: Record<string, unknown> }>(
    'select type, payload from outbox_events where organization_id = $1 order by created_at',
    [world.organizationId],
  )
  expect(events.rows).toEqual([
    {
      type: 'post.target_failed',
      payload: {
        postId: post.postId,
        targetId: late?.id,
        accountId: world.accounts.instagram,
        workspaceId: world.workspaceId,
        code: 'too_late',
      },
    },
  ])
})

test('ready and then late by 20 minutes: the publish step fails with too_late, no call', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  await runSteps(world, post.postId, clock, 'prepare')
  clock.set(new Date(at.getTime() + 20 * MINUTE))
  const published = callsTo('/media_publish')
  await runSteps(world, post.postId, clock, 'publish')
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({
    status: 'failed',
    last_error_code: 'too_late',
  })
  expect(callsTo('/media_publish')).toBe(published)
})

test('the person who scheduled is no longer active: paused with an event, nothing on Meta', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  await admin.query(
    "update organization_members set status = 'disabled' where organization_id = $1 and user_id = $2",
    [world.organizationId, world.ownerId],
  )
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  const containers = callsTo('/media')
  await runSteps(world, post.postId, clock, 'prepare')
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({
    status: 'paused',
    last_error_code: 'author_lost_permission',
  })
  expect(await postStatusOf(admin, post.postId)).toBe('paused')
  expect(callsTo('/media')).toBe(containers)
  const events = await admin.query<{ type: string }>(
    'select type from outbox_events where organization_id = $1',
    [world.organizationId],
  )
  expect(events.rows.map((e) => e.type)).toEqual(['post.paused'])
})

test('a suspended agency: paused and no event', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query("update organizations set status = 'suspended', suspended_at = now() where id = $1", [
      world.organizationId,
    ]),
  )
  await runSteps(world, post.postId, testClock(new Date(at.getTime() - 15 * MINUTE)), 'prepare')
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({
    status: 'paused',
    last_error_code: 'organization_suspended',
  })
  const events = await admin.query('select 1 from outbox_events where organization_id = $1', [
    world.organizationId,
  ])
  expect(events.rowCount).toBe(0)
})

test('a temporary error before publishing is tried again when Meta serves the account again', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  mock.scenario('rate_limited', { path: /\/media$/, times: 1 })
  await runSteps(world, post.postId, clock, 'prepare')
  const [retrying] = await targetsOf(admin, post.postId)
  expect(retrying).toMatchObject({ status: 'retrying', step: 'prepare', attempts: 1 })
  // the rate limit said the account is at 100% and is served again in 5 minutes (§8.6): the
  // next attempt is then, not after 1 minute, so it is not slowed down a second time
  expect(retrying?.next_attempt_at?.getTime()).toBe(clock.now().getTime() + 5 * MINUTE)
  expect(retrying?.claimed_until).toBeNull()
  mock.scenario('default')
  clock.set(new Date(clock.now().getTime() + 5 * MINUTE))
  await prepareTarget(workerDeps(runtime, clock, host.url), job(world, retrying as TargetRow))
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({ status: 'ready', attempts: 0 })
})

test('CS1: six destinations of one agency at the same time all go out within the minute', async () => {
  const world = await publishingWorld(tdb, runtime)
  const photo = await readyPhoto(tdb, runtime, admin, world)
  const at = inMinutes(50)
  const posts: { postId: string }[] = []
  for (const caption of ['Uno', 'Due', 'Tre'])
    posts.push(
      await scheduledPost(runtime, world, {
        at,
        mediaIds: [photo],
        caption,
        accounts: [world.accounts.facebook, world.accounts.instagram],
      }),
    )
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  const deps = workerDeps(runtime, clock, host.url)
  const all = async () => (await Promise.all(posts.map((p) => targetsOf(admin, p.postId)))).flat()
  // every 20 seconds the reconciler sends what is due, and the worker runs it all at once
  for (let round = 0; round < 40; round += 1) {
    const targets = await all()
    if (targets.every((t) => t.status === 'ready')) break
    deps.queue.sent.length = 0
    await reconcilePublishing(deps)
    const ids = new Set(targets.map((t) => t.id))
    const running = deps.queue.sent.filter(
      (s) => s.name === 'target.prepare' && ids.has((s.data as { targetId: string }).targetId),
    )
    // never more than one preparation per account, three per agency, at the same time
    await Promise.all(running.map((s) => prepareTarget(deps, s.data as ReturnType<typeof job>)))
    clock.set(new Date(clock.now().getTime() + 20_000))
  }
  expect((await all()).map((t) => t.status)).toEqual(Array(6).fill('ready'))
  expect(clock.now().getTime()).toBeLessThan(at.getTime())

  clock.set(at)
  deps.queue.sent.length = 0
  await reconcilePublishing(deps)
  // the reconciler reads every agency: only this test's destinations are run here
  const ours = new Set((await all()).map((t) => t.id))
  const publishing = deps.queue.sent.filter(
    (s) => s.name === 'target.publish' && ours.has((s.data as { targetId: string }).targetId),
  )
  expect(publishing).toHaveLength(6)
  await Promise.all(publishing.map((s) => publishTarget(deps, s.data as ReturnType<typeof job>)))
  const out = await admin.query<{ status: string; published_at: Date }>(
    'select status, published_at from post_targets where post_id = any($1::uuid[])',
    [posts.map((p) => p.postId)],
  )
  expect(out.rows.map((r) => r.status)).toEqual(Array(6).fill('published'))
  expect(out.rows.every((r) => r.published_at.getTime() - at.getTime() < MINUTE)).toBe(true)
})

class WorkerDied extends Error {}

test('R4: a worker stopped during the preparation for hours never publishes late', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  const deps = workerDeps(runtime, clock, host.url)
  const [scheduled] = await targetsOf(admin, post.postId)
  if (!scheduled) throw new Error('no destination')
  // the container is made on Meta, then the process dies before writing the outcome
  await expect(
    prepareTarget({ ...deps, uow: diesAfterCall(deps.uow) }, job(world, scheduled)),
  ).rejects.toThrow(WorkerDied)
  const [left] = await targetsOf(admin, post.postId)
  expect(left?.status).toBe('preparing')
  // back four hours later: the reconciler sends the preparation again
  clock.set(new Date(at.getTime() + 4 * 60 * MINUTE))
  const published = callsTo('/media_publish')
  await prepareTarget(deps, job(world, left as TargetRow))
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({
    status: 'failed',
    last_error_code: 'too_late',
  })
  expect(callsTo('/media_publish')).toBe(published)
})

test('R4: a quota that frees up past the 60 minutes fails the destination at once', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  await runSteps(world, post.postId, clock, 'prepare')
  clock.set(new Date(at.getTime() + 5 * MINUTE))
  mock.scenario('quota_exhausted')
  // Meta's window frees up 75 minutes after the time
  const real = runtime.publishers.instagram as PlatformPublisher
  const lateWindow: PlatformPublisher = {
    ...real,
    publish: async (target, files, ctx) => {
      const result = await real.publish(target, files, ctx)
      return result.outcome === 'wait'
        ? { ...result, retryAt: new Date(at.getTime() + 75 * MINUTE) }
        : result
    },
  }
  const deps = workerDeps(runtime, clock, host.url)
  const [ready] = await targetsOf(admin, post.postId)
  if (!ready) throw new Error('no destination')
  await publishTarget({ ...deps, publishers: { instagram: lateWindow } }, job(world, ready))
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({
    status: 'failed',
    last_error_code: 'quota_exhausted',
    next_attempt_at: null,
  })
})

test('R4: a quota wait that brings the publication past the 60 minutes ends with its reason', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  await runSteps(world, post.postId, clock, 'prepare')
  clock.set(new Date(at.getTime() + 5 * MINUTE))
  mock.scenario('quota_exhausted')
  await runSteps(world, post.postId, clock, 'publish')
  const [waiting] = await targetsOf(admin, post.postId)
  expect(waiting).toMatchObject({ status: 'retrying', last_error_code: 'quota_exhausted' })
  // the worker was stopped: it comes back past the hour
  clock.set(new Date(at.getTime() + 61 * MINUTE))
  const published = callsTo('/media_publish')
  await publishTarget(workerDeps(runtime, clock, host.url), job(world, waiting as TargetRow))
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({
    status: 'failed',
    last_error_code: 'quota_exhausted',
  })
  expect(callsTo('/media_publish')).toBe(published)
})

test('R8: a preparation waiting for its copies past the 15 minutes still publishes', async () => {
  const { world, photo, at, post } = await setUp({ accounts: 'instagram' })
  // «Pubblica subito» of a long video: the copies are still being made at the time
  await admin.query("update media_variants set status = 'pending' where media_id = $1", [photo])
  const clock = testClock(at)
  await runSteps(world, post.postId, clock, 'prepare')
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({ status: 'scheduled' })
  await admin.query("update media_variants set status = 'ready' where media_id = $1", [photo])
  clock.set(new Date(at.getTime() + 20 * MINUTE))
  await runSteps(world, post.postId, clock, 'prepare')
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({ status: 'ready' })
  await runSteps(world, post.postId, clock, 'publish')
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({ status: 'published' })
})

test('R9: without PUBLIC_URL the destination fails with its reason, never waits in silence', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const deps = { ...workerDeps(runtime, testClock(new Date(at.getTime() - 15 * MINUTE)), host.url) }
  const [scheduled] = await targetsOf(admin, post.postId)
  await prepareTarget({ ...deps, publicUrl: null }, job(world, scheduled as TargetRow))
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({
    status: 'failed',
    last_error_code: 'public_host_off',
  })
})

test('R7: an archived client with a post half out: what is left is cancelled, no endless error', async () => {
  const { world, at, post } = await setUp()
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  await runSteps(world, post.postId, clock, 'prepare')
  clock.set(at)
  const [facebook, instagram] = await targetsOf(admin, post.postId)
  const deps = workerDeps(runtime, clock, host.url)
  await publishTarget(deps, job(world, instagram as TargetRow))
  // archived meanwhile, as the archiving leaves a post with a destination out
  await admin.query('update workspaces set archived_at = now() where id = $1', [world.workspaceId])
  const photos = callsTo('/photos')
  expect(await publishTarget(deps, job(world, facebook as TargetRow))).toMatchObject({
    outcome: 'moved',
    to: 'cancelled',
  })
  expect(callsTo('/photos')).toBe(photos)
  const after = await targetsOf(admin, post.postId)
  expect(after.map((t) => t.status)).toEqual(['cancelled', 'published'])
  expect(await postStatusOf(admin, post.postId)).toBe('published')
  await admin.query('update workspaces set archived_at = null where id = $1', [world.workspaceId])
})

test('a preparation that ends after the time still publishes: D-77 (b) is for the first start only', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  mock.scenario('rate_limited', { path: /\/media$/, times: 1 })
  await runSteps(world, post.postId, clock, 'prepare')
  mock.scenario('default')
  // the attempt after the error, and turns waited: ready 14 minutes after the time
  clock.set(new Date(at.getTime() + 14 * MINUTE))
  await runSteps(world, post.postId, clock, 'prepare')
  const [ready] = await targetsOf(admin, post.postId)
  expect(ready).toMatchObject({ status: 'ready' })
  expect(ready?.next_attempt_at?.getTime()).toBe(clock.now().getTime())
  clock.set(new Date(at.getTime() + 17 * MINUTE))
  const published = callsTo('/media_publish')
  await runSteps(world, post.postId, clock, 'publish')
  expect((await targetsOf(admin, post.postId))[0]).toMatchObject({ status: 'published' })
  expect(callsTo('/media_publish')).toBe(published + 1)
})

test('an unexpected error of the preparation counts as an attempt, so it has an end', async () => {
  const { world, at, post } = await setUp({ accounts: 'instagram' })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  const real = runtime.publishers.instagram as PlatformPublisher
  const deps = {
    ...workerDeps(runtime, clock, host.url),
    publishers: {
      ...runtime.publishers,
      instagram: { ...real, prepare: () => Promise.reject(new Error('an answer never seen')) },
    },
  }
  const [scheduled] = await targetsOf(admin, post.postId)
  await prepareTarget(deps, job(world, scheduled as TargetRow))
  const [after] = await targetsOf(admin, post.postId)
  expect(after).toMatchObject({
    status: 'retrying',
    step: 'prepare',
    attempts: 1,
    last_error_code: 'meta_error',
    claimed_until: null,
  })
  expect(after?.next_attempt_at?.getTime()).toBe(clock.now().getTime() + MINUTE)
})

test('a job used up without moving its destination: the reconciler sends a new one every 10 minutes', async () => {
  const { at, post } = await setUp({ accounts: 'instagram' })
  const [scheduled] = await targetsOf(admin, post.postId)
  if (!scheduled) throw new Error('no destination')
  const keysSent = (deps: ReturnType<typeof workerDeps>) =>
    deps.queue.sent
      .filter((j) => (j.data as { targetId?: string }).targetId === scheduled.id)
      .map((j) => (j.opts as { dedupeKey?: string } | undefined)?.dedupeKey)
  const base = `${scheduled.id}:prepare:${String(scheduled.generation)}`
  const clock = testClock(new Date(at.getTime() - 14 * MINUTE))
  const early = workerDeps(runtime, clock, host.url)
  await reconcilePublishing(early)
  // a job still waiting has the same key: not doubled
  expect(keysSent(early)).toEqual([base])
  clock.set(new Date(at.getTime() - 4 * MINUTE))
  const late = workerDeps(runtime, clock, host.url)
  await reconcilePublishing(late)
  expect(keysSent(late)).toEqual([`${base}:r1`])
})

/** A unit of work whose transactions after the first one die with the process. */
function diesAfterCall(uow: Runtime['uow']): Runtime['uow'] {
  let runs = 0
  return {
    ...uow,
    run: (scope, fn) => {
      runs += 1
      return runs === 1 ? uow.run(scope, fn) : Promise.reject(new WorkerDied())
    },
  }
}
