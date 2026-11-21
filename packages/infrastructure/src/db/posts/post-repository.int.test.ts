import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { PostChange, Tx, UnitOfWork } from '@app/application'
import { EMPTY_POST_OPTIONS, compareUses } from '@app/domain'
import { createDb, type DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'
import { createLogger } from '../../logging/logger.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, withScope, type TestDatabase } from '../../testing/index.js'

// The posts' repository (plan 06 Task 3): the optimistic lock, the files, cover, destinations and
// labels written and read back, the list and the posts that use a file.

let tdb: TestDatabase
let handle: DbHandle
let uow: UnitOfWork
let org: string, user: string, ws: string, photo: string, video: string, cover: string
let ig: string, fb: string

const scope = () => ({ organizationId: org, workspaceId: ws })
const run = <T>(fn: (tx: Tx) => Promise<T>) => uow.run({ organizationId: org, userId: user }, fn)

async function newPost(over: { type?: 'photo' | 'reel' } = {}) {
  const id = uuidV7Generator.newId()
  await run((tx) =>
    tx.posts.insert({
      id,
      organizationId: org,
      workspaceId: ws,
      type: over.type ?? 'photo',
      caption: 'Pane caldo',
      captionByPlatform: { facebook: 'Pane caldo, anche su Facebook' },
      scheduledAt: null,
      timezone: 'Europe/Rome',
      options: EMPTY_POST_OPTIONS,
      createdBy: user,
    }),
  )
  return id
}

const change = (over: Partial<PostChange> = {}): PostChange => ({
  type: 'photo',
  caption: 'Nuovo testo',
  captionByPlatform: {},
  scheduledAt: null,
  status: 'draft',
  options: EMPTY_POST_OPTIONS,
  scheduledBy: null,
  updatedBy: user,
  ...over,
})

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'post-repository' })
  uow = createUnitOfWork({
    db: handle.db,
    ids: uuidV7Generator,
    logger: createLogger({ service: 'web', level: 'error' }),
  })
  ;({ org, user, ws, photo, video, cover, ig, fb } = await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const user = await s.user()
    await s.member(org, user, 'owner')
    const ws = await s.workspace(org)
    return {
      org,
      user,
      ws,
      photo: await s.media(org, ws, { uploadedBy: user, kind: 'image' }),
      video: await s.media(org, ws, { uploadedBy: user, kind: 'video' }),
      cover: await s.media(org, ws, { uploadedBy: user, kind: 'image' }),
      ig: await s.account(org, { workspaceIds: [ws] }),
      fb: await s.account(org, { platform: 'facebook', workspaceIds: [ws] }),
    }
  }))
}, 120_000)

afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

test('a new post is a draft at version 1, with what it was given', async () => {
  const id = await newPost()
  const post = await run((tx) => tx.posts.find(scope(), id))
  expect(post).toMatchObject({
    id,
    status: 'draft',
    version: 1,
    caption: 'Pane caldo',
    captionByPlatform: { facebook: 'Pane caldo, anche su Facebook' },
    createdBy: user,
    updatedBy: user,
    scheduledBy: null,
    mediaIds: [],
    cover: null,
    targets: [],
    labelIds: [],
  })
})

test('a save with the version read passes once: the second with the same version is refused', async () => {
  const id = await newPost()
  expect(await run((tx) => tx.posts.update(scope(), id, change(), 1))).toBe(2)
  expect(await run((tx) => tx.posts.update(scope(), id, change({ caption: 'Altro' }), 1))).toBe(
    null,
  )
  const post = await run((tx) => tx.posts.find(scope(), id))
  expect(post).toMatchObject({ version: 2, caption: 'Nuovo testo' })
})

