import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Tx, UnitOfWork } from '@app/application'
import type { TargetStatus } from '@app/domain'
import { createDb, type DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'
import { createLogger } from '../../logging/logger.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { seed, startTestDatabase, withScope, type TestDatabase } from '../../testing/index.js'

// The publishing's repository and outbox (plan 07 Task 3): the lock of a destination, the moves
// that keep the post's state, the attempts without anything sensitive, the reconciler's read
// with its index, the published destinations of an account, and the isolation between agencies.

let tdb: TestDatabase
let handle: DbHandle
let uow: UnitOfWork
let orgA: string, orgB: string, userA: string, wsA: string, wsB: string
let igA: string, fbA: string, igB: string

const runA = <T>(fn: (tx: Tx) => Promise<T>) => uow.run({ organizationId: orgA, userId: null }, fn)
const runB = <T>(fn: (tx: Tx) => Promise<T>) => uow.run({ organizationId: orgB, userId: null }, fn)
const asSystem = <T>(fn: (tx: Tx) => Promise<T>) => uow.runAsSystem('test', fn)

/** A post with one destination per account, every one in the state given. */
async function newPost(
  organizationId: string,
  workspaceId: string,
  accounts: { accountId: string; status: TargetStatus; nextAttemptAt?: Date | null }[],
  postStatus = 'scheduled',
) {
  const postId = randomUUID()
  const targetIds = accounts.map(() => randomUUID())
  await withScope(tdb.runtimeUrl, { kind: 'system' }, async (c) => {
    await c.query(
      `insert into posts (id, organization_id, workspace_id, type, status, scheduled_at, options,
                          created_by, updated_by)
       values ($1, $2, $3, 'photo', $4, now() + interval '1 hour',
               '{"shareToFeed":true,"choices":[]}', $5, $5)`,
      [postId, organizationId, workspaceId, postStatus, userA],
    )
    for (const [i, a] of accounts.entries())
      await c.query(
        `insert into post_targets (id, organization_id, workspace_id, post_id, account_id, status,
                                   next_attempt_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(secs => $8))`,
        [
          targetIds[i],
          organizationId,
          workspaceId,
          postId,
          a.accountId,
          a.status,
          a.nextAttemptAt ?? null,
          i,
        ],
      )
  })
  return { postId, targetIds }
}

/** What the database said: drizzle wraps its error, the constraint's name is in the cause. */
const refusal = (work: Promise<unknown>) =>
  work.then(
    () => 'accepted',
    (error: unknown) => {
      const cause = (error as { cause?: { message?: string; constraint?: string } }).cause
      return `${cause?.message ?? String(error)} ${cause?.constraint ?? ''}`
    },
  )

const postStatusOf = (postId: string) =>
  withScope(tdb.runtimeUrl, { kind: 'system' }, async (c) => {
    const { rows } = await c.query<{ status: string; version: number }>(
      'select status, version from posts where id = $1',
      [postId],
    )
    return rows[0]
  })

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 4, applicationName: 'publishing-repository' })
  uow = createUnitOfWork({
    db: handle.db,
    ids: uuidV7Generator,
    logger: createLogger({ service: 'worker', level: 'error' }),
  })
  ;({ orgA, orgB, userA, wsA, wsB, igA, fbA, igB } = await seed(tdb.runtimeUrl, async (s) => {
    const orgA = await s.organization()
    const orgB = await s.organization()
    const userA = await s.user()
    await s.member(orgA, userA, 'owner')
    const wsA = await s.workspace(orgA)
    const wsB = await s.workspace(orgB)
    return {
      orgA,
      orgB,
      userA,
      wsA,
      wsB,
      igA: await s.account(orgA, { workspaceIds: [wsA] }),
      fbA: await s.account(orgA, { platform: 'facebook', workspaceIds: [wsA] }),
      igB: await s.account(orgB, { workspaceIds: [wsB] }),
    }
  }))
}, 120_000)

afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

