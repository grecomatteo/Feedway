import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, ErrorJson, Person } from './identity-env.js'

// Programming in bulk and «Duplica» over HTTP (plan 09 Task 10, P5, Scelta 9): who starts an
// import, who reads and undoes it, the rows checked before anything is kept, and the copies of a
// post with their texts, files, labels and accounts, on the same client only.

let env: ApiEnv
let org: { id: string; slug: string }
let other: { id: string; slug: string }
type Who = 'manager' | 'publisher' | 'editor' | 'viewer'
const people = {} as Record<Who, Person>
const cookies = {} as Record<Who, string>
let forno: string, gino: string, inOther: string
let photo: string, foreignPhoto: string, account: string, takenOff: string, label: string

const ws = (workspaceId = forno, slug = org.slug) =>
  `/api/v1/orgs/${slug}/workspaces/${workspaceId}`

async function call(who: Who, method: 'GET' | 'POST', path: string, body?: unknown) {
  const r = await env.call(method, path, body, { cookie: cookies[who] })
  const text = await r.text()
  return { status: r.status, text, json: text === '' ? null : (JSON.parse(text) as unknown) }
}
type Answer = ReturnType<typeof call>

async function ok<T = Record<string, unknown>>(answer: Answer): Promise<T> {
  const r = await answer
  expect(r.status, r.text).toBe(200)
  return r.json as T
}

async function refused(answer: Answer, status: number, code: string) {
  const r = await answer
  expect(r.status, r.text).toBe(status)
  expect((r.json as ErrorJson).error.code, r.text).toBe(code)
  return r.json as ErrorJson
}

interface BulkImport {
  id: string
  status: string
  total: number
  done: number
  source: string
  rows: ({ status: string; postId?: string; version?: number; reason?: string } | null)[]
  summary: Record<string, number>
  undoUntil: string | null
}

const row = (over: Record<string, unknown> = {}) => ({
  type: 'photo',
  mediaIds: [photo],
  caption: { common: 'Pane caldo' },
  destinations: [{ accountId: account }],
  when: { localDate: '2027-01-12', localTime: '12:00' },
  ...over,
})

/** A post written directly, with its texts and, in Forno Luce, its file, label and accounts. */
async function richPost(workspaceId: string, by: string) {
  const id = randomUUID()
  const { pool } = env.admin
  await pool.query(
    `insert into posts (id, organization_id, workspace_id, type, caption, caption_by_platform,
                        options, created_by, updated_by)
     values ($1, $2, $3, 'photo', 'Pane per tutti', '{"instagram":"Pane su Instagram"}',
             '{"shareToFeed":true,"choices":[]}', $4, $4)`,
    [id, org.id, workspaceId, by],
  )
  if (workspaceId !== forno) return id
  await pool.query(
    `insert into post_media (organization_id, workspace_id, post_id, position, media_id)
     values ($1, $2, $3, 0, $4)`,
    [org.id, workspaceId, id, photo],
  )
  await pool.query(
    'insert into post_labels (organization_id, workspace_id, post_id, label_id) values ($1, $2, $3, $4)',
    [org.id, workspaceId, id, label],
  )
  for (const accountId of [account, takenOff])
    await pool.query(
      `insert into post_targets (id, organization_id, workspace_id, post_id, account_id, status)
       values ($1, $2, $3, $4, $5, 'draft')`,
      [randomUUID(), org.id, workspaceId, id, accountId],
    )
  return id
}

beforeAll(async () => {
  env = await startApiEnv('bulk')
  org = await env.agency()
  other = await env.agency()
  for (const key of ['manager', 'publisher', 'editor', 'viewer'] as const)
    people[key] = await env.person(org.id, 'member')
  ;({ forno, gino, inOther, photo, foreignPhoto, account, takenOff } = await seed(
    env.tdb.runtimeUrl,
    async (s) => {
      const f = await s.workspace(org.id, { name: 'Forno Luce' })
      const g = await s.workspace(org.id, { name: 'Pizzeria Da Gino' })
      const o = await s.workspace(other.id, { name: 'Altra agenzia' })
      for (const key of Object.keys(people) as Who[])
        await s.workspaceMember(org.id, f, people[key].userId, key)
      return {
        forno: f,
        gino: g,
        inOther: o,
        photo: await s.media(org.id, f, { uploadedBy: people.editor.userId, kind: 'image' }),
        foreignPhoto: await s.media(other.id, o, { uploadedBy: randomUUID(), kind: 'image' }),
        account: await s.account(org.id, { workspaceIds: [f] }),
        // on a post of the client, then taken off it: a copy leaves it out
        takenOff: await s.account(org.id),
      }
    },
  ))
  label = randomUUID()
  await env.admin.pool.query(
    `insert into labels (id, organization_id, workspace_id, name, color)
     values ($1, $2, $3, 'Promo', 'blu')`,
    [label, org.id, forno],
  )
  for (const key of Object.keys(people) as Who[]) cookies[key] = await env.signIn(people[key])
}, 300_000)