test('a post of another workspace is not found, nor written, nor emptied', async () => {
  const id = await newPost()
  await run(async (tx) => {
    await tx.posts.replaceMedia(scope(), id, [photo], null)
    await tx.posts.replaceTargets(scope(), id, [
      { accountId: ig, status: 'draft', fingerprint: null },
    ])
  })
  const other = { organizationId: org, workspaceId: randomUUID() }
  expect(await run((tx) => tx.posts.find(other, id))).toBe(null)
  expect(await run((tx) => tx.posts.update(other, id, change(), 1))).toBe(null)
  expect(await run((tx) => tx.posts.delete(other, id))).toBe(false)
  await run(async (tx) => {
    await tx.posts.replaceMedia(other, id, [], null)
    await tx.posts.replaceTargets(other, id, [])
    await tx.posts.replaceLabels(other, id, [])
  })
  // an account already there is not rewritten from another workspace
  await run((tx) =>
    tx.posts.replaceTargets(other, id, [
      { accountId: ig, status: 'scheduled', fingerprint: 'f'.repeat(64) },
    ]),
  )
  expect(await run((tx) => tx.posts.find(scope(), id))).toMatchObject({
    mediaIds: [photo],
    targets: [{ accountId: ig, status: 'draft', fingerprint: null }],
  })
})

test('an account given twice is one destination, the last one given', async () => {
  const id = await newPost()
  await run((tx) =>
    tx.posts.replaceTargets(scope(), id, [
      { accountId: ig, status: 'draft', fingerprint: null },
      { accountId: ig, status: 'scheduled', fingerprint: 'a'.repeat(64) },
    ]),
  )
  expect((await run((tx) => tx.posts.find(scope(), id)))?.targets).toEqual([
    expect.objectContaining({ accountId: ig, status: 'scheduled' }),
  ])
})

test('files keep their order; the cover sits on the video, a frame or a photo', async () => {
  const id = await newPost({ type: 'reel' })
  await run((tx) =>
    tx.posts.replaceMedia(scope(), id, [video], { source: 'frame', offsetMs: 1500 }),
  )
  expect(await run((tx) => tx.posts.find(scope(), id))).toMatchObject({
    mediaIds: [video],
    cover: { source: 'frame', offsetMs: 1500 },
  })
  await run((tx) =>
    tx.posts.replaceMedia(scope(), id, [video], { source: 'image', mediaId: cover }),
  )
  expect(await run((tx) => tx.posts.find(scope(), id))).toMatchObject({
    cover: { source: 'image', mediaId: cover },
  })
  await run((tx) => tx.posts.replaceMedia(scope(), id, [photo, cover, photo], null))
  expect(await run((tx) => tx.posts.find(scope(), id))).toMatchObject({
    mediaIds: [photo, cover, photo],
    cover: null,
  })
})

test('destinations are replaced; an account already there keeps its row', async () => {
  const id = await newPost()
  await run((tx) =>
    tx.posts.replaceTargets(scope(), id, [{ accountId: ig, status: 'draft', fingerprint: null }]),
  )
  const before = await run((tx) => tx.posts.find(scope(), id))
  const fingerprint = 'f'.repeat(64)
  await run((tx) =>
    tx.posts.replaceTargets(scope(), id, [
      { accountId: ig, status: 'scheduled', fingerprint },
      { accountId: fb, status: 'scheduled', fingerprint },
    ]),
  )
  const after = await run((tx) => tx.posts.find(scope(), id))
  expect(after?.targets.find((t) => t.accountId === ig)).toEqual({
    id: before?.targets[0]?.id,
    accountId: ig,
    status: 'scheduled',
    fingerprint,
    cancelledInPanel: false,
  })
  await run((tx) => tx.posts.replaceTargets(scope(), id, []))
  expect((await run((tx) => tx.posts.find(scope(), id)))?.targets).toEqual([])
})