test('a locked destination waits for the transaction that holds it', async () => {
  const { targetIds } = await newPost(orgA, wsA, [{ accountId: igA, status: 'scheduled' }])
  const targetId = targetIds[0] as string
  const order: string[] = []
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  let locked!: () => void
  const isLocked = new Promise<void>((r) => (locked = r))

  const first = runA(async (tx) => {
    const target = await tx.publishing.lockTarget(orgA, targetId)
    expect(target?.status).toBe('scheduled')
    locked()
    await held
    await tx.publishing.saveStep(orgA, targetId, { status: 'preparing', step: 'prepare' })
    order.push('first saved')
  })
  await isLocked
  const second = runA(async (tx) => {
    const target = await tx.publishing.lockTarget(orgA, targetId)
    order.push('second locked')
    return target
  })
  await new Promise((r) => setTimeout(r, 300))
  expect(order).toEqual([])
  release()
  await first
  // the second reads what the first wrote, never the row before it
  expect((await second)?.status).toBe('preparing')
  expect(order).toEqual(['first saved', 'second locked'])
})

test('a move raises the generation and keeps the post state; renew raises it without a move', async () => {
  const { postId, targetIds } = await newPost(orgA, wsA, [
    { accountId: igA, status: 'scheduled' },
    { accountId: fbA, status: 'scheduled' },
  ])
  const [ig, fb] = targetIds as [string, string]
  const before = await postStatusOf(postId)

  const moved = await runA(async (tx) => {
    await tx.publishing.lockTarget(orgA, ig)
    return tx.publishing.saveStep(orgA, ig, { status: 'preparing', step: 'prepare' })
  })
  expect(moved).toEqual({ generation: 1, postStatus: 'publishing' })
  expect((await postStatusOf(postId))?.status).toBe('publishing')

  // a new look at a container: same state, a new key for the job
  const renewed = await runA((tx) =>
    tx.publishing.saveStep(orgA, ig, { renew: true, metaIds: { container: '17890' } }),
  )
  expect(renewed?.generation).toBe(2)
  // nothing moved, nothing renewed: the key stays
  const same = await runA((tx) => tx.publishing.saveStep(orgA, ig, { attempts: 1 }))
  expect(same?.generation).toBe(2)
  // writing the state it already has is not a move
  const again = await runA((tx) => tx.publishing.saveStep(orgA, ig, { status: 'preparing' }))
  expect(again?.generation).toBe(2)

  await runA(async (tx) => {
    await tx.publishing.saveStep(orgA, ig, { status: 'failed', lastErrorCode: 'token_invalid' })
    await tx.publishing.saveStep(orgA, fb, { status: 'preparing' })
  })
  expect((await postStatusOf(postId))?.status).toBe('publishing')
  await runA(async (tx) => {
    for (const status of ['ready', 'publishing', 'published'] as const)
      await tx.publishing.saveStep(orgA, fb, { status })
  })
  // one out and one failed: «1 non uscito»
  expect((await postStatusOf(postId))?.status).toBe('partial')
  // the worker never touches the panel's optimistic lock (P2)
  expect((await postStatusOf(postId))?.version).toBe(before?.version)

  const read = await runA((tx) => tx.publishing.targetsOfPost(orgA, postId))
  expect(read.map((t) => [t.accountId, t.status, t.generation])).toEqual([
    [igA, 'failed', 3],
    [fbA, 'published', 4],
  ])
  expect(read[0]?.metaIds).toEqual({ container: '17890' })
  expect(read[0]?.lastErrorCode).toBe('token_invalid')
})

test('the states of a destination and its step are checked by the database', async () => {
  const { targetIds } = await newPost(orgA, wsA, [{ accountId: igA, status: 'scheduled' }])
  const targetId = targetIds[0] as string
  expect(
    await refusal(
      runA((tx) =>
        tx.publishing.saveStep(orgA, targetId, { status: 'sent' as unknown as TargetStatus }),
      ),
    ),
  ).toMatch(/post_targets_status/)
  expect(
    await refusal(
      runA((tx) =>
        tx.publishing.saveStep(orgA, targetId, { step: 'upload' as unknown as 'prepare' }),
      ),
    ),
  ).toMatch(/post_targets_step/)
})

