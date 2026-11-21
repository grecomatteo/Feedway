import pg from 'pg'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import {
  PublishError,
  cancelPaused,
  cancelPost,
  cancelTarget,
  markVerified,
  prepareTarget,
  publishTarget,
  resumePaused,
  retryTarget,
  searchTarget,
  unschedulePost,
  updatePost,
  type PlatformPublisher,
} from '@app/application'
import { instantToZoned } from '@app/domain'
import type { Runtime } from '@app/infrastructure'
import { seed, startTestDatabase, withScope, type TestDatabase } from '@app/infrastructure/testing'
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

// The panel's actions after the worker (plan 07 Task 8): «Riprova» without doubles, «Segna come
// verificato», one destination cancelled, and the pause for every cause of §10.4 with its
// «Riprendi». Use cases and worker steps together, on the database and the fake Graph API.

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
const inMinutes = (n: number) => new Date(Math.ceil((Date.now() + n * MINUTE) / MINUTE) * MINUTE)

const publishCalls = () =>
  mock.calls().filter((c) => c.method === 'POST' && c.path.endsWith('/media_publish')).length

const job = (world: PublishingWorld, t: Pick<TargetRow, 'id' | 'generation'>) => ({
  organizationId: world.organizationId,
  targetId: t.id,
  generation: t.generation,
})

async function targetOn(postId: string, accountId: string): Promise<TargetRow> {
  const target = (await targetsOf(admin, postId)).find((t) => t.account_id === accountId)
  if (!target) throw new Error('no destination')
  return target
}

async function versionOf(postId: string): Promise<number> {
  const { rows } = await admin.query<{ version: number }>(
    'select version from posts where id = $1',
    [postId],
  )
  return rows[0]?.version ?? 0
}

async function setUp(opts: { at?: Date; accounts?: 'both' | 'instagram' } = {}) {
  const world = await publishingWorld(tdb, runtime)
  const photo = await readyPhoto(tdb, runtime, admin, world)
  const at = opts.at ?? inMinutes(40)
  const accounts =
    opts.accounts === 'instagram'
      ? [world.accounts.instagram]
      : [world.accounts.facebook, world.accounts.instagram]
  const post = await scheduledPost(runtime, world, { at, mediaIds: [photo], accounts })
  const queue = postsDeps(runtime).queue as ReturnType<typeof workerDeps>['queue']
  const panel = { ...postsDeps(runtime, queue), clock: testClock(new Date()) }
  const input = (accountId: string) => ({
    workspaceId: world.workspaceId,
    postId: post.postId,
    accountId,
  })
  return { world, photo, at, post, panel, queue, input }
}

/** Runs the steps of every destination of the post that has one, as the queue would. */
async function runAll(
  world: PublishingWorld,
  postId: string,
  deps: ReturnType<typeof workerDeps>,
  step: 'prepare' | 'publish',
) {
  for (const t of await targetsOf(admin, postId))
    await (step === 'prepare' ? prepareTarget : publishTarget)(deps, job(world, t))
}

test('«Riprova» after a definitive error starts again at once from the failed step, and publishes once', async () => {
  const { world, at, post, panel, queue, input } = await setUp({ accounts: 'instagram' })
  const ig = world.accounts.instagram
  const clock = testClock(plus(at, -15))
  const deps = workerDeps(runtime, clock, host.url)
  await runAll(world, post.postId, deps, 'prepare')
  clock.set(at)
  mock.scenario('error', { path: /media_publish$/, code: 9004, subcode: 2207052, times: 1 })
  await runAll(world, post.postId, deps, 'publish')
  expect(await targetOn(post.postId, ig)).toMatchObject({
    status: 'failed',
    last_error_code: 'media_rejected',
  })
  mock.scenario('default')
  // two hours later: the 15 minutes of D-77 (b) count from the «Riprova»
  const later = plus(at, 120)
  panel.clock.set(later)
  clock.set(later)
  const dto = await retryTarget(panel, world.actor, input(ig), { ip: null })
  expect(dto.destinations.find((d) => d.accountId === ig)?.status).toBe('scheduled')
  const again = await targetOn(post.postId, ig)
  expect(again).toMatchObject({ status: 'scheduled', attempts: 0, last_error_code: null })
  expect(queue.sent.filter((s) => s.name === 'target.prepare').length).toBeGreaterThan(0)
  const before = publishCalls()
  await prepareTarget(deps, job(world, again))
  const ready = await targetOn(post.postId, ig)
  expect(ready.status).toBe('ready')
  await publishTarget(deps, job(world, ready))
  expect(await targetOn(post.postId, ig)).toMatchObject({ status: 'published' })
  expect(publishCalls()).toBe(before + 1)
  const audit = await admin.query<{ data: unknown }>(
    "select data from audit_log where action = 'post.retried' and entity_id = $1",
    [post.postId],
  )
  expect(audit.rows[0]?.data).toEqual({ accountId: ig, from: 'failed' })
})