test('the list goes newest first, by state and page; statuses come in one query', async () => {
  const s = await seed(tdb.runtimeUrl, async (x) => x.workspace(org))
  const own = { organizationId: org, workspaceId: s }
  const ids: string[] = []
  for (let i = 0; i < 3; i++) {
    const id = uuidV7Generator.newId()
    await run((tx) =>
      tx.posts.insert({
        id,
        organizationId: org,
        workspaceId: s,
        type: 'photo',
        caption: '',
        captionByPlatform: {},
        scheduledAt: null,
        timezone: 'Europe/Rome',
        options: EMPTY_POST_OPTIONS,
        createdBy: user,
      }),
    )
    ids.push(id)
  }
  await run((tx) =>
    tx.posts.update(
      own,
      ids[0] ?? '',
      change({ status: 'scheduled', scheduledAt: new Date('2026-12-01T17:00:00Z') }),
      1,
    ),
  )
  const first = await run((tx) => tx.posts.listByWorkspace(own, { limit: 2 }))
  expect(first.map((p) => p.id)).toEqual([ids[2], ids[1]])
  const next = await run((tx) => tx.posts.listByWorkspace(own, { limit: 2, before: ids[1] ?? '' }))
  expect(next.map((p) => p.id)).toEqual([ids[0]])
  const scheduled = await run((tx) =>
    tx.posts.listByWorkspace(own, { limit: 10, status: 'scheduled' }),
  )
  expect(scheduled.map((p) => p.id)).toEqual([ids[0]])
  const statuses = await run((tx) => tx.posts.statuses(org, [...ids, randomUUID()]))
  expect([...statuses.entries()].sort()).toEqual(
    [
      [ids[0], 'scheduled'],
      [ids[1], 'draft'],
      [ids[2], 'draft'],
    ].sort(),
  )
})

test('statuses and the day count stay in the agency; an archived client does not count', async () => {
  const { otherOrg, otherUser, otherWs, archived } = await seed(tdb.runtimeUrl, async (x) => {
    const otherOrg = await x.organization()
    const otherUser = await x.user()
    await x.member(otherOrg, otherUser, 'owner')
    return {
      otherOrg,
      otherUser,
      otherWs: await x.workspace(otherOrg),
      archived: await x.workspace(org, { archived: true }),
    }
  })
  const at = new Date('2027-09-01T08:00:00Z')
  const day = { from: new Date('2027-08-31T22:00:00Z'), to: new Date('2027-09-01T22:00:00Z') }
  const scheduledIn = async (organizationId: string, workspaceId: string, userId: string) =>
    uow.run({ organizationId, userId }, async (tx) => {
      const id = await tx.posts.insert({
        organizationId,
        workspaceId,
        type: 'photo',
        caption: '',
        captionByPlatform: {},
        scheduledAt: null,
        timezone: 'Europe/Rome',
        options: EMPTY_POST_OPTIONS,
        createdBy: userId,
      })
      await tx.posts.update(
        { organizationId, workspaceId },
        id,
        change({ status: 'scheduled', scheduledAt: at, updatedBy: userId }),
        1,
      )
      return id
    })
  const theirs = await scheduledIn(otherOrg, otherWs, otherUser)
  // the repository writes where it is told: the use cases refuse an archived client
  await scheduledIn(org, archived, user)
  const ours = await scheduledIn(org, ws, user)
  // another agency's post is not known here, not even by its state
  const statuses = await run((tx) => tx.posts.statuses(org, [theirs, ours]))
  expect([...statuses.keys()]).toEqual([ours])
  expect(await run((tx) => tx.posts.countScheduled(org, day))).toBe(1)
  expect(await run((tx) => tx.posts.countScheduled(org, day, ours))).toBe(0)
  // a post of the day already out or on its way keeps its place; one not out frees it (R5)
  for (const status of ['publishing', 'published', 'paused', 'failed', 'cancelled'])
    await withScope(tdb.runtimeUrl, { kind: 'system' }, async (c) => {
      const id = await scheduledIn(org, ws, user)
      await c.query('update posts set status = $2 where id = $1', [id, status])
    })
  expect(await run((tx) => tx.posts.countScheduled(org, day))).toBe(4)
})