test('an attempt keeps codes and a duration, and refuses a text from Meta', async () => {
  const { targetIds } = await newPost(orgA, wsA, [{ accountId: igA, status: 'preparing' }])
  const targetId = targetIds[0] as string
  await runA(async (tx) => {
    await tx.publishing.recordAttempt({
      organizationId: orgA,
      workspaceId: wsA,
      targetId,
      step: 'prepare',
      outcome: 'transient',
      errorCode: 'rate_limited',
      metaErrorCode: '4',
      durationMs: 812.6,
    })
    await tx.publishing.recordAttempt({
      organizationId: orgA,
      workspaceId: wsA,
      targetId,
      step: 'prepare',
      outcome: 'done',
      durationMs: 40,
    })
  })
  const rows = await withScope(tdb.runtimeUrl, { kind: 'system' }, async (c) => {
    const { rows } = await c.query<Record<string, unknown>>(
      `select step, outcome, error_code, meta_error_code, duration_ms from target_attempts
       where target_id = $1 order by created_at, outcome desc`,
      [targetId],
    )
    return rows
  })
  expect(rows).toEqual([
    {
      step: 'prepare',
      outcome: 'transient',
      error_code: 'rate_limited',
      meta_error_code: '4',
      duration_ms: 813,
    },
    { step: 'prepare', outcome: 'done', error_code: null, meta_error_code: null, duration_ms: 40 },
  ])
  // Meta's message (which can name the account or carry a token) has no column, and the code's
  // column takes only digits
  expect(
    await refusal(
      runA((tx) =>
        tx.publishing.recordAttempt({
          organizationId: orgA,
          workspaceId: wsA,
          targetId,
          step: 'publish',
          outcome: 'permanent',
          metaErrorCode: 'Invalid OAuth access token EAAB…',
          durationMs: 1,
        }),
      ),
    ),
  ).toMatch(/target_attempts_meta_error_code/)
})

test('the reconciler reads the due destinations of every agency, with the index', async () => {
  const past = new Date(Date.now() - 60_000)
  const later = new Date(Date.now() + 3_600_000)
  const now = new Date()
  const a = await newPost(orgA, wsA, [
    { accountId: igA, status: 'retrying', nextAttemptAt: new Date(past.getTime() - 1000) },
    { accountId: fbA, status: 'scheduled', nextAttemptAt: later },
  ])
  const b = await newPost(orgB, wsB, [{ accountId: igB, status: 'verifying', nextAttemptAt: past }])
  // a draft or a failed destination with a time left behind is not the worker's
  const c = await newPost(orgA, wsA, [{ accountId: igA, status: 'failed', nextAttemptAt: past }])

  const due = await asSystem((tx) => tx.publishing.dueTargets(now, 100))
  const ids = due.map((d) => d.targetId)
  expect(ids).toContain(a.targetIds[0])
  expect(ids).toContain(b.targetIds[0])
  expect(ids).not.toContain(a.targetIds[1])
  expect(ids).not.toContain(c.targetIds[0])
  expect(ids.indexOf(a.targetIds[0] as string)).toBeLessThan(ids.indexOf(b.targetIds[0] as string))
  expect(due.find((d) => d.targetId === b.targetIds[0])).toMatchObject({
    organizationId: orgB,
    workspaceId: wsB,
    status: 'verifying',
    generation: 0,
  })
  expect(await asSystem((tx) => tx.publishing.dueTargets(now, 1))).toHaveLength(1)
  // an agency's own transaction sees only its rows, whatever the query forgets
  const seenByB = await runB((tx) => tx.publishing.dueTargets(now, 100))
  expect(seenByB.every((d) => d.organizationId === orgB)).toBe(true)

  const plan = await withScope(tdb.runtimeUrl, { kind: 'system' }, async (client) => {
    await client.query('set local enable_seqscan = off')
    const { rows } = await client.query<{ 'QUERY PLAN': string }>(
      `explain select id from post_targets
       where status in ('scheduled', 'preparing', 'retrying') and next_attempt_at <= now()
       order by next_attempt_at limit 50`,
    )
    return rows.map((r) => r['QUERY PLAN']).join('\n')
  })
  expect(plan).toMatch(/post_targets_due_idx/)
})