test('«Riprova» after too_late publishes at once', async () => {
  const { world, at, post, panel, input } = await setUp({ accounts: 'instagram' })
  const ig = world.accounts.instagram
  const late = plus(at, 20)
  const clock = testClock(late)
  const deps = workerDeps(runtime, clock, host.url)
  await runAll(world, post.postId, deps, 'prepare')
  expect(await targetOn(post.postId, ig)).toMatchObject({
    status: 'failed',
    last_error_code: 'too_late',
  })
  panel.clock.set(late)
  await retryTarget(panel, world.actor, input(ig), { ip: null })
  await prepareTarget(deps, job(world, await targetOn(post.postId, ig)))
  const ready = await targetOn(post.postId, ig)
  expect(ready.status).toBe('ready')
  await publishTarget(deps, job(world, ready))
  expect((await targetOn(post.postId, ig)).status).toBe('published')
})

test('«Riprova» from problem with the post on Meta: confirmed without publishing; «Segna come verificato» too', async () => {
  const { world, at, post, panel, input } = await setUp()
  const clock = testClock(plus(at, -15))
  const deps = workerDeps(runtime, clock, host.url)
  await runAll(world, post.postId, deps, 'prepare')
  clock.set(at)
  await runAll(world, post.postId, deps, 'publish')
  // the verification found a problem on both (the post may still be there)
  await admin.query(
    "update post_targets set status = 'problem', generation = generation + 1 where post_id = $1",
    [post.postId],
  )
  const before = publishCalls()
  await retryTarget(panel, world.actor, input(world.accounts.instagram), { ip: null })
  const unknown = await targetOn(post.postId, world.accounts.instagram)
  expect(unknown).toMatchObject({ status: 'unknown', step: 'recheck' })
  clock.set(plus(at, 40))
  expect(await searchTarget(deps, job(world, unknown))).toMatchObject({ to: 'confirmed' })
  expect(publishCalls()).toBe(before)
  // the other one, seen on the profile by a person
  await markVerified(panel, world.actor, input(world.accounts.facebook), { ip: null })
  expect((await targetOn(post.postId, world.accounts.facebook)).status).toBe('confirmed')
  expect(await postStatusOf(admin, post.postId)).toBe('published')
  const events = await admin.query<{ type: string }>(
    'select type from outbox_events where organization_id = $1 order by created_at, id',
    [world.organizationId],
  )
  expect(events.rows.map((e) => e.type)).toEqual([
    'post.target_confirmed',
    'post.target_confirmed',
    'post.confirmed',
  ])
})