test('the posts that use a file, as a file or as a cover, the scheduled ones first', async () => {
  const draft = await newPost({ type: 'reel' })
  const scheduled = await newPost({ type: 'reel' })
  const unrelated = await seed(tdb.runtimeUrl, (s) => s.media(org, ws, { uploadedBy: user }))
  await run(async (tx) => {
    await tx.posts.replaceMedia(scope(), draft, [unrelated], { source: 'image', mediaId: cover })
    await tx.posts.replaceMedia(scope(), scheduled, [video], { source: 'frame', offsetMs: 0 })
    await tx.posts.update(
      scope(),
      scheduled,
      change({ type: 'reel', status: 'scheduled', scheduledAt: new Date('2026-12-02T17:00:00Z') }),
      1,
    )
  })
  const uses = await run((tx) => tx.posts.usingMedia(org, [cover, unrelated]))
  expect(
    uses
      .filter((u) => u.postId === draft)
      .map((u) => u.mediaId)
      .sort(),
  ).toEqual([cover, unrelated].sort())
  // a draft written after the scheduled post, with the same video
  const later = await newPost({ type: 'reel' })
  await run((tx) => tx.posts.replaceMedia(scope(), later, [video], null))
  const onVideo = await run((tx) => tx.posts.usingMedia(org, [video]))
  expect(onVideo.map((u) => [u.postId, u.status])).toEqual([
    [scheduled, 'scheduled'],
    [later, 'draft'],
  ])
})

test('labels are replaced, each once', async () => {
  const id = await newPost()
  const label = randomUUID()
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query(
      `insert into labels (id, organization_id, workspace_id, name, color)
       values ($1, $2, $3, 'Promo', 'verde')`,
      [label, org, ws],
    ),
  )
  await run((tx) => tx.posts.replaceLabels(scope(), id, [label, label]))
  expect((await run((tx) => tx.posts.find(scope(), id)))?.labelIds).toEqual([label])
})

test('the uses of a file come in the order of `compareUses`, with what it needs (D-80.7)', async () => {
  const file = await seed(tdb.runtimeUrl, (s) => s.media(org, ws, { uploadedBy: user }))
  const withFile = async (status: 'draft' | 'scheduled' | 'cancelled', at: Date | null = null) => {
    const id = await newPost()
    await run(async (tx) => {
      await tx.posts.replaceMedia(scope(), id, [file], null)
      if (status !== 'draft')
        await tx.posts.update(scope(), id, change({ status, scheduledAt: at }), 1)
    })
    return id
  }
  // written in an order that is not the expected one
  const cancelled = await withFile('cancelled', new Date('2026-12-01T17:00:00Z'))
  const olderDraft = await withFile('draft')
  const later = await withFile('scheduled', new Date('2026-12-09T17:00:00Z'))
  const newerDraft = await withFile('draft')
  const sooner = await withFile('scheduled', new Date('2026-12-03T17:00:00Z'))
  const uses = await run((tx) => tx.posts.usingMedia(org, [file]))
  expect(uses.map((u) => u.postId)).toEqual([sooner, later, newerDraft, olderDraft, cancelled])
  expect([...uses].sort(compareUses)).toEqual(uses)
  expect(uses[0]?.timezone).toBe('Europe/Rome')
  expect(uses[0]?.updatedAt).toBeInstanceOf(Date)
})

test('the posts of the publishing among the uses, in the order of `compareUses` (Scelta 5)', async () => {
  const file = await seed(tdb.runtimeUrl, (s) => s.media(org, ws, { uploadedBy: user }))
  const withFile = async (status: string, at: Date) => {
    const id = await newPost()
    await run((tx) => tx.posts.replaceMedia(scope(), id, [file], null))
    // as the worker leaves it
    await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
      c.query(`update posts set status = $2, scheduled_at = $3 where id = $1`, [id, status, at]),
    )
    return id
  }
  const outOld = await withFile('published', new Date('2026-11-01T17:00:00Z'))
  const failed = await withFile('failed', new Date('2026-11-05T17:00:00Z'))
  const paused = await withFile('paused', new Date('2026-12-05T17:00:00Z'))
  const outNew = await withFile('partial', new Date('2026-11-10T17:00:00Z'))
  const going = await withFile('publishing', new Date('2026-11-20T17:00:00Z'))
  const uses = await run((tx) => tx.posts.usingMedia(org, [file]))
  expect(uses.map((u) => u.postId)).toEqual([going, paused, outNew, outOld, failed])
  expect([...uses].sort(compareUses)).toEqual(uses)
})
