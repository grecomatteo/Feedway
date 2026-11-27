import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { DRAFTS_CLEANUP_BATCH } from '@app/application'
import type { Runtime } from '@app/infrastructure'
import { seed, startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { startMetaMock, type MetaMock } from '@app/meta-mock'
import { accountsRuntime, agency, handlerDeps, recordingQueue } from '../../tests/accounts-jobs.js'
import { postsDraftsCleanup } from './posts-drafts-cleanup.js'

// `posts.drafts_cleanup` (plan 09 Task 14, Scelta 12): every night «Eliminati» older than 30
// days and the empty drafts left for 24 hours go for good, the drafts nobody touched for the days
// of their client go to «Eliminati»; an archived client is left alone; on two workers each post
// goes once.

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client

const DAY = 86_400_000
const NOW = new Date('2027-03-10T02:45:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  runtime = await accountsRuntime(tdb, mock)
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
}, 120_000)

afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 }).catch(() => undefined)
  await runtime.close()
  await admin.end()
  await mock.stop()
  await tdb.stop()
})

interface PostSeed {
  workspaceId: string
  updatedAt: Date
  caption?: string
  scheduledAt?: Date | null
  status?: 'draft' | 'cancelled'
  trashedAt?: Date | null
  note?: boolean
}

async function post(organizationId: string, author: string, p: PostSeed): Promise<string> {
  const id = randomUUID()
  await admin.query(
    `insert into posts (id, organization_id, workspace_id, type, caption, status, scheduled_at,
                        options, created_by, updated_by, trashed_at, trashed_by, updated_at)
     values ($1, $2, $3, 'photo', $4, $5, $6, '{"shareToFeed":true,"choices":[]}', $7, $7, $8,
             case when $8::timestamptz is null then null else $7::uuid end, $9)`,
    [
      id,
      organizationId,
      p.workspaceId,
      p.caption ?? 'Il pane di oggi',
      p.status ?? 'draft',
      p.scheduledAt ?? null,
      author,
      p.trashedAt ?? null,
      p.updatedAt,
    ],
  )
  if (p.note)
    await admin.query(
      `insert into post_notes (id, organization_id, workspace_id, post_id, author_id, body)
       values ($1, $2, $3, $4, $5, 'Da rivedere')`,
      [randomUUID(), organizationId, p.workspaceId, id, author],
    )
  return id
}

const state = async (id: string) => {
  const { rows } = await admin.query<{ trashed: boolean; status: string }>(
    'select trashed_at is not null as trashed, status from posts where id = $1',
    [id],
  )
  return rows[0] ? (rows[0].trashed ? `trashed:${rows[0].status}` : rows[0].status) : 'gone'
}

const deps = () => ({ ...handlerDeps(runtime, recordingQueue()), clock: { now: () => NOW } })