afterAll(async () => {
  await env.stop()
})

describe('in bulk', () => {
  test('from Publisher: the rows are kept for the worker, one outcome each', async () => {
    const started = await ok<BulkImport>(
      call('publisher', 'POST', `${ws()}/bulk-imports`, {
        source: 'files',
        rows: [row(), row({ when: null, caption: { common: 'Senza data' } })],
      }),
    )
    expect(started).toMatchObject({
      status: 'pending',
      source: 'files',
      total: 2,
      done: 0,
      rows: [null, null],
      undoUntil: null,
    })
    // the rows are kept, never the posts before the worker
    const { rows } = await env.admin.pool.query(
      'select count(*)::int as n from posts where workspace_id = $1 and created_by = $2',
      [forno, people.publisher.userId],
    )
    expect(rows[0]).toEqual({ n: 0 })
    expect(await ok(call('publisher', 'GET', `${ws()}/bulk-imports/${started.id}`))).toMatchObject({
      id: started.id,
      total: 2,
    })
    // anyone else, even a Manager of the client, does not find it
    await refused(call('manager', 'GET', `${ws()}/bulk-imports/${started.id}`), 404, 'NOT_FOUND')
    // not done yet: nothing to undo
    const closed = await refused(
      call('publisher', 'POST', `${ws()}/bulk-imports/${started.id}/undo`),
      409,
      'CONFLICT',
    )
    expect(closed.error.reason).toBe('bulk_undo_closed')
  })

  test('an Editor and a Viewer cannot start one; a client not seen is not found', async () => {
    const body = { source: 'files', rows: [row()] }
    await refused(call('editor', 'POST', `${ws()}/bulk-imports`, body), 403, 'FORBIDDEN')
    await refused(call('viewer', 'POST', `${ws()}/bulk-imports`, body), 403, 'FORBIDDEN')
    await refused(call('publisher', 'POST', `${ws(gino)}/bulk-imports`, body), 404, 'NOT_FOUND')
    await refused(
      call('publisher', 'POST', `${ws(inOther, other.slug)}/bulk-imports`, body),
      404,
      'NOT_FOUND',
    )
  })

  test('the rows are checked before anything is kept: at most 50, ids of the client only', async () => {
    const before = await env.admin.pool.query('select count(*)::int as n from bulk_imports')
    await refused(
      call('publisher', 'POST', `${ws()}/bulk-imports`, {
        source: 'csv',
        rows: Array.from({ length: 51 }, () => row()),
      }),
      422,
      'VALIDATION',
    )
    await refused(
      call('publisher', 'POST', `${ws()}/bulk-imports`, { source: 'files', rows: [] }),
      422,
      'VALIDATION',
    )
    await refused(
      call('publisher', 'POST', `${ws()}/bulk-imports`, {
        source: 'files',
        rows: [row(), row({ mediaIds: [foreignPhoto] })],
      }),
      404,
      'NOT_FOUND',
    )
    await refused(
      call('publisher', 'POST', `${ws()}/bulk-imports`, {
        source: 'files',
        rows: [row({ labelIds: [randomUUID()] })],
      }),
      404,
      'NOT_FOUND',
    )
    // «Duplica» is not a source the table sends
    await refused(
      call('publisher', 'POST', `${ws()}/bulk-imports`, { source: 'duplicate', rows: [row()] }),
      422,
      'VALIDATION',
    )
    expect(
      (await env.admin.pool.query('select count(*)::int as n from bulk_imports')).rows,
    ).toEqual(before.rows)
  })
})

