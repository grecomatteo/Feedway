import pg from 'pg'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { prepareTarget, publishTarget, reconcilePublishing, type StepLog } from '@app/application'
import type { Runtime } from '@app/infrastructure'
import { startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { startMetaMock, type MetaMock } from '@app/meta-mock'
import { accountsRuntime, handlerDeps, recordingQueue } from '../../tests/accounts-jobs.js'
import {
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
import { mediaPublishCopiesCleanup } from './media-publish-copies-cleanup.js'

// The limits around the publishing (plan 07 Task 7, second part): the slowing down above 80% of
// Meta's usage (§8.6) and CS1 at 85%, the quota nearly over (`account.quota_low`), the check 3
// hours before (Scelta 4) and the nightly clean-up of the copies (Scelta 5).

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

const inMinutes = (n: number) => new Date(Math.ceil((Date.now() + n * MINUTE) / MINUTE) * MINUTE)

const callsTo = (suffix: string, method = 'POST') =>
  mock.calls().filter((c) => c.method === method && c.path.endsWith(suffix)).length

const job = (world: PublishingWorld, t: Pick<TargetRow, 'id' | 'generation'>) => ({
  organizationId: world.organizationId,
  targetId: t.id,
  generation: t.generation,
})

async function setUp(opts: { at?: Date; type?: 'photo' | 'story' } = {}) {
  const world = await publishingWorld(tdb, runtime)
  const photo = await readyPhoto(tdb, runtime, admin, world)
  const at = opts.at ?? inMinutes(40)
  const post = await scheduledPost(runtime, world, {
    at,
    mediaIds: [photo],
    accounts: [world.accounts.instagram],
    ...(opts.type ? { type: opts.type } : {}),
  })
  const [target] = await targetsOf(admin, post.postId)
  if (!target) throw new Error('no destination')
  return { world, photo, at, post, target }
}

async function usageOf(accountId: string) {
  const { rows } = await admin.query<{
    usage_account_percent: number | null
    usage_app_percent: number | null
    usage_regain_minutes: number | null
    usage_read_at: Date | null
  }>(
    `select usage_account_percent, usage_app_percent, usage_regain_minutes, usage_read_at
       from social_accounts where id = $1`,
    [accountId],
  )
  return rows[0]
}

const setUsage = (
  accountId: string,
  usage: { account?: number; app?: number; regain?: number; at: Date },
) =>
  admin.query(
    `update social_accounts
        set usage_account_percent = $2, usage_app_percent = $3, usage_regain_minutes = $4,
            usage_read_at = $5
      where id = $1`,
    [accountId, usage.account ?? null, usage.app ?? null, usage.regain ?? 0, usage.at],
  )

const eventsOf = async (organizationId: string, type: string) =>
  (
    await admin.query<{ payload: Record<string, unknown> }>(
      'select payload from outbox_events where organization_id = $1 and type = $2 order by created_at',
      [organizationId, type],
    )
  ).rows.map((r) => r.payload)

test("every step saves Meta's usage on its account, with the time it was read", async () => {
  const { world, at, target } = await setUp()
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  mock.scenario('usage_high', { app: 40, business: 70, minutesToRegain: 0 })
  await prepareTarget(workerDeps(runtime, clock, host.url), job(world, target))
  expect(await usageOf(world.accounts.instagram)).toEqual({
    usage_account_percent: 70,
    usage_app_percent: 40,
    usage_regain_minutes: 0,
    usage_read_at: clock.now(),
  })
})

test("above 80% of the account's usage the preparation waits what Meta says, without an attempt", async () => {
  const { world, at, post, target } = await setUp()
  const start = new Date(at.getTime() - 15 * MINUTE)
  await setUsage(world.accounts.instagram, { account: 88, regain: 3, at: start })
  const clock = testClock(start)
  const containers = callsTo('/media')
  const deps = workerDeps(runtime, clock, host.url)
  expect(await prepareTarget(deps, job(world, target))).toEqual({
    outcome: 'waiting',
    why: 'slowing down',
  })
  const [waiting] = await targetsOf(admin, post.postId)
  expect(waiting).toMatchObject({ status: 'scheduled', attempts: 0 })
  expect(waiting?.next_attempt_at).toEqual(new Date(start.getTime() + 3 * MINUTE))
  expect(callsTo('/media')).toBe(containers)
  // the job for the new time, in a new generation
  expect(deps.queue.sent).toEqual([
    expect.objectContaining({
      name: 'target.prepare',
      opts: expect.objectContaining({
        startAfter: new Date(start.getTime() + 3 * MINUTE),
      }) as object,
    }),
  ])
  // once the wait is over the step runs, and its answer is the next reading
  clock.set(new Date(start.getTime() + 3 * MINUTE))
  if (!waiting) throw new Error('no destination')
  await prepareTarget(deps, job(world, waiting))
  expect(callsTo('/media')).toBe(containers + 1)
  expect((await usageOf(world.accounts.instagram))?.usage_account_percent).toBe(4)
})

test("the app's usage read on another account of the agency slows this one; another agency's does not", async () => {
  const { world, at, target } = await setUp()
  const start = new Date(at.getTime() - 15 * MINUTE)
  const other = await setUp()
  // the Facebook page of this agency read 90% of the app a moment ago
  await setUsage(world.accounts.facebook, { app: 90, at: new Date(start.getTime() - 10_000) })
  // the other agency is at 99%: nothing to do with this one
  await setUsage(other.world.accounts.instagram, { account: 99, app: 99, regain: 5, at: start })
  const clock = testClock(start)
  const deps = workerDeps(runtime, clock, host.url)
  expect(await prepareTarget(deps, job(world, target))).toMatchObject({ why: 'slowing down' })
  const [waiting] = await targetsOf(admin, await postOf(target.id))
  expect(waiting?.next_attempt_at).toEqual(new Date(start.getTime() - 10_000 + MINUTE))
})

test('publish waits only above 95%: at 85% the post goes out at its time', async () => {
  const { world, at, target } = await setUp()
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  const deps = workerDeps(runtime, clock, host.url)
  await prepareTarget(deps, job(world, target))
  const postId = await postOf(target.id)
  const [ready] = await targetsOf(admin, postId)
  if (!ready) throw new Error('no destination')
  expect(ready.status).toBe('ready')

  clock.set(at)
  await setUsage(world.accounts.instagram, { account: 97, regain: 2, at })
  const published = callsTo('/media_publish')
  expect(await publishTarget(deps, job(world, ready))).toMatchObject({ why: 'slowing down' })
  const [waiting] = await targetsOf(admin, postId)
  expect(waiting).toMatchObject({ status: 'ready', attempts: 0 })
  expect(waiting?.next_attempt_at).toEqual(new Date(at.getTime() + 2 * MINUTE))
  expect(callsTo('/media_publish')).toBe(published)

  // the usage went down to 85%: the step publishes
  await setUsage(world.accounts.instagram, { account: 85, app: 85, regain: 2, at })
  if (!waiting) throw new Error('no destination')
  expect(await publishTarget(deps, job(world, waiting))).toEqual({
    outcome: 'moved',
    to: 'published',
  })
  expect(callsTo('/media_publish')).toBe(published + 1)
})

test('the waits of publish end 5 minutes after the time: then it goes out, never late without end', async () => {
  const { world, at, post, target } = await setUp()
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  const deps = workerDeps(runtime, clock, host.url)
  await prepareTarget(deps, job(world, target))
  const [ready] = await targetsOf(admin, post.postId)
  if (!ready) throw new Error('no destination')
  // a first wait, to 4 minutes after the time
  clock.set(at)
  await setUsage(world.accounts.instagram, { account: 99, regain: 4, at })
  expect(await publishTarget(deps, job(world, ready))).toMatchObject({ why: 'slowing down' })
  const [waiting] = await targetsOf(admin, post.postId)
  if (!waiting) throw new Error('no destination')
  // still at 99% then: another wait would end past 5 minutes after the time, so it publishes
  clock.set(new Date(at.getTime() + 4 * MINUTE))
  await setUsage(world.accounts.instagram, { account: 99, regain: 4, at: clock.now() })
  expect(await publishTarget(deps, job(world, waiting))).toEqual({
    outcome: 'moved',
    to: 'published',
  })
})

test('CS1: five destinations of one agency at 18:00 all go out within the minute with Meta at 85%', async () => {
  const world = await publishingWorld(tdb, runtime)
  const photo = await readyPhoto(tdb, runtime, admin, world)
  const at = inMinutes(50)
  const posts: { postId: string }[] = []
  // three on both accounts, then remove one: five destinations, two on each account and one more
  for (const caption of ['Uno', 'Due', 'Tre'])
    posts.push(
      await scheduledPost(runtime, world, {
        at,
        mediaIds: [photo],
        caption,
        accounts:
          caption === 'Tre'
            ? [world.accounts.instagram]
            : [world.accounts.facebook, world.accounts.instagram],
      }),
    )
  // every answer of Meta says 85%, of the accounts and of the app, with 2 minutes to regain
  mock.scenario('usage_high', { app: 85, business: 85, minutesToRegain: 2 })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  const deps = workerDeps(runtime, clock, host.url)
  const all = async () => (await Promise.all(posts.map((p) => targetsOf(admin, p.postId)))).flat()
  expect(await all()).toHaveLength(5)
  const logs: StepLog[] = []
  for (let round = 0; round < 60; round += 1) {
    const targets = await all()
    if (targets.every((t) => t.status === 'ready')) break
    deps.queue.sent.length = 0
    await reconcilePublishing(deps)
    const ids = new Set(targets.map((t) => t.id))
    const running = deps.queue.sent.filter(
      (s) => s.name === 'target.prepare' && ids.has((s.data as { targetId: string }).targetId),
    )
    logs.push(
      ...(await Promise.all(
        running.map((s) => prepareTarget(deps, s.data as ReturnType<typeof job>)),
      )),
    )
    clock.set(new Date(clock.now().getTime() + 20_000))
  }
  expect((await all()).map((t) => t.status)).toEqual(Array(5).fill('ready'))
  // the slowing down did work, and the preparations still ended before the time
  expect(logs).toContainEqual({ outcome: 'waiting', why: 'slowing down' })
  expect(clock.now().getTime()).toBeLessThan(at.getTime())

  clock.set(at)
  deps.queue.sent.length = 0
  await reconcilePublishing(deps)
  const ours = new Set((await all()).map((t) => t.id))
  const publishing = deps.queue.sent.filter(
    (s) => s.name === 'target.publish' && ours.has((s.data as { targetId: string }).targetId),
  )
  expect(publishing).toHaveLength(5)
  await Promise.all(publishing.map((s) => publishTarget(deps, s.data as ReturnType<typeof job>)))
  const out = await admin.query<{ status: string; published_at: Date }>(
    'select status, published_at from post_targets where post_id = any($1::uuid[])',
    [posts.map((p) => p.postId)],
  )
  expect(out.rows.map((r) => r.status)).toEqual(Array(5).fill('published'))
  expect(out.rows.every((r) => r.published_at.getTime() - at.getTime() < MINUTE)).toBe(true)
})

test('the quota nearly over is told once per window, and saved on the account', async () => {
  const { world, at, target } = await setUp()
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  const deps = workerDeps(runtime, clock, host.url)
  await prepareTarget(deps, job(world, target))
  const postId = await postOf(target.id)
  const [ready] = await targetsOf(admin, postId)
  if (!ready) throw new Error('no destination')
  clock.set(at)
  mock.scenario('quota_exhausted')
  expect(await publishTarget(deps, job(world, ready))).toMatchObject({ to: 'retrying' })
  expect(await eventsOf(world.organizationId, 'account.quota_low')).toEqual([
    { accountId: world.accounts.instagram, left: 0, total: 50 },
  ])
  const { rows } = await admin.query<{ quota_used: number; quota_total: number }>(
    'select quota_used, quota_total from social_accounts where id = $1',
    [world.accounts.instagram],
  )
  expect(rows[0]).toEqual({ quota_used: 50, quota_total: 50 })
  // the next try, in the same window: no second event
  const [retrying] = await targetsOf(admin, postId)
  if (!retrying?.next_attempt_at) throw new Error('no retry')
  clock.set(retrying.next_attempt_at)
  await publishTarget(deps, job(world, retrying))
  expect(await eventsOf(world.organizationId, 'account.quota_low')).toHaveLength(1)
})

test('Scelta 4: the post is checked again 3 hours before; a file that will not go out is told then', async () => {
  const at = inMinutes(5 * 60)
  const { world, photo, post, target } = await setUp({ at })
  const recheck = async () =>
    (
      await admin.query<{ recheck_at: Date | null }>(
        'select recheck_at from post_targets where id = $1',
        [target.id],
      )
    ).rows[0]?.recheck_at
  expect(await recheck()).toEqual(new Date(at.getTime() - 3 * 60 * MINUTE))
  const clock = testClock(new Date(at.getTime() - 4 * 60 * MINUTE))
  const deps = workerDeps(runtime, clock, host.url)
  await reconcilePublishing(deps)
  expect(await recheck()).not.toBeNull()

  // meanwhile the file is gone: 3 hours before, the worker tells
  await admin.query("update media set status = 'deleted', deleted_at = now() where id = $1", [
    photo,
  ])
  clock.set(new Date(at.getTime() - 3 * 60 * MINUTE))
  const report = await reconcilePublishing(deps)
  expect(report.told).toBeGreaterThanOrEqual(1)
  expect(await recheck()).toBeNull()
  expect(await eventsOf(world.organizationId, 'post.file_wont_publish')).toEqual([
    expect.objectContaining({
      postId: post.postId,
      targetId: target.id,
      accountId: world.accounts.instagram,
      code: expect.any(String) as string,
      when: 'before',
    }),
  ])
  // once only: the next minute has nothing to check
  clock.set(new Date(clock.now().getTime() + MINUTE))
  await reconcilePublishing(deps)
  expect(await eventsOf(world.organizationId, 'post.file_wont_publish')).toHaveLength(1)
  // the destination itself waits for its preparation, which fails it then
  const [still] = await targetsOf(admin, post.postId)
  expect(still?.status).toBe('scheduled')
})

test('Scelta 4: a post scheduled less than 3 hours before is checked at once, and a good one says nothing', async () => {
  const before = Date.now()
  const { world, at, target } = await setUp({ at: inMinutes(60) })
  const { rows } = await admin.query<{ recheck_at: Date }>(
    'select recheck_at from post_targets where id = $1',
    [target.id],
  )
  const checkAt = rows[0]?.recheck_at.getTime() ?? 0
  expect(checkAt).toBeGreaterThanOrEqual(before - 1000)
  expect(checkAt).toBeLessThan(at.getTime() - 50 * MINUTE)
  await reconcilePublishing(workerDeps(runtime, testClock(new Date()), host.url))
  const after = await admin.query<{ recheck_at: Date | null }>(
    'select recheck_at from post_targets where id = $1',
    [target.id],
  )
  expect(after.rows[0]?.recheck_at).toBeNull()
  expect(await eventsOf(world.organizationId, 'post.file_wont_publish')).toEqual([])
})

/** A copy with a recipe of the file, as `media.publish_copies` leaves it, with bytes. */
async function recipeCopy(world: PublishingWorld, mediaId: string, recipe: string, ageMs: number) {
  const key = `org/${world.organizationId}/media/${mediaId}/story-${recipe}.jpg`
  await runtime.storage.put(key, Buffer.from('copy'), { contentType: 'image/jpeg' })
  const token = `${recipe}${'x'.repeat(32)}`.slice(0, 32)
  const { rows } = await admin.query<{ id: string }>(
    `insert into media_variants
       (id, organization_id, media_id, purpose, storage_key, public_token, mime, size_bytes,
        recipe, status, created_at)
     values (gen_random_uuid(), $1, $2, 'story', $3, $4, 'image/jpeg', 4, $5, 'ready', $6)
     returning id`,
    [world.organizationId, mediaId, key, token, recipe, new Date(Date.now() - ageMs)],
  )
  return { id: rows[0]?.id ?? '', key }
}

const copiesOf = async (mediaId: string) =>
  (
    await admin.query<{ recipe: string }>(
      "select recipe from media_variants where media_id = $1 and recipe <> '' order by recipe",
      [mediaId],
    )
  ).rows.map((r) => r.recipe)

const cleanUp = () =>
  mediaPublishCopiesCleanup(
    { id: 'cleanup', data: {} },
    { ...handlerDeps(runtime, recordingQueue()), clock: { now: () => new Date() } },
  )

test('Scelta 5: the nightly clean-up keeps the copies a post needs, and removes old recipes and ended posts', async () => {
  const { world, photo, post } = await setUp({ type: 'story' })
  // another agency with its own scheduled story: its copy is never touched by this one's posts
  const other = await setUp({ type: 'story' })
  await admin.query(
    "update media_variants set created_at = now() - interval '2 hours' where media_id = $1",
    [other.photo],
  )
  const othersCopies = await copiesOf(other.photo)
  expect(othersCopies).toHaveLength(1)
  // the copy the scheduled story asked for, made an hour and more ago
  const asked = await copiesOf(photo)
  expect(asked).toHaveLength(1)
  await admin.query(
    "update media_variants set created_at = now() - interval '2 hours' where media_id = $1",
    [photo],
  )
  // a copy of an old recipe (the post was changed), and one just made: too young to go
  const old = await recipeCopy(world, photo, 'oldrecipe', 2 * 60 * MINUTE)
  await recipeCopy(world, photo, 'young', 5 * MINUTE)
  await cleanUp()
  expect(await copiesOf(photo)).toEqual([...asked, 'young'].sort())
  expect(await runtime.storage.get(old.key)).toBeNull()

  // the story failed 3 days ago: «Riprova» still finds its copy
  await admin.query(
    "update post_targets set status = 'failed', updated_at = now() - interval '3 days' where post_id = $1",
    [post.postId],
  )
  await admin.query(
    "update media_variants set created_at = now() - interval '2 hours' where media_id = $1",
    [photo],
  )
  await cleanUp()
  expect(await copiesOf(photo)).toEqual(asked)
  // 8 days: the post is over, its copies go; the file stays in the library
  await admin.query(
    "update post_targets set updated_at = now() - interval '8 days' where post_id = $1",
    [post.postId],
  )
  await cleanUp()
  expect(await copiesOf(photo)).toEqual([])
  expect(await copiesOf(other.photo)).toEqual(othersCopies)
  const { rows } = await admin.query<{ status: string }>('select status from media where id = $1', [
    photo,
  ])
  expect(rows[0]?.status).toBe('ready')
})

test('Scelta 5: a post whose author may no longer publish keeps every copy of its files', async () => {
  const { world, photo } = await setUp({ type: 'story' })
  await admin.query(
    "update media_variants set created_at = now() - interval '2 hours' where media_id = $1",
    [photo],
  )
  await recipeCopy(world, photo, 'oldrecipe', 2 * 60 * MINUTE)
  // the owner who scheduled is disabled: which copies the post needs cannot be told now
  await admin.query("update users set status = 'disabled' where id = $1", [world.ownerId])
  await cleanUp()
  expect(await copiesOf(photo)).toHaveLength(2)
})

test('R17: a clean-up whose transaction is lost after the bytes went leaves no copy without bytes', async () => {
  const { world, photo } = await setUp({ type: 'story' })
  await admin.query(
    "update media_variants set created_at = now() - interval '2 hours' where media_id = $1",
    [photo],
  )
  const old = await recipeCopy(world, photo, 'lostrecipe', 2 * 60 * MINUTE)
  const deps = { ...handlerDeps(runtime, recordingQueue()), clock: { now: () => new Date() } }
  // the transaction of this agency is lost after its work: as a commit that fails
  let lost = false
  const losing: typeof deps.uow = {
    ...deps.uow,
    run: (scope, work) =>
      deps.uow.run(scope, async (tx) => {
        const done = await work(tx)
        if (!lost && 'organizationId' in scope && scope.organizationId === world.organizationId) {
          lost = true
          throw new Error('commit lost')
        }
        return done
      }),
  }
  await expect(
    mediaPublishCopiesCleanup({ id: 'cleanup', data: {} }, { ...deps, uow: losing }),
  ).rejects.toThrow('clean-up failed')
  expect(lost).toBe(true)
  expect(await runtime.storage.get(old.key)).toBeNull()
  // its row went again: the preparation asks for the copy anew, Meta never gets a 404
  expect(await copiesOf(photo)).not.toContain('lostrecipe')
})

/** The post of a destination. */
async function postOf(targetId: string): Promise<string> {
  const { rows } = await admin.query<{ post_id: string }>(
    'select post_id from post_targets where id = $1',
    [targetId],
  )
  return rows[0]?.post_id ?? ''
}