test('the published destinations of an account in a range, the latest first', async () => {
  const { targetIds } = await newPost(orgA, wsA, [
    { accountId: igA, status: 'published' },
    { accountId: fbA, status: 'published' },
  ])
  const other = await newPost(orgA, wsA, [{ accountId: igA, status: 'confirmed' }])
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000)
  await runA(async (tx) => {
    await tx.publishing.saveStep(orgA, targetIds[0] as string, {
      publishedAt: at(30),
      externalPostId: '1789',
    })
    await tx.publishing.saveStep(orgA, targetIds[1] as string, { publishedAt: at(20) })
    await tx.publishing.saveStep(orgA, other.targetIds[0] as string, { publishedAt: at(10) })
  })
  const found = await runA((tx) =>
    tx.publishing.publishedNear(orgA, igA, { from: at(40), to: at(5) }),
  )
  expect(found.map((f) => [f.targetId, f.type, f.externalPostId])).toEqual([
    [other.targetIds[0], 'photo', null],
    [targetIds[0], 'photo', '1789'],
  ])
  expect(
    await runA((tx) => tx.publishing.publishedNear(orgA, igA, { from: at(15), to: at(5) })),
  ).toHaveLength(1)
})

test("another agency's destination is not found, nor moved", async () => {
  const { postId, targetIds } = await newPost(orgB, wsB, [{ accountId: igB, status: 'scheduled' }])
  const targetId = targetIds[0] as string
  await runA(async (tx) => {
    expect(await tx.publishing.lockTarget(orgA, targetId)).toBeNull()
    // the id of the other agency's in the query: row level security still says no
    expect(await tx.publishing.lockTarget(orgB, targetId)).toBeNull()
    expect(await tx.publishing.saveStep(orgB, targetId, { status: 'preparing' })).toBeNull()
    expect(await tx.publishing.targetsOfPost(orgB, postId)).toEqual([])
    expect(
      await tx.publishing.publishedNear(orgB, igB, { from: new Date(0), to: new Date() }),
    ).toEqual([])
  })
  expect(
    await refusal(
      runA((tx) =>
        tx.publishing.recordAttempt({
          organizationId: orgB,
          workspaceId: wsB,
          targetId,
          step: 'prepare',
          outcome: 'done',
          durationMs: 1,
        }),
      ),
    ),
  ).toMatch(/row-level security/)
  expect((await postStatusOf(postId))?.status).toBe('scheduled')
})

test("the outbox: an agency writes and reads its own events, the platform's only the system", async () => {
  await runA((tx) =>
    tx.outbox.record({
      organizationId: orgA,
      type: 'post.target_failed',
      payload: { postId: randomUUID(), targetId: randomUUID(), code: 'token_invalid' },
    }),
  )
  await asSystem((tx) =>
    tx.outbox.record({ organizationId: null, type: 'account.quota_low', payload: { left: 5 } }),
  )
  expect(
    await refusal(
      runB((tx) => tx.outbox.record({ organizationId: orgA, type: 'post.paused', payload: {} })),
    ),
  ).toMatch(/row-level security/)

  const read = (scope: Parameters<typeof withScope>[1]) =>
    withScope(tdb.runtimeUrl, scope, async (c) => {
      const { rows } = await c.query<{ organization_id: string | null; type: string }>(
        'select organization_id, type from outbox_events where dispatched_at is null',
      )
      return rows
    })
  expect(await read({ kind: 'organization', organizationId: orgA })).toEqual([
    { organization_id: orgA, type: 'post.target_failed' },
  ])
  expect(await read({ kind: 'organization', organizationId: orgB })).toEqual([])
  expect(await read({ kind: 'none' })).toEqual([])
  expect(await read({ kind: 'system' })).toEqual(
    expect.arrayContaining([
      { organization_id: orgA, type: 'post.target_failed' },
      { organization_id: null, type: 'account.quota_low' },
    ]),
  )
  expect(
    await refusal(
      runA((tx) =>
        tx.outbox.record({
          organizationId: orgA,
          type: 'post.sent' as unknown as 'post.paused',
          payload: {},
        }),
      ),
    ),
  ).toMatch(/outbox_events_type/)
})