describe('«Duplica»', () => {
  interface PostJson {
    id: string
    caption: Record<string, string>
    media: { id: string }[]
    labelIds: string[]
    destinations: { accountId: string }[]
    when: { localDate: string; localTime: string } | null
    status: string
    createdBy: string
  }

  test('copies on the dates asked, as drafts of the caller, with texts, file, label and the accounts still assigned', async () => {
    const source = await richPost(forno, people.publisher.userId)
    const dates = [
      { localDate: '2027-02-01', localTime: '12:30' },
      { localDate: '2027-02-08', localTime: '12:30' },
    ]
    const copies = await ok<BulkImport>(
      call('editor', 'POST', `${ws()}/posts/${source}/duplicate`, { dates, schedule: false }),
    )
    expect(copies).toMatchObject({
      source: 'duplicate',
      status: 'done',
      summary: { scheduled: 0, drafts: 2, failed: 0 },
    })
    expect(copies.undoUntil).not.toBeNull()
    for (const [i, outcome] of copies.rows.entries()) {
      expect(outcome).toMatchObject({ status: 'draft', reason: 'asked' })
      const post = await ok<PostJson>(
        call('editor', 'GET', `${ws()}/posts/${outcome?.postId ?? ''}`),
      )
      expect(post).toMatchObject({
        caption: { common: 'Pane per tutti', instagram: 'Pane su Instagram' },
        media: [{ id: photo }],
        labelIds: [label],
        destinations: [{ accountId: account }],
        when: dates[i],
        status: 'draft',
        createdBy: people.editor.userId,
      })
    }
  })

  test('«Annulla» within 10 seconds takes the copies away', async () => {
    const source = await richPost(forno, people.publisher.userId)
    const copies = await ok<BulkImport>(
      call('publisher', 'POST', `${ws()}/posts/${source}/duplicate`, {
        dates: [{ localDate: '2027-03-01', localTime: '09:00' }],
        schedule: false,
      }),
    )
    const undone = await ok<BulkImport>(
      call('publisher', 'POST', `${ws()}/bulk-imports/${copies.id}/undo`),
    )
    expect(undone).toMatchObject({ status: 'undone', summary: { removed: 1, kept: 0 } })
    await refused(
      call('publisher', 'GET', `${ws()}/posts/${copies.rows[0]?.postId ?? ''}`),
      404,
      'NOT_FOUND',
    )
    // once only
    await refused(
      call('publisher', 'POST', `${ws()}/bulk-imports/${copies.id}/undo`),
      409,
      'CONFLICT',
    )
  })

  test('«Duplica e programma» from Publisher only; a Viewer copies nothing', async () => {
    const source = await richPost(forno, people.publisher.userId)
    const body = (schedule: boolean) => ({
      dates: [{ localDate: '2027-04-01', localTime: '09:00' }],
      schedule,
    })
    await refused(
      call('editor', 'POST', `${ws()}/posts/${source}/duplicate`, body(true)),
      403,
      'FORBIDDEN',
    )
    await refused(
      call('viewer', 'POST', `${ws()}/posts/${source}/duplicate`, body(false)),
      403,
      'FORBIDDEN',
    )
    // the file was never analysed: its checks block, so the copy stays a draft, with why
    const copies = await ok<BulkImport>(
      call('publisher', 'POST', `${ws()}/posts/${source}/duplicate`, body(true)),
    )
    expect(copies.rows[0]).toMatchObject({ status: 'draft', reason: 'blocked' })
  })

  test('a post of another client or agency is not found, and the dates are checked', async () => {
    const elsewhere = await richPost(gino, people.publisher.userId)
    const body = { dates: [{ localDate: '2027-05-01', localTime: '09:00' }], schedule: false }
    await refused(
      call('publisher', 'POST', `${ws()}/posts/${elsewhere}/duplicate`, body),
      404,
      'NOT_FOUND',
    )
    await refused(
      call('publisher', 'POST', `${ws(gino)}/posts/${elsewhere}/duplicate`, body),
      404,
      'NOT_FOUND',
    )
    const source = await richPost(forno, people.publisher.userId)
    const date = { localDate: '2027-05-01', localTime: '09:00' }
    await refused(
      call('publisher', 'POST', `${ws()}/posts/${source}/duplicate`, {
        dates: [date, date],
        schedule: false,
      }),
      422,
      'VALIDATION',
    )
    await refused(
      call('publisher', 'POST', `${ws()}/posts/${source}/duplicate`, {
        dates: Array.from({ length: 32 }, (_, i) => ({
          localDate: `2027-06-${String((i % 28) + 1).padStart(2, '0')}`,
          localTime: `${String(8 + Math.floor(i / 28)).padStart(2, '0')}:00`,
        })),
        schedule: false,
      }),
      422,
      'VALIDATION',
    )
  })
})
