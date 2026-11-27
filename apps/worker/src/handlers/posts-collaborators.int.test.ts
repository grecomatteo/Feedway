import pg from 'pg'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { getPostOutcome, prepareTarget, publishTarget, verifyTarget } from '@app/application'
import type { Runtime } from '@app/infrastructure'
import { startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { startMetaMock, type MetaMock } from '@app/meta-mock'
import { accountsRuntime, handlerDeps, recordingQueue } from '../../tests/accounts-jobs.js'
import {
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
import { postsCollaboratorsRefresh } from './posts-collaborators.js'

// Instagram's collaborators (plan 09 Task 15, D-125) against the database and the fake Graph
// API: the invitation goes with the container that carries the post, its answers are read once
// the post is confirmed and at «Aggiorna», and a refusal of Meta lets the post out without it.

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

/** The containers made since `from`, with their parameters. */
const containersSince = (from: number) =>
  mock
    .calls()
    .slice(from)
    .filter((c) => c.method === 'POST' && c.path.endsWith('/media'))
    .map((c) => c.params)

interface Published {
  world: PublishingWorld
  postId: string
  deps: ReturnType<typeof workerDeps>
  clock: ReturnType<typeof testClock>
  from: number
}

/** A post on the Instagram account only, prepared and published at its time. */
async function published(opts: {
  type?: 'photo' | 'carousel'
  collaborators: string[]
}): Promise<Published> {
  const world = await publishingWorld(tdb, runtime)
  const count = opts.type === 'carousel' ? 2 : 1
  const mediaIds: string[] = []
  for (let i = 0; i < count; i += 1) mediaIds.push(await readyPhoto(tdb, runtime, admin, world))
  const at = inMinutes(40)
  const { postId } = await scheduledPost(runtime, world, {
    at,
    mediaIds,
    accounts: [world.accounts.instagram],
    type: opts.type ?? 'photo',
    collaborators: opts.collaborators,
  })
  const clock = testClock(new Date(at.getTime() - 15 * MINUTE))
  const deps = workerDeps(runtime, clock, host.url)
  const from = mock.calls().length
  for (const t of await targetsOf(admin, postId))
    await prepareTarget(deps, {
      organizationId: world.organizationId,
      targetId: t.id,
      generation: t.generation,
    })
  clock.set(at)
  for (const t of await targetsOf(admin, postId))
    await publishTarget(deps, {
      organizationId: world.organizationId,
      targetId: t.id,
      generation: t.generation,
    })
  return { world, postId, deps, clock, from }
}

/** The verification 3 minutes later, as the queue runs it. */
async function verified(p: Published) {
  const [target] = await targetsOf(admin, p.postId)
  if (!target) throw new Error('no destination')
  p.clock.set(new Date(p.clock.now().getTime() + 3 * MINUTE))
  return verifyTarget(p.deps, {
    organizationId: p.world.organizationId,
    targetId: target.id,
    generation: target.generation,
  })
}

const refresh = (p: Published) =>
  postsCollaboratorsRefresh(
    { id: 'lavoro', data: { organizationId: p.world.organizationId, postId: p.postId } },
    handlerDeps(runtime, recordingQueue()),
  )

const outcomeOf = async (p: Published) =>
  (
    await getPostOutcome({ ...postsDeps(runtime), logger: runtime.logger }, p.world.actor, {
      workspaceId: p.world.workspaceId,
      postId: p.postId,
      preview: false,
    })
  ).destinations[0]?.collaborators

test('a photo goes out with its collaborators, read once confirmed and again at «Aggiorna»', async () => {
  const p = await published({ collaborators: ['forno.luce', 'mulino'] })
  const [container] = containersSince(p.from)
  expect(container?.['collaborators']).toBe(JSON.stringify(['forno.luce', 'mulino']))
  expect(await outcomeOf(p)).toEqual({
    people: [
      { username: 'forno.luce', status: 'waiting' },
      { username: 'mulino', status: 'waiting' },
    ],
    notSentCode: null,
    readAt: null,
  })

  expect(await verified(p)).toMatchObject({ to: 'confirmed' })
  // the read of the answers is queued once the post is confirmed, one per post
  const queued = p.deps.queue.sent.filter((s) => s.name === 'posts.collaborators_refresh')
  expect(queued).toEqual([
    {
      name: 'posts.collaborators_refresh',
      data: { organizationId: p.world.organizationId, postId: p.postId },
      opts: { singletonKey: p.postId },
    },
  ])

  await refresh(p)
  expect((await outcomeOf(p))?.people).toEqual([
    { username: 'forno.luce', status: 'pending' },
    { username: 'mulino', status: 'pending' },
  ])

  mock.scenario('collaborator_answered', { username: 'mulino', status: 'Accepted' })
  await refresh(p)
  const read = await outcomeOf(p)
  expect(read?.people).toEqual([
    { username: 'forno.luce', status: 'pending' },
    { username: 'mulino', status: 'accepted' },
  ])
  expect(read?.readAt).not.toBeNull()
})

test('a carousel carries them on its own container, never on its items', async () => {
  const p = await published({ type: 'carousel', collaborators: ['forno.luce'] })
  const made = containersSince(p.from)
  expect(made.filter((c) => c['is_carousel_item'] === 'true')).toHaveLength(2)
  expect(made.filter((c) => c['collaborators'] !== undefined)).toEqual([
    expect.objectContaining({ media_type: 'CAROUSEL', collaborators: '["forno.luce"]' }),
  ])
})

test('Meta refuses the collaborators: the container is made again without, the post goes out', async () => {
  mock.scenario('collaborator_rejected', { username: 'nessuno', times: 1 })
  const p = await published({ collaborators: ['forno.luce', 'nessuno'] })
  const made = containersSince(p.from)
  expect(made.map((c) => c['collaborators'] ?? null)).toEqual(['["forno.luce","nessuno"]', null])
  const [target] = await targetsOf(admin, p.postId)
  expect(target?.status).toBe('published')
  expect(await outcomeOf(p)).toEqual({
    people: [
      { username: 'forno.luce', status: 'not_sent' },
      { username: 'nessuno', status: 'not_sent' },
    ],
    notSentCode: '100',
    readAt: null,
  })
  // nothing to read: no job once confirmed
  await verified(p)
  expect(p.deps.queue.sent.some((s) => s.name === 'posts.collaborators_refresh')).toBe(false)
})

test('Meta says to slow down while reading: the account slows down, the next read waits', async () => {
  const p = await published({ collaborators: ['forno.luce'] })
  await verified(p)
  const reads = () =>
    mock.calls().filter((c) => c.method === 'GET' && c.path.endsWith('/collaborators')).length
  mock.scenario('rate_limited', { path: /\/collaborators$/, times: 1 })
  await expect(refresh(p)).rejects.toMatchObject({ code: 'rate_limited' })
  const before = reads()
  // the retry of the queue, seconds later: the load Meta gave is kept, no call goes out
  await refresh(p)
  expect(reads()).toBe(before)
})
