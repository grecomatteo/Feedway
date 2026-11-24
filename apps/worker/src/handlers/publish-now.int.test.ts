import pg from 'pg'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import {
  createPost,
  getPostOutcome,
  prepareTarget,
  publishNow,
  publishTarget,
} from '@app/application'
import type { Runtime } from '@app/infrastructure'
import { seed, startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
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
} from '../../tests/publishing.js'

// «Pubblica subito» and the page of the outcome (plan 07 Task 9, Scelte 2 and 6): the post goes
// at once, with no check of the date, and the page reads every destination with its link or its
// reason, and the activity from the log and the attempts.

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client
let host: Awaited<ReturnType<typeof publicHost>>

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

const MINUTE = 60_000

async function draftOf(world: PublishingWorld, mediaIds: string[], when: unknown = null) {
  return createPost(
    postsDeps(runtime),
    world.actor,
    {
      workspaceId: world.workspaceId,
      type: 'photo',
      mediaIds,
      caption: { common: 'Pane caldo adesso' },
      destinations: [
        { accountId: world.accounts.facebook },
        { accountId: world.accounts.instagram },
      ],
      when: when as null,
    },
    { ip: null },
  )
}

async function runSteps(
  world: PublishingWorld,
  postId: string,
  deps: ReturnType<typeof workerDeps>,
) {
  for (const step of [prepareTarget, publishTarget])
    for (const t of await targetsOf(admin, postId))
      await step(deps, {
        organizationId: world.organizationId,
        targetId: t.id,
        generation: t.generation,
      })
}

test('«Pubblica subito» from a draft with no date: scheduled now, prepared at once, then out', async () => {
  const world = await publishingWorld(tdb, runtime)
  const photo = await readyPhoto(tdb, runtime, admin, world)
  const draft = await draftOf(world, [photo])
  const queue = postsDeps(runtime).queue as ReturnType<typeof workerDeps>['queue']
  const now = new Date()
  const panel = { ...postsDeps(runtime, queue), clock: testClock(now) }
  const dto = await publishNow(
    panel,
    world.actor,
    { workspaceId: world.workspaceId, postId: draft.id, version: draft.version },
    { ip: null },
  )
  expect(dto.status).toBe('scheduled')
  expect(dto.scheduledAt).toBe(now.toISOString())
  expect(dto.scheduledBy).toBe(world.actor.userId)
  const prepares = queue.sent.filter((s) => s.name === 'target.prepare')
  expect(prepares).toHaveLength(2)
  for (const p of prepares)
    expect(((p.opts as { startAfter?: Date }).startAfter ?? now).getTime()).toBeLessThanOrEqual(
      now.getTime(),
    )
  const audit = await admin.query<{ action: string }>(
    'select action from audit_log where entity_id = $1 order by created_at',
    [draft.id],
  )
  expect(audit.rows.map((r) => r.action)).toEqual(['post.created', 'post.published_now'])

  // before it goes out: the versions, never «the copies were taken away»
  const before = await getPostOutcome(panel, world.actor, {
    workspaceId: world.workspaceId,
    postId: draft.id,
  })
  expect(before.preview?.versions).toHaveLength(2)
  expect(before.preview?.originals).toBe(false)
  // the page's own reads while something moves: without the versions
  const again = await getPostOutcome(panel, world.actor, {
    workspaceId: world.workspaceId,
    postId: draft.id,
    preview: false,
  })
  expect(again.preview).toBeNull()

  const deps = workerDeps(runtime, testClock(now), host.url)
  await runSteps(world, draft.id, deps)
  expect(await postStatusOf(admin, draft.id)).toBe('published')

  const outcome = await getPostOutcome(panel, world.actor, {
    workspaceId: world.workspaceId,
    postId: draft.id,
  })
  expect(outcome.destinations).toHaveLength(2)
  for (const d of outcome.destinations) {
    expect(d.status).toBe('published')
    expect(d.publishedAt).not.toBeNull()
    expect(d.errorCode).toBeNull()
  }
  // the post as each account received it, from the copies that went out (plan 08 Task 10)
  expect(outcome.preview?.originals).toBe(false)
  expect(outcome.preview?.versions.map((v) => [v.platform, v.format]).sort()).toEqual([
    ['facebook', 'photo'],
    ['instagram', 'feed_photo'],
  ])
  for (const v of outcome.preview?.versions ?? []) {
    expect(v.caption).toBe('Pane caldo adesso')
    expect(v.files).toHaveLength(1)
    expect(v.files[0]?.mediaId).toBe(photo)
    expect(v.files[0]?.copyId).not.toBeNull()
    expect(v.cover).toBeNull()
  }
  // the copies made for the post thrown away (plan 07 Scelta 5): the originals, and it says so
  await admin.query(
    "update media_variants set status = 'pending' where organization_id = $1 and media_id = $2 and purpose = 'ig_feed'",
    [world.organizationId, photo],
  )
  const later = await getPostOutcome(panel, world.actor, {
    workspaceId: world.workspaceId,
    postId: draft.id,
  })
  expect(later.preview?.originals).toBe(true)
  for (const v of later.preview?.versions ?? []) expect(v.files[0]?.copyId).toBeNull()
  const kinds = outcome.activity.map((a) => a.kind)
  expect(kinds).toContain('post.created')
  expect(kinds).toContain('post.published_now')
  expect(outcome.activity.filter((a) => a.kind === 'target.published')).toHaveLength(2)
  // newest first
  const times = outcome.activity.map((a) => a.at)
  expect([...times].sort().reverse()).toEqual(times)
  expect(outcome.activity.find((a) => a.kind === 'post.created')?.actorName).toBeTruthy()
})