test('«Riprova» refuses a destination that is not failed or a problem', async () => {
  const { world, post, panel, input } = await setUp({ accounts: 'instagram' })
  await expect(
    retryTarget(panel, world.actor, input(world.accounts.instagram), { ip: null }),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  await expect(
    markVerified(panel, world.actor, input(world.accounts.instagram), { ip: null }),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  // an account that is not a destination of the post
  await expect(
    retryTarget(panel, world.actor, input(world.accounts.facebook), { ip: null }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  expect((await targetsOf(admin, post.postId))[0]?.status).toBe('scheduled')
})

test('one destination cancelled while the other is already out', async () => {
  const { world, at, post, panel, input } = await setUp()
  const clock = testClock(plus(at, -15))
  const deps = workerDeps(runtime, clock, host.url)
  await runAll(world, post.postId, deps, 'prepare')
  clock.set(at)
  await publishTarget(deps, job(world, await targetOn(post.postId, world.accounts.instagram)))
  // the Facebook one failed meanwhile
  await admin.query(
    `update post_targets set status = 'failed', generation = generation + 1
      where post_id = $1 and account_id = $2`,
    [post.postId, world.accounts.facebook],
  )
  expect(await postStatusOf(admin, post.postId)).toBe('publishing')
  await cancelTarget(panel, world.actor, input(world.accounts.facebook), { ip: null })
  expect((await targetOn(post.postId, world.accounts.facebook)).status).toBe('cancelled')
  expect(await postStatusOf(admin, post.postId)).toBe('published')
  // an out one does not cancel
  await expect(
    cancelTarget(panel, world.actor, input(world.accounts.instagram), { ip: null }),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
})

test('«Riprova» next to a destination already out: the post is publishing, never moved again (R6)', async () => {
  const { world, at, post, panel, input } = await setUp()
  const ig = world.accounts.instagram
  const fb = world.accounts.facebook
  const clock = testClock(plus(at, -15))
  const deps = workerDeps(runtime, clock, host.url)
  await runAll(world, post.postId, deps, 'prepare')
  clock.set(at)
  await publishTarget(deps, job(world, await targetOn(post.postId, ig)))
  await admin.query(
    `update post_targets set status = 'failed', last_error_code = 'too_late',
            generation = generation + 1
      where post_id = $1 and account_id = $2`,
    [post.postId, fb],
  )
  panel.clock.set(plus(at, 20))
  await retryTarget(panel, world.actor, input(fb), { ip: null })
  expect((await targetOn(post.postId, fb)).status).toBe('scheduled')
  expect(await postStatusOf(admin, post.postId)).toBe('publishing')
  // a row written so before the fix: still out of the panel's reach
  for (const status of ['publishing', 'scheduled']) {
    await admin.query('update posts set status = $2 where id = $1', [post.postId, status])
    const version = await versionOf(post.postId)
    const ref = { workspaceId: world.workspaceId, postId: post.postId, version }
    await expect(unschedulePost(panel, world.actor, ref, { ip: null })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(cancelPost(panel, world.actor, ref, { ip: null })).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    await expect(
      updatePost(
        panel,
        world.actor,
        post.postId,
        { workspaceId: world.workspaceId, version, caption: 'Un altro testo' },
        { ip: null },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
  }
  expect((await targetOn(post.postId, ig)).status).toBe('published')
})

/** A Publisher of the client who schedules the post: the one the pause looks at (P6). */
async function scheduledByPublisher(world: PublishingWorld, postId: string): Promise<string> {
  const userId = await seed(tdb.runtimeUrl, async (s) => {
    const user = await s.user()
    await s.member(world.organizationId, user, 'member')
    await s.workspaceMember(world.organizationId, world.workspaceId, user, 'publisher')
    return user
  })
  await admin.query('update posts set scheduled_by = $2 where id = $1', [postId, userId])
  return userId
}

const CAUSES: {
  name: string
  act: (world: PublishingWorld, userId: string) => Promise<unknown>
}[] = [
  {
    name: 'demoted to Editor',
    act: (w, u) =>
      admin.query(
        "update workspace_members set role = 'editor' where workspace_id = $1 and user_id = $2",
        [w.workspaceId, u],
      ),
  },
  {
    name: 'removed from the client',
    act: (w, u) =>
      admin.query('delete from workspace_members where workspace_id = $1 and user_id = $2', [
        w.workspaceId,
        u,
      ]),
  },
  {
    name: 'disabled in the agency',
    act: (w, u) =>
      admin.query(
        "update organization_members set status = 'disabled' where organization_id = $1 and user_id = $2",
        [w.organizationId, u],
      ),
  },
]

test.each(CAUSES)(
  'the person who scheduled is $name: paused, then resumed by a Manager',
  async ({ act }) => {
    const { world, at, post, panel } = await setUp({ accounts: 'instagram' })
    const userId = await scheduledByPublisher(world, post.postId)
    await act(world, userId)
    const clock = testClock(plus(at, -15))
    const deps = workerDeps(runtime, clock, host.url)
    await runAll(world, post.postId, deps, 'prepare')
    expect((await targetsOf(admin, post.postId))[0]).toMatchObject({
      status: 'paused',
      last_error_code: 'author_lost_permission',
    })
    // «Riprendi»: the person who resumes is now the one it goes out with, at its time
    panel.clock.set(plus(at, -15))
    await resumePaused(
      panel,
      world.actor,
      {
        workspaceId: world.workspaceId,
        postId: post.postId,
        version: await versionOf(post.postId),
      },
      { ip: null },
    )
    const { rows } = await admin.query<{ scheduled_by: string }>(
      'select scheduled_by from posts where id = $1',
      [post.postId],
    )
    expect(rows[0]?.scheduled_by).toBe(world.ownerId)
    await runAll(world, post.postId, deps, 'prepare')
    expect((await targetsOf(admin, post.postId))[0]?.status).toBe('ready')
  },
)

test('a suspended agency pauses with no event; lifting it does not resume by itself', async () => {
  const { world, at, post, panel } = await setUp({ accounts: 'instagram' })
  const setStatus = (status: 'suspended' | 'active') =>
    withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
      c.query('update organizations set status = $2, suspended_at = $3 where id = $1', [
        world.organizationId,
        status,
        status === 'suspended' ? new Date() : null,
      ]),
    )
  await setStatus('suspended')
  const clock = testClock(plus(at, -15))
  const deps = workerDeps(runtime, clock, host.url)
  await runAll(world, post.postId, deps, 'prepare')
  await setStatus('active')
  await runAll(world, post.postId, deps, 'prepare')
  expect((await targetsOf(admin, post.postId))[0]?.status).toBe('paused')
  const events = await admin.query('select 1 from outbox_events where organization_id = $1', [
    world.organizationId,
  ])
  expect(events.rowCount).toBe(0)
  // its time has passed meanwhile: «Riprendi» asks for a new one
  panel.clock.set(plus(at, 5))
  const resume = (when?: { localDate: string; localTime: string }) =>
    resumePaused(
      panel,
      world.actor,
      {
        workspaceId: world.workspaceId,
        postId: post.postId,
        version: 0,
        ...(when ? { when } : {}),
      },
      { ip: null },
    )
  const version = await versionOf(post.postId)
  await expect(
    resumePaused(
      panel,
      world.actor,
      { workspaceId: world.workspaceId, postId: post.postId, version },
      { ip: null },
    ),
  ).rejects.toMatchObject({ details: { reason: 'paused_time_passed' } })
  await expect(resume()).rejects.toMatchObject({ code: 'CONFLICT' })
  const dto = await resumePaused(
    panel,
    world.actor,
    {
      workspaceId: world.workspaceId,
      postId: post.postId,
      version,
      when: { localDate: '2099-01-15', localTime: '10:00' },
    },
    { ip: null },
  )
  expect(dto.status).toBe('scheduled')
  expect((await targetsOf(admin, post.postId))[0]?.status).toBe('scheduled')
})

test('«Annulla» of a post in pause cancels its paused destinations', async () => {
  const { world, at, post, panel } = await setUp({ accounts: 'instagram' })
  const userId = await scheduledByPublisher(world, post.postId)
  await CAUSES[0]?.act(world, userId)
  await runAll(
    world,
    post.postId,
    workerDeps(runtime, testClock(plus(at, -15)), host.url),
    'prepare',
  )
  await cancelPaused(
    panel,
    world.actor,
    { workspaceId: world.workspaceId, postId: post.postId, version: await versionOf(post.postId) },
    { ip: null },
  )
  expect((await targetsOf(admin, post.postId))[0]?.status).toBe('cancelled')
  expect(await postStatusOf(admin, post.postId)).toBe('cancelled')
})

test('an uncertain call, not found, then «Riprova»: prepared and published', async () => {
  const { world, at, post, panel, input } = await setUp({ accounts: 'instagram' })
  const ig = world.accounts.instagram
  const clock = testClock(plus(at, -15))
  const deps = workerDeps(runtime, clock, host.url)
  await runAll(world, post.postId, deps, 'prepare')
  clock.set(at)
  const real = runtime.publishers.instagram as PlatformPublisher
  const lost: PlatformPublisher = {
    ...real,
    publish: () => Promise.reject(new PublishError({ kind: 'uncertain', code: 'meta_error' })),
  }
  await publishTarget(
    { ...deps, publishers: { instagram: lost } },
    job(world, await targetOn(post.postId, ig)),
  )
  for (const minutes of [2, 5, 15]) {
    clock.set(plus(at, minutes))
    await searchTarget(deps, job(world, await targetOn(post.postId, ig)))
  }
  expect((await targetOn(post.postId, ig)).last_error_code).toBe('uncertain_not_found')
  panel.clock.set(plus(at, 20))
  clock.set(plus(at, 20))
  await retryTarget(panel, world.actor, input(ig), { ip: null })
  const before = publishCalls()
  await prepareTarget(deps, job(world, await targetOn(post.postId, ig)))
  await publishTarget(deps, job(world, await targetOn(post.postId, ig)))
  expect((await targetOn(post.postId, ig)).status).toBe('published')
  expect(publishCalls()).toBe(before + 1)
})

test('Facebook: an uncertain call, not found, then «Riprova»: a new round, published once (R2)', async () => {
  const { world, at, post, panel, input } = await setUp()
  const fb = world.accounts.facebook
  const clock = testClock(plus(at, -15))
  const deps = workerDeps(runtime, clock, host.url)
  await prepareTarget(deps, job(world, await targetOn(post.postId, fb)))
  clock.set(at)
  // the call leaves its mark, then the answer is lost
  const real = runtime.publishers.facebook as PlatformPublisher
  const lost: PlatformPublisher = {
    ...real,
    publish: async (target, _files, ctx) => {
      await ctx.saveIds({ ...(target.metaIds ?? {}), publishingAt: clock.now().toISOString() })
      throw new PublishError({ kind: 'uncertain', code: 'meta_error' })
    },
  }
  await publishTarget(
    { ...deps, publishers: { facebook: lost } },
    job(world, await targetOn(post.postId, fb)),
  )
  for (const minutes of [2, 5, 15]) {
    clock.set(plus(at, minutes))
    await searchTarget(deps, job(world, await targetOn(post.postId, fb)))
  }
  expect((await targetOn(post.postId, fb)).last_error_code).toBe('uncertain_not_found')
  panel.clock.set(plus(at, 20))
  clock.set(plus(at, 20))
  await retryTarget(panel, world.actor, input(fb), { ip: null })
  const photos = () =>
    mock.calls().filter((c) => c.method === 'POST' && c.path.endsWith('/photos')).length
  const before = photos()
  await prepareTarget(deps, job(world, await targetOn(post.postId, fb)))
  expect((await targetOn(post.postId, fb)).status).toBe('ready')
  await publishTarget(deps, job(world, await targetOn(post.postId, fb)))
  expect((await targetOn(post.postId, fb)).status).toBe('published')
  expect(photos()).toBe(before + 1)
})

test('«Riprova», then the post moved to another day: its preparation is not too late', async () => {
  const { world, at, post, panel, input } = await setUp({ accounts: 'instagram' })
  const ig = world.accounts.instagram
  const late = plus(at, 20)
  const deps = workerDeps(runtime, testClock(late), host.url)
  await runAll(world, post.postId, deps, 'prepare')
  panel.clock.set(late)
  await retryTarget(panel, world.actor, input(ig), { ip: null })
  // the person moves it two days later instead (a new round, P2)
  const moved = new Date(Math.ceil((Date.now() + 2 * 24 * 60 * MINUTE) / MINUTE) * MINUTE)
  const { localDate, localTime } = instantToZoned(moved, 'Europe/Rome')
  await updatePost(
    postsDeps(runtime),
    world.actor,
    post.postId,
    {
      workspaceId: world.workspaceId,
      version: await versionOf(post.postId),
      when: { localDate, localTime },
    },
    { ip: null },
  )
  const scheduled = await targetOn(post.postId, ig)
  expect(scheduled.status).toBe('scheduled')
  await prepareTarget(
    workerDeps(runtime, testClock(plus(moved, -15)), host.url),
    job(world, scheduled),
  )
  expect((await targetOn(post.postId, ig)).status).toBe('ready')
})

test('a Publisher retries the posts they created, not those of others (P6)', async () => {
  const { world, post, panel, input } = await setUp({ accounts: 'instagram' })
  const ig = world.accounts.instagram
  const userId = await scheduledByPublisher(world, post.postId)
  const publisher = {
    userId,
    platformRole: null,
    organizationId: world.organizationId,
    orgRole: 'member' as const,
    memberships: new Map([[world.workspaceId, 'publisher' as const]]),
  }
  await admin.query(
    "update post_targets set status = 'failed', generation = generation + 1 where post_id = $1",
    [post.postId],
  )
  await expect(retryTarget(panel, publisher, input(ig), { ip: null })).rejects.toMatchObject({
    code: 'FORBIDDEN',
  })
  await admin.query('update posts set created_by = $2 where id = $1', [post.postId, userId])
  await retryTarget(panel, publisher, input(ig), { ip: null })
  expect((await targetOn(post.postId, ig)).status).toBe('scheduled')
})
