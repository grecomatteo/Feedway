import pg from 'pg'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import {
  PublishError,
  prepareTarget,
  publishTarget,
  reconcilePublishing,
  searchTarget,
  verifyTarget,
  type PlatformPublisher,
} from '@app/application'
import type { Runtime } from '@app/infrastructure'
import { startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { startMetaMock, type MetaMock } from '@app/meta-mock'
import { accountsRuntime } from '../../tests/accounts-jobs.js'
import {
  postStatusOf,
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

// What comes after the call that publishes (plan 07 Task 8, §9.5 and §9.6): the uncertain
// outcome searched on the account, the verification at 3, 10 and 30 minutes, and «Riprova» from
// `problem`, which asks Meta before publishing again. Against the database and the fake Graph API.

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

const plus = (at: Date, minutes: number) => new Date(at.getTime() + minutes * MINUTE)

const publishCalls = () =>
  mock.calls().filter((c) => c.method === 'POST' && c.path.endsWith('/media_publish')).length

const job = (world: PublishingWorld, t: Pick<TargetRow, 'id' | 'generation'>) => ({
  organizationId: world.organizationId,
  targetId: t.id,
  generation: t.generation,
})

async function only(postId: string): Promise<TargetRow> {
  const [target] = await targetsOf(admin, postId)
  if (!target) throw new Error('no destination')
  return target
}

async function eventsOf(world: PublishingWorld): Promise<{ type: string; payload: unknown }[]> {
  return (
    await admin.query<{ type: string; payload: unknown }>(
      'select type, payload from outbox_events where organization_id = $1 order by created_at, id',
      [world.organizationId],
    )
  ).rows
}

/**
 * An Instagram photo whose time is now, prepared and ready: the fake Graph API stamps what it
 * publishes with the real time, so the search's window must be around it.
 */
async function readyNow() {
  const world = await publishingWorld(tdb, runtime)
  const photo = await readyPhoto(tdb, runtime, admin, world)
  const post = await scheduledPost(runtime, world, {
    at: new Date(Math.ceil((Date.now() + 40 * MINUTE) / MINUTE) * MINUTE),
    mediaIds: [photo],
    accounts: [world.accounts.instagram],
  })
  await admin.query('update posts set scheduled_at = now() where id = $1', [post.postId])
  const clock = testClock(new Date())
  const deps = workerDeps(runtime, clock, host.url)
  await prepareTarget(deps, job(world, await only(post.postId)))
  const ready = await only(post.postId)
  expect(ready.status).toBe('ready')
  return { world, post, clock, deps, ready }
}

/** The real publisher, with `publish` answering an uncertain outcome after (or instead of) it. */
function uncertainPublisher(publishes: boolean): PlatformPublisher {
  const real = runtime.publishers.instagram as PlatformPublisher
  return {
    ...real,
    publish: async (target, files, ctx) => {
      if (publishes) await real.publish(target, files, ctx)
      throw new PublishError({ kind: 'uncertain', code: 'meta_error' })
    },
  }
}

/** Every job sent so far of that queue, for the destination. */
const sentOf = (deps: ReturnType<typeof workerDeps>, name: string, targetId: string) =>
  deps.queue.sent.filter(
    (s) => s.name === name && (s.data as { targetId: string }).targetId === targetId,
  )

/** Published and verified once: a destination in `verifying` after the first round, or done. */
async function publishedNow() {
  const set = await readyNow()
  await publishTarget(set.deps, job(set.world, set.ready))
  const out = await only(set.post.postId)
  expect(out.status).toBe('published')
  return { ...set, out }
}

test('an uncertain call that published: found by the search, then verified and confirmed', async () => {
  const { world, post, clock, deps, ready } = await readyNow()
  const before = publishCalls()
  const startedAt = clock.now()
  await publishTarget(
    { ...deps, publishers: { instagram: uncertainPublisher(true) } },
    job(world, ready),
  )
  const unknown = await only(post.postId)
  expect(unknown).toMatchObject({ status: 'unknown', step: 'publish', attempts: 0 })
  expect(unknown.next_attempt_at?.getTime()).toBe(startedAt.getTime() + 2 * MINUTE)
  // the first search is queued at its time, under its own key
  const [search] = sentOf(deps, 'target.reconcile', ready.id)
  expect((search?.opts as { startAfter: Date }).startAfter).toEqual(unknown.next_attempt_at)
  expect(await postStatusOf(admin, post.postId)).toBe('publishing')

  clock.set(plus(startedAt, 2))
  expect(await searchTarget(deps, job(world, unknown))).toMatchObject({ to: 'published' })
  const found = await only(post.postId)
  expect(found).toMatchObject({ status: 'published', step: 'verify', attempts: 0 })
  expect(found.external_post_id).not.toBeNull()
  expect(await postStatusOf(admin, post.postId)).toBe('published')

  const [verify] = sentOf(deps, 'target.verify', ready.id)
  clock.set((verify?.opts as { startAfter: Date }).startAfter)
  expect(await verifyTarget(deps, job(world, found))).toMatchObject({ to: 'confirmed' })
  const confirmed = await only(post.postId)
  expect(confirmed.status).toBe('confirmed')
  expect(confirmed.permalink).toMatch(/^https:\/\/(www\.)?instagram\.com\//)
  // published once, whatever the uncertain answer
  expect(publishCalls()).toBe(before + 1)
  expect((await eventsOf(world)).map((e) => e.type)).toEqual([
    'post.target_confirmed',
    'post.confirmed',
  ])
})

test('an uncertain call that did not publish: three searches, then failed with uncertain_not_found', async () => {
  const { world, post, clock, deps, ready } = await readyNow()
  const startedAt = clock.now()
  const before = publishCalls()
  await publishTarget(
    { ...deps, publishers: { instagram: uncertainPublisher(false) } },
    job(world, ready),
  )
  const rounds: number[] = []
  for (const minutes of [2, 5, 15]) {
    const target = await only(post.postId)
    expect(target.status).toBe('unknown')
    rounds.push(((target.next_attempt_at?.getTime() ?? 0) - startedAt.getTime()) / MINUTE)
    clock.set(plus(startedAt, minutes))
    await searchTarget(deps, job(world, target))
  }
  expect(rounds).toEqual([2, 5, 15])
  expect(await only(post.postId)).toMatchObject({
    status: 'failed',
    last_error_code: 'uncertain_not_found',
  })
  expect(await postStatusOf(admin, post.postId)).toBe('failed')
  expect(publishCalls()).toBe(before)
  expect((await eventsOf(world)).map((e) => e.type)).toEqual(['post.target_failed'])
  const attempts = await admin.query<{ step: string; outcome: string }>(
    "select step, outcome from target_attempts where target_id = $1 and step = 'publish'",
    [ready.id],
  )
  // the call, and the three searches
  expect(attempts.rows).toHaveLength(4)
})

test('a worker stopped during the call: the reconciler takes it as uncertain, then searches it', async () => {
  const { post, clock, deps, ready } = await readyNow()
  await admin.query(
    `update post_targets set status = 'publishing', step = 'publish',
            next_attempt_at = $2, generation = generation + 1 where id = $1`,
    [ready.id, plus(clock.now(), 6)],
  )
  clock.set(plus(clock.now(), 7))
  expect(await reconcilePublishing(deps)).toMatchObject({ uncertain: 1 })
  const unknown = await only(post.postId)
  expect(unknown.status).toBe('unknown')
  // the next run, when the search is due: one job for it
  clock.set(plus(clock.now(), 2))
  await reconcilePublishing(deps)
  expect(sentOf(deps, 'target.reconcile', ready.id)).toHaveLength(1)
})

test('the verification waits while Meta processes, and after 30 minutes the destination is a problem', async () => {
  const { world, post, clock, deps, out } = await publishedNow()
  const publishedAt = clock.now()
  const real = runtime.publishers.instagram as PlatformPublisher
  const processing: PlatformPublisher = {
    ...real,
    verify: () =>
      Promise.resolve({
        outcome: 'pending',
        usage: null,
        load: { accountPercent: null, appPercent: null, regainMinutes: 0 },
      }),
  }
  const slow = { ...deps, publishers: { instagram: processing } }
  const times: number[] = []
  for (const minutes of [3, 10, 30]) {
    const target = await only(post.postId)
    times.push(((target.next_attempt_at?.getTime() ?? 0) - publishedAt.getTime()) / MINUTE)
    clock.set(plus(publishedAt, minutes))
    await verifyTarget(slow, job(world, target))
    if (minutes < 30) expect((await only(post.postId)).status).toBe('verifying')
  }
  expect(times).toEqual([3, 10, 30])
  const problem = await only(post.postId)
  expect(problem.status).toBe('problem')
  expect(problem.external_post_id).toBe(out.external_post_id)
  expect(await postStatusOf(admin, post.postId)).toBe('problem')
  const events = await eventsOf(world)
  expect(events.map((e) => e.type)).toEqual(['post.target_problem'])
  expect(events[0]?.payload).toMatchObject({ reason: 'still_processing', targetId: out.id })
})

test('a post Meta no longer has: a problem at once', async () => {
  const { world, clock, deps, out } = await publishedNow()
  mock.scenario('asset_removed', { id: out.external_post_id ?? '' })
  clock.set(plus(clock.now(), 3))
  expect(await verifyTarget(deps, job(world, out))).toMatchObject({
    to: 'problem',
    code: 'not_found',
  })
})

test('«Riprova» from problem with the post on Meta: confirmed, nothing published again', async () => {
  const { world, post, clock, deps, out } = await publishedNow()
  // what the panel's «Riprova» leaves (Task 8, second part): unknown, to be asked again
  await admin.query(
    `update post_targets set status = 'problem', generation = generation + 1 where id = $1`,
    [out.id],
  )
  await admin.query(
    `update post_targets set status = 'unknown', step = 'recheck', attempts = 0,
            next_attempt_at = now(), generation = generation + 1 where id = $1`,
    [out.id],
  )
  const before = publishCalls()
  clock.set(plus(clock.now(), 40))
  expect(await searchTarget(deps, job(world, await only(post.postId)))).toMatchObject({
    to: 'confirmed',
  })
  expect(publishCalls()).toBe(before)
})

test('«Riprova» from problem the next day with the post gone from Meta: prepared and published again, once', async () => {
  const { world, post, clock, deps, out } = await publishedNow()
  await admin.query(
    `update post_targets set status = 'unknown', step = 'recheck', attempts = 0,
            next_attempt_at = now(), generation = generation + 2 where id = $1`,
    [out.id],
  )
  // gone: Meta does not have it, and it is not among the account's posts
  const real = runtime.publishers.instagram as PlatformPublisher
  const gone: PlatformPublisher = {
    ...real,
    verify: () =>
      Promise.resolve({
        outcome: 'problem',
        reason: 'not_found',
        usage: null,
        load: { accountPercent: null, appPercent: null, regainMinutes: 0 },
      }),
    findPublished: () => Promise.resolve(null),
  }
  // «Riprova» the next day: the 60 minutes of R4 count from it, not from the post's time
  clock.set(plus(clock.now(), 24 * 60))
  expect(
    await searchTarget(
      { ...deps, publishers: { instagram: gone } },
      job(world, await only(post.postId)),
    ),
  ).toMatchObject({ to: 'retrying' })
  const again = await only(post.postId)
  expect(again).toMatchObject({
    status: 'retrying',
    step: 'prepare',
    external_post_id: null,
    meta_ids: null,
  })
  const before = publishCalls()
  await prepareTarget(deps, job(world, again))
  const ready = await only(post.postId)
  expect(ready.status).toBe('ready')
  await publishTarget(deps, job(world, ready))
  const republished = await only(post.postId)
  expect(republished.status).toBe('published')
  expect(republished.external_post_id).not.toBe(out.external_post_id)
  expect(publishCalls()).toBe(before + 1)
})

test('the reconciler sends the search and the verification that were never queued', async () => {
  const { clock, deps, out } = await publishedNow()
  clock.set(plus(clock.now(), 4))
  await reconcilePublishing(deps)
  expect(sentOf(deps, 'target.verify', out.id).map((s) => s.opts)).toContainEqual(
    expect.objectContaining({ dedupeKey: `${out.id}:verify:${String(out.generation)}` }),
  )
})

test('found at the third search: the verification rounds count from then, not all past', async () => {
  const { world, post, clock, deps, ready } = await readyNow()
  const startedAt = clock.now()
  await publishTarget(
    { ...deps, publishers: { instagram: uncertainPublisher(true) } },
    job(world, ready),
  )
  const real = runtime.publishers.instagram as PlatformPublisher
  let searches = 0
  const late: PlatformPublisher = {
    ...real,
    findPublished: (target, since, signal) =>
      ++searches < 3 ? Promise.resolve(null) : real.findPublished(target, since, signal),
  }
  for (const minutes of [2, 5, 15]) {
    clock.set(plus(startedAt, minutes))
    await searchTarget(
      { ...deps, publishers: { instagram: late } },
      job(world, await only(post.postId)),
    )
  }
  const found = await only(post.postId)
  expect(found.status).toBe('published')
  expect(found.next_attempt_at).toEqual(plus(startedAt, 18))
})

test('«Riprova» from problem with a post of the wrong type on Meta: verified again, never published twice', async () => {
  const { world, post, clock, deps, out } = await publishedNow()
  await admin.query(
    `update post_targets set status = 'unknown', step = 'recheck', attempts = 0,
            next_attempt_at = now(), generation = generation + 2 where id = $1`,
    [out.id],
  )
  const real = runtime.publishers.instagram as PlatformPublisher
  const wrong: PlatformPublisher = {
    ...real,
    verify: () =>
      Promise.resolve({
        outcome: 'problem',
        reason: 'wrong_type',
        usage: null,
        load: { accountPercent: null, appPercent: null, regainMinutes: 0 },
      }),
  }
  const before = publishCalls()
  clock.set(plus(clock.now(), 40))
  expect(
    await searchTarget(
      { ...deps, publishers: { instagram: wrong } },
      job(world, await only(post.postId)),
    ),
  ).toMatchObject({ to: 'published' })
  expect((await only(post.postId)).external_post_id).toBe(out.external_post_id)
  expect(publishCalls()).toBe(before)
})

test("«Riprova» from problem: Meta refuses to read the post, but it is among the account's posts: not published again", async () => {
  const { world, post, clock, deps, out } = await publishedNow()
  await admin.query(
    `update post_targets set status = 'unknown', step = 'recheck', attempts = 0,
            next_attempt_at = now(), generation = generation + 2 where id = $1`,
    [out.id],
  )
  // its own id answers 100/33, a refusal that may pass; the list of the account still has it
  mock.scenario('asset_removed', { id: out.external_post_id ?? '' })
  const before = publishCalls()
  clock.set(plus(clock.now(), 40))
  expect(await searchTarget(deps, job(world, await only(post.postId)))).toMatchObject({
    to: 'published',
  })
  expect((await only(post.postId)).external_post_id).toBe(out.external_post_id)
  expect(publishCalls()).toBe(before)
})