test('«Pubblica subito» with a date in the past is not refused for the date', async () => {
  const world = await publishingWorld(tdb, runtime)
  const photo = await readyPhoto(tdb, runtime, admin, world)
  const draft = await draftOf(world, [photo], { localDate: '2026-01-05', localTime: '09:00' })
  const dto = await publishNow(
    postsDeps(runtime),
    world.actor,
    { workspaceId: world.workspaceId, postId: draft.id, version: draft.version },
    { ip: null },
  )
  expect(dto.status).toBe('scheduled')
  expect(new Date(dto.scheduledAt ?? 0).getTime()).toBeGreaterThan(Date.now() - MINUTE)
})

test('«Pubblica subito» refuses what is not a draft, an old version and an Editor', async () => {
  const world = await publishingWorld(tdb, runtime)
  const photo = await readyPhoto(tdb, runtime, admin, world)
  const post = await scheduledPost(runtime, world, {
    at: new Date(Date.now() + 60 * MINUTE),
    mediaIds: [photo],
    accounts: [world.accounts.instagram],
  })
  const input = { workspaceId: world.workspaceId, postId: post.postId, version: post.version }
  await expect(
    publishNow(postsDeps(runtime), world.actor, input, { ip: null }),
  ).rejects.toMatchObject({ code: 'CONFLICT' })
  const draft = await draftOf(world, [photo])
  await expect(
    publishNow(
      postsDeps(runtime),
      world.actor,
      { workspaceId: world.workspaceId, postId: draft.id, version: draft.version + 1 },
      { ip: null },
    ),
  ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'post_version_conflict' } })
  const editorId = await seed(tdb.runtimeUrl, async (s) => {
    const user = await s.user()
    await s.member(world.organizationId, user, 'member')
    await s.workspaceMember(world.organizationId, world.workspaceId, user, 'editor')
    return user
  })
  const editor = {
    userId: editorId,
    platformRole: null,
    organizationId: world.organizationId,
    orgRole: 'member' as const,
    memberships: new Map([[world.workspaceId, 'editor' as const]]),
  }
  await expect(
    publishNow(
      postsDeps(runtime),
      editor,
      { workspaceId: world.workspaceId, postId: draft.id, version: draft.version },
      { ip: null },
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('the outcome of a destination that failed says its code, and the activity the failure', async () => {
  const world = await publishingWorld(tdb, runtime)
  const photo = await readyPhoto(tdb, runtime, admin, world)
  const draft = await draftOf(world, [photo])
  const panel = postsDeps(runtime)
  await publishNow(
    panel,
    world.actor,
    { workspaceId: world.workspaceId, postId: draft.id, version: draft.version },
    { ip: null },
  )
  mock.scenario('error', { path: /media_publish$/, code: 352, subcode: 2207026 })
  await runSteps(world, draft.id, workerDeps(runtime, testClock(new Date()), host.url))
  const outcome = await getPostOutcome(panel, world.actor, {
    workspaceId: world.workspaceId,
    postId: draft.id,
  })
  const ig = outcome.destinations.find((d) => d.accountId === world.accounts.instagram)
  expect(ig).toMatchObject({ status: 'failed', errorCode: 'media_rejected', permalink: null })
  expect(outcome.destinations.find((d) => d.accountId === world.accounts.facebook)?.status).toBe(
    'published',
  )
  expect(await postStatusOf(admin, draft.id)).toBe('partial')
  expect(outcome.activity).toContainEqual(
    expect.objectContaining({
      kind: 'target.failed',
      accountId: world.accounts.instagram,
      errorCode: 'media_rejected',
    }),
  )
  // told once: by the call, not again by the worker's entry of the same moment (D-120.8)
  expect(
    outcome.activity.filter(
      (a) => a.accountId === world.accounts.instagram && a.kind.endsWith('failed'),
    ),
  ).toHaveLength(1)
})