test('the night empties «Eliminati», the empty drafts and the forgotten ones, client by client', async () => {
  const a = await agency(tdb, runtime)
  const { thirty, sixty, never, archived } = await seed(tdb.runtimeUrl, async (s) => ({
    thirty: await s.workspace(a.organizationId, { name: 'Forno Luce' }),
    sixty: await s.workspace(a.organizationId, { name: 'Bar Sole' }),
    never: await s.workspace(a.organizationId, { name: 'Pasticceria' }),
    archived: await s.workspace(a.organizationId, { name: 'Vecchio cliente', archived: true }),
  }))
  await admin.query(
    'update workspaces set draft_retention_days = case id when $1 then 60 when $2 then null end where id in ($1, $2)',
    [sixty, never],
  )
  const p = (seedOf: PostSeed) => post(a.organizationId, a.ownerId, seedOf)
  const ids = {
    trashedLong: await p({
      workspaceId: thirty,
      updatedAt: ago(40 * DAY),
      trashedAt: ago(31 * DAY),
    }),
    trashedCancelled: await p({
      workspaceId: thirty,
      status: 'cancelled',
      updatedAt: ago(40 * DAY),
      trashedAt: ago(31 * DAY),
    }),
    trashedRecent: await p({
      workspaceId: thirty,
      updatedAt: ago(40 * DAY),
      trashedAt: ago(29 * DAY),
    }),
    emptyOld: await p({ workspaceId: thirty, caption: '  ', updatedAt: ago(25 * 3_600_000) }),
    emptyNew: await p({ workspaceId: thirty, caption: '', updatedAt: ago(23 * 3_600_000) }),
    emptyWithNote: await p({
      workspaceId: thirty,
      caption: '',
      updatedAt: ago(2 * DAY),
      note: true,
    }),
    // a draft born from «Prepara» has its date: never empty
    fromPlan: await p({
      workspaceId: thirty,
      caption: '',
      scheduledAt: new Date('2027-03-20T10:00:00Z'),
      updatedAt: ago(2 * DAY),
    }),
    // a prepared draft waits for its date, then goes like the others
    datedAhead: await p({
      workspaceId: thirty,
      scheduledAt: new Date('2027-04-20T10:00:00Z'),
      updatedAt: ago(40 * DAY),
    }),
    datedPast: await p({
      workspaceId: thirty,
      scheduledAt: new Date('2027-03-01T10:00:00Z'),
      updatedAt: ago(40 * DAY),
    }),
    forgotten30: await p({ workspaceId: thirty, updatedAt: ago(31 * DAY) }),
    touched30: await p({ workspaceId: thirty, updatedAt: ago(29 * DAY) }),
    forgotten60: await p({ workspaceId: sixty, updatedAt: ago(61 * DAY) }),
    kept60: await p({ workspaceId: sixty, updatedAt: ago(45 * DAY) }),
    keptNever: await p({ workspaceId: never, updatedAt: ago(400 * DAY) }),
    // a cancelled post is not a forgotten draft
    cancelledOld: await p({ workspaceId: thirty, status: 'cancelled', updatedAt: ago(90 * DAY) }),
    archivedTrashed: await p({
      workspaceId: archived,
      updatedAt: ago(90 * DAY),
      trashedAt: ago(60 * DAY),
    }),
    archivedEmpty: await p({ workspaceId: archived, caption: '', updatedAt: ago(5 * DAY) }),
    archivedForgotten: await p({ workspaceId: archived, updatedAt: ago(90 * DAY) }),
  }

  await postsDraftsCleanup({ id: 'lavoro', data: {} }, deps())

  const states: Record<string, string> = {}
  for (const [k, id] of Object.entries(ids)) states[k] = await state(id)
  expect(states).toEqual({
    trashedLong: 'gone',
    trashedCancelled: 'gone',
    trashedRecent: 'trashed:draft',
    emptyOld: 'gone',
    emptyNew: 'draft',
    emptyWithNote: 'draft',
    fromPlan: 'draft',
    datedAhead: 'draft',
    datedPast: 'trashed:draft',
    forgotten30: 'trashed:draft',
    touched30: 'draft',
    forgotten60: 'trashed:draft',
    kept60: 'draft',
    keptNever: 'draft',
    cancelledOld: 'cancelled',
    archivedTrashed: 'trashed:draft',
    archivedEmpty: 'draft',
    archivedForgotten: 'draft',
  })
  // the night wrote it: no person, the reason the retention
  const { rows: moved } = await admin.query<{ trashed_by: string | null; trashed_at: Date }>(
    'select trashed_by, trashed_at from posts where id = $1',
    [ids.forgotten30],
  )
  expect(moved).toEqual([{ trashed_by: null, trashed_at: NOW }])
  const { rows: log } = await admin.query<{
    action: string
    actor_id: string | null
    data: unknown
  }>(
    `select action, actor_id, data from audit_log where organization_id = $1 and entity_id = any($2)
     order by action`,
    [a.organizationId, [ids.trashedLong, ids.emptyOld, ids.forgotten30]],
  )
  expect(log).toEqual([
    { action: 'post.deleted', actor_id: null, data: { reason: 'retention' } },
    { action: 'post.deleted', actor_id: null, data: { reason: 'retention' } },
    { action: 'post.trashed', actor_id: null, data: { reason: 'retention' } },
  ])
})

