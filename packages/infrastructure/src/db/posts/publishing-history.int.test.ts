import { afterAll, beforeAll, expect, test } from 'vitest'
import type { Tx, UnitOfWork } from '@app/application'
import { EMPTY_POST_OPTIONS, type PostType } from '@app/domain'
import { createDb, type DbHandle } from '../client.js'
import { createUnitOfWork } from '../unit-of-work.js'
import { createLogger } from '../../logging/logger.js'
import { uuidV7Generator } from '../../system/id-generator.js'
import { postgresPublishingHistory } from '../../system/publishing-history.js'
import { seed, startTestDatabase, withScope, type TestDatabase } from '../../testing/index.js'

// What the checks read of the scheduled posts (plan 06 Task 3): fingerprints within 7 days,
// reels and posts in the 24 hours before the instant, by account, the post itself left out.

let tdb: TestDatabase
let handle: DbHandle
let uow: UnitOfWork
let org: string, otherOrg: string, user: string, ws: string, ig: string, fb: string

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const AT = new Date('2026-12-10T12:00:00Z')
const run = <T>(organizationId: string, fn: (tx: Tx) => Promise<T>) =>
  uow.run({ organizationId, userId: user }, fn)

async function scheduled(
  at: Date,
  accountIds: string[],
  opts: { type?: PostType; fingerprint?: string; status?: 'scheduled' | 'draft' } = {},
) {
  const id = uuidV7Generator.newId()
  const scope = { organizationId: org, workspaceId: ws }
  const status = opts.status ?? 'scheduled'
  await run(org, async (tx) => {
    await tx.posts.insert({
      id,
      organizationId: org,
      workspaceId: ws,
      type: opts.type ?? 'photo',
      caption: '',
      captionByPlatform: {},
      scheduledAt: at,
      timezone: 'Europe/Rome',
      options: EMPTY_POST_OPTIONS,
      createdBy: user,
    })
    await tx.posts.update(
      scope,
      id,
      {
        type: opts.type ?? 'photo',
        caption: '',
        captionByPlatform: {},
        scheduledAt: at,
        status,
        options: EMPTY_POST_OPTIONS,
        scheduledBy: user,
        updatedBy: user,
      },
      1,
    )
    await tx.posts.replaceTargets(
      scope,
      id,
      accountIds.map((accountId) => ({
        accountId,
        status,
        fingerprint: opts.fingerprint ?? null,
      })),
    )
  })
  return id
}

const facts = (accountIds: string[], excludePostId?: string, organizationId = org) =>
  run(organizationId, (tx) =>
    postgresPublishingHistory.forDestinations(tx, {
      organizationId,
      accountIds,
      at: AT,
      ...(excludePostId === undefined ? {} : { excludePostId }),
    }),
  )

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 2, applicationName: 'publishing-history' })
  uow = createUnitOfWork({
    db: handle.db,
    ids: uuidV7Generator,
    logger: createLogger({ service: 'web', level: 'error' }),
  })
  ;({ org, otherOrg, user, ws, ig, fb } = await seed(tdb.runtimeUrl, async (s) => {
    const org = await s.organization()
    const otherOrg = await s.organization()
    const user = await s.user()
    await s.member(org, user, 'owner')
    await s.member(otherOrg, user, 'owner')
    const ws = await s.workspace(org)
    return {
      org,
      otherOrg,
      user,
      ws,
      ig: await s.account(org, { workspaceIds: [ws] }),
      fb: await s.account(org, { platform: 'facebook', workspaceIds: [ws] }),
    }
  }))
}, 120_000)

afterAll(async () => {
  await handle.close()
  await tdb.stop()
})

test('a scheduled post within 7 days gives its fingerprint; one further out does not', async () => {
  const near = 'a'.repeat(64)
  const edge = 'b'.repeat(64)
  const far = 'c'.repeat(64)
  await scheduled(new Date(AT.getTime() + 2 * DAY), [ig], { fingerprint: near })
  await scheduled(new Date(AT.getTime() - 7 * DAY), [ig], { fingerprint: edge })
  await scheduled(new Date(AT.getTime() + 7 * DAY + 1000), [ig], { fingerprint: far })
  const { recentFingerprints } = await facts([ig])
  expect([...(recentFingerprints.get(ig) ?? [])].sort()).toEqual([near, edge].sort())
})