test('at most 3 preparations per agency and 1 per account; an expired claim does not count', async () => {
  // four more accounts of A, one destination each, and one of B
  const accounts = await seed(tdb.runtimeUrl, async (s) => [
    await s.account(orgA, { workspaceIds: [wsA] }),
    await s.account(orgA, { workspaceIds: [wsA] }),
    await s.account(orgA, { workspaceIds: [wsA] }),
    await s.account(orgA, { workspaceIds: [wsA] }),
  ])
  const ofA = await newPost(
    orgA,
    wsA,
    accounts.map((accountId) => ({ accountId, status: 'scheduled' as const })),
  )
  const second = await newPost(orgA, wsA, [
    { accountId: accounts[0] as string, status: 'scheduled' },
  ])
  const ofB = await newPost(orgB, wsB, [{ accountId: igB, status: 'scheduled' }])
  const now = new Date()
  const claim = (org: string, targetId: string, at = now) =>
    uow.run({ organizationId: org, userId: null }, (tx) =>
      tx.publishing.claimPrepare(org, targetId, {
        now: at,
        until: new Date(at.getTime() + 6 * 60_000),
        perOrganization: 3,
        perAccount: 1,
      }),
    )
  const [t1, t2, t3, t4] = ofA.targetIds as [string, string, string, string]
  expect(await claim(orgA, t1)).toBe(true)
  // the same account is busy with another post
  expect(await claim(orgA, second.targetIds[0] as string)).toBe(false)
  expect(await claim(orgA, t2)).toBe(true)
  expect(await claim(orgA, t3)).toBe(true)
  // the agency's three places are taken; another agency is not touched by them
  expect(await claim(orgA, t4)).toBe(false)
  expect(await claim(orgB, ofB.targetIds[0] as string)).toBe(true)
  // claiming again its own place is not a fourth one
  expect(await claim(orgA, t1)).toBe(true)
  // one given back frees a place
  await runA((tx) => tx.publishing.saveStep(orgA, t3, { claimedUntil: null }))
  expect(await claim(orgA, t4)).toBe(true)
  // seven minutes later the claims have expired: a worker gone frees the agency
  const later = new Date(now.getTime() + 7 * 60_000)
  expect(await claim(orgA, second.targetIds[0] as string, later)).toBe(true)
  // a destination of another agency is never claimed from A
  expect(await claim(orgA, ofB.targetIds[0] as string)).toBe(false)
})

test('the panel moving a prepared destination starts a new round and keeps the ids to throw away', async () => {
  const { postId, targetIds } = await newPost(orgA, wsA, [{ accountId: igA, status: 'ready' }])
  const id = targetIds[0] as string
  await runA((tx) =>
    tx.publishing.saveStep(orgA, id, {
      step: 'publish',
      attempts: 2,
      metaIds: { containerId: '17890' },
      lastErrorCode: 'rate_limited',
      claimedUntil: new Date(),
    }),
  )
  const before = await runA((tx) => tx.publishing.lockTarget(orgA, id))
  const at = new Date(Date.now() + 60 * 60_000)
  await runA((tx) =>
    tx.posts.replaceTargets({ organizationId: orgA, workspaceId: wsA }, postId, [
      { accountId: igA, status: 'scheduled', fingerprint: null, nextAttemptAt: at },
    ]),
  )
  const after = await runA((tx) => tx.publishing.lockTarget(orgA, id))
  expect(after).toMatchObject({
    status: 'scheduled',
    step: null,
    attempts: 0,
    lastErrorCode: null,
    nextAttemptAt: at,
    metaIds: { _discard: { containerId: '17890' } },
  })
  expect(after?.generation).toBe((before?.generation ?? 0) + 1)
  // moved again before the worker threw them away: still the same ids to throw away
  await runA((tx) =>
    tx.posts.replaceTargets({ organizationId: orgA, workspaceId: wsA }, postId, [
      { accountId: igA, status: 'scheduled', fingerprint: null, nextAttemptAt: at },
    ]),
  )
  expect((await runA((tx) => tx.publishing.lockTarget(orgA, id)))?.metaIds).toEqual({
    _discard: { containerId: '17890' },
  })
})

test('the reconciler reads only the states it asks for', async () => {
  const past = new Date(Date.now() - 60_000)
  const { targetIds } = await newPost(orgA, wsA, [
    { accountId: igA, status: 'published', nextAttemptAt: past },
    { accountId: fbA, status: 'ready', nextAttemptAt: past },
  ])
  const due = await asSystem((tx) => tx.publishing.dueTargets(new Date(), 1000, ['ready']))
  const ids = due.map((d) => d.targetId)
  expect(ids).toContain(targetIds[1])
  expect(ids).not.toContain(targetIds[0])
})