test('a suspended agency is left alone: its people cannot get its drafts back', async () => {
  const a = await agency(tdb, runtime)
  const workspaceId = await seed(tdb.runtimeUrl, (s) => s.workspace(a.organizationId))
  const trashed = await post(a.organizationId, a.ownerId, {
    workspaceId,
    updatedAt: ago(90 * DAY),
    trashedAt: ago(60 * DAY),
  })
  const forgotten = await post(a.organizationId, a.ownerId, {
    workspaceId,
    updatedAt: ago(90 * DAY),
  })
  // the status changes only in the system scope
  await admin.query("select set_config('app.scope', 'system', false)")
  await admin.query(
    `update organizations set status = 'suspended', suspended_at = now() where id = $1`,
    [a.organizationId],
  )
  await admin.query("select set_config('app.scope', '', false)")
  await postsDraftsCleanup({ id: 'sospesa', data: {} }, deps())
  expect([await state(trashed), await state(forgotten)]).toEqual(['trashed:draft', 'draft'])
})

test('on two workers at once, each post goes once and is logged once', async () => {
  const a = await agency(tdb, runtime)
  const workspaceId = await seed(tdb.runtimeUrl, (s) => s.workspace(a.organizationId))
  const ids: string[] = []
  for (let i = 0; i < 5; i++)
    ids.push(
      await post(a.organizationId, a.ownerId, {
        workspaceId,
        updatedAt: ago(40 * DAY),
        trashedAt: ago(35 * DAY),
      }),
    )
  await Promise.all([
    postsDraftsCleanup({ id: 'uno', data: {} }, deps()),
    postsDraftsCleanup({ id: 'due', data: {} }, deps()),
  ])
  for (const id of ids) expect(await state(id)).toBe('gone')
  const { rows } = await admin.query<{ n: number }>(
    `select count(*)::int as n from audit_log where action = 'post.deleted' and entity_id = any($1)`,
    [ids],
  )
  expect(rows[0]?.n).toBe(5)
})

test('a batch that fails takes only its own posts; the others go, and the job fails', async () => {
  const a = await agency(tdb, runtime)
  const workspaceId = await seed(tdb.runtimeUrl, (s) => s.workspace(a.organizationId))
  const expired: string[] = []
  // one batch more than full: the first one holds the post that cannot go
  for (let i = 0; i <= DRAFTS_CLEANUP_BATCH; i++)
    expired.push(
      await post(a.organizationId, a.ownerId, {
        workspaceId,
        updatedAt: ago(40 * DAY),
        trashedAt: ago(35 * DAY),
      }),
    )
  const sorted = [...expired].sort()
  const stuck = sorted[0] ?? ''
  const forgotten = await post(a.organizationId, a.ownerId, {
    workspaceId,
    updatedAt: ago(31 * DAY),
  })
  // a constraint a future change could bring: this one post refuses to go
  await admin.query(`
    create function test_refuse_delete() returns trigger language plpgsql as $$
    begin
      if old.id = '${stuck}' then raise exception 'test: this post cannot go'; end if;
      return old;
    end $$`)
  await admin.query(
    'create trigger test_refuse_delete before delete on posts for each row execute function test_refuse_delete()',
  )
  try {
    await expect(postsDraftsCleanup({ id: 'difettoso', data: {} }, deps())).rejects.toThrow(
      /failed in 1 steps/,
    )
  } finally {
    await admin.query('drop trigger test_refuse_delete on posts')
    await admin.query('drop function test_refuse_delete()')
  }
  // the failed batch is left as it was, to go the next night
  for (const id of sorted.slice(0, DRAFTS_CLEANUP_BATCH))
    expect(await state(id)).toBe('trashed:draft')
  // the next batch of the same kind, and the other kinds, went all the same
  expect(await state(sorted[DRAFTS_CLEANUP_BATCH] ?? '')).toBe('gone')
  expect(await state(forgotten)).toBe('trashed:draft')
  // the next night, with nothing in the way, the rest goes
  await postsDraftsCleanup({ id: 'notte-dopo', data: {} }, deps())
  for (const id of expired) expect(await state(id)).toBe('gone')
})