test('a draft and a post of another agency count for nothing', async () => {
  const draftPrint = 'd'.repeat(64)
  await scheduled(new Date(AT.getTime() - HOUR), [fb], { fingerprint: draftPrint, status: 'draft' })
  const { recentFingerprints, scheduledNear } = await facts([fb])
  expect(recentFingerprints.get(fb)?.has(draftPrint) ?? false).toBe(false)
  expect(scheduledNear.get(fb) ?? 0).toBe(0)
  const other = await facts([ig], undefined, otherOrg)
  expect(other.recentFingerprints.size + other.scheduledNear.size).toBe(0)
})

test('posts and reels are counted in the 24 hours before the instant, by account', async () => {
  const a = await seed(tdb.runtimeUrl, (s) =>
    s.account(org, { platform: 'facebook', workspaceIds: [ws] }),
  )
  // inside: the instant itself and just after the start of the window
  await scheduled(AT, [a], { type: 'reel' })
  await scheduled(new Date(AT.getTime() - DAY + 1000), [a], { type: 'reel' })
  await scheduled(new Date(AT.getTime() - 3 * HOUR), [a, ig])
  // outside: exactly 24 hours before, and after the instant
  await scheduled(new Date(AT.getTime() - DAY), [a], { type: 'reel' })
  await scheduled(new Date(AT.getTime() + 1000), [a], { type: 'reel' })
  const { reelsLast24h, scheduledNear } = await facts([a])
  expect(reelsLast24h.get(a)).toBe(2)
  expect(scheduledNear.get(a)).toBe(3)
  // only the accounts asked
  expect(scheduledNear.has(ig)).toBe(false)
})

test('thirty reels on a Facebook page in the 24 hours are all counted', async () => {
  const page = await seed(tdb.runtimeUrl, (s) =>
    s.account(org, { platform: 'facebook', workspaceIds: [ws] }),
  )
  for (let i = 0; i < 30; i++)
    await scheduled(new Date(AT.getTime() - (i + 1) * 10 * 60 * 1000), [page], { type: 'reel' })
  expect((await facts([page])).reelsLast24h.get(page)).toBe(30)
})

test('a post on its way, out or with a problem counts too; one not out or cancelled does not (R5)', async () => {
  const page = await seed(tdb.runtimeUrl, (s) =>
    s.account(org, { platform: 'facebook', workspaceIds: [ws] }),
  )
  const states = {
    preparing: null,
    paused: null,
    published: 90,
    confirmed: 90,
    problem: 90,
    failed: null,
    cancelled: null,
  } as const
  const prints = new Map<string, string>()
  for (const [i, [status, outMinutes]] of Object.entries(states).entries()) {
    const print = String(i).repeat(64)
    prints.set(status, print)
    const id = await scheduled(new Date(AT.getTime() - 2 * HOUR), [page], {
      type: 'reel',
      fingerprint: print,
    })
    await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
      c.query(
        `update post_targets set status = $2,
           published_at = case when $3::int is null then null
                               else $4::timestamptz - make_interval(mins => $3::int) end
         where post_id = $1`,
        [id, status, outMinutes, AT],
      ),
    )
  }
  // scheduled long ago, out with a «Riprova» two hours before: counted when it went out
  const late = await scheduled(new Date(AT.getTime() - 30 * HOUR), [page], { type: 'reel' })
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query(
      `update post_targets set status = 'confirmed', published_at = $2::timestamptz - interval '2 hours'
       where post_id = $1`,
      [late, AT],
    ),
  )
  const { recentFingerprints, reelsLast24h, scheduledNear } = await facts([page])
  expect(reelsLast24h.get(page)).toBe(6)
  expect(scheduledNear.get(page)).toBe(6)
  const seen = recentFingerprints.get(page) ?? new Set<string>()
  for (const status of ['preparing', 'paused', 'published', 'confirmed', 'problem'])
    expect(seen.has(prints.get(status) ?? ''), status).toBe(true)
  for (const status of ['failed', 'cancelled'])
    expect(seen.has(prints.get(status) ?? ''), status).toBe(false)
})

test('the post being checked is never counted, nor a duplicate of itself', async () => {
  const page = await seed(tdb.runtimeUrl, (s) =>
    s.account(org, { platform: 'facebook', workspaceIds: [ws] }),
  )
  const print = 'e'.repeat(64)
  const own = await scheduled(new Date(AT.getTime() - HOUR), [page], {
    type: 'reel',
    fingerprint: print,
  })
  const counted = await facts([page])
  expect(counted.recentFingerprints.get(page)?.has(print)).toBe(true)
  const excluded = await facts([page], own)
  expect(excluded.recentFingerprints.get(page)?.has(print) ?? false).toBe(false)
  expect(excluded.reelsLast24h.get(page) ?? 0).toBe(0)
  expect(excluded.scheduledNear.get(page) ?? 0).toBe(0)
})
