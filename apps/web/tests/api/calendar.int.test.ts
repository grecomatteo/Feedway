import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, ErrorJson, Person } from './identity-env.js'

// The calendar over HTTP (plan 09 Task 2): a period of the clients the person sees and never
// the others, the drafts without a date of the list, «Elimina le bozze vuote», and the agency's
// zone that every member reads (D-78).

let env: ApiEnv
let org: { id: string; slug: string }
const people = {} as Record<'owner' | 'manager' | 'editor' | 'viewer', Person>
const cookies = {} as Record<keyof typeof people, string>
let forno: string, gino: string, archived: string, igForno: string, igGino: string

type Who = keyof typeof people

async function call(who: Who, method: 'GET' | 'POST', path: string, body?: unknown) {
  const r = await env.call(method, `/api/v1/orgs/${org.slug}${path}`, body, {
    cookie: cookies[who],
  })
  const text = await r.text()
  return { status: r.status, json: (text ? JSON.parse(text) : null) as unknown }
}

async function get<T>(who: Who, path: string): Promise<T> {
  const r = await call(who, 'GET', path)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json as T
}

async function post(
  workspaceId: string,
  opts: {
    status?: 'draft' | 'scheduled'
    when?: Date | null
    caption?: string
    accounts?: string[]
    media?: string[]
    author?: string
  } = {},
): Promise<string> {
  const id = randomUUID()
  const { pool } = env.admin
  const author = opts.author ?? people.owner.userId
  await pool.query(
    `insert into posts (id, organization_id, workspace_id, type, caption, status, scheduled_at,
                        options, created_by, updated_by)
     values ($1, $2, $3, 'photo', $4, $5, $6, '{"shareToFeed":true,"choices":[]}', $7, $7)`,
    [
      id,
      org.id,
      workspaceId,
      opts.caption ?? 'Il pane di oggi',
      opts.status ?? 'scheduled',
      opts.when === undefined ? new Date('2027-01-14T10:00:00Z') : opts.when,
      author,
    ],
  )
  for (const [position, mediaId] of (opts.media ?? []).entries())
    await pool.query(
      `insert into post_media (organization_id, workspace_id, post_id, position, media_id)
       values ($1, $2, $3, $4, $5)`,
      [org.id, workspaceId, id, position, mediaId],
    )
  for (const accountId of opts.accounts ?? [])
    await pool.query(
      `insert into post_targets (id, organization_id, workspace_id, post_id, account_id, status)
       values ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), org.id, workspaceId, id, accountId, opts.status ?? 'scheduled'],
    )
  return id
}

const photo = (workspaceId: string) =>
  seed(env.tdb.runtimeUrl, (s) =>
    s.media(org.id, workspaceId, {
      kind: 'image',
      uploadedBy: people.owner.userId,
      variants: ['thumbnail', 'ig_feed'].map((purpose) => ({
        purpose,
        storageKey: `org/${org.id}/media/${randomUUID()}/${purpose}`,
        mime: 'image/jpeg',
        sizeBytes: 1000,
      })),
    }),
  )

const exists = async (id: string) =>
  (await env.admin.pool.query('select 1 from posts where id = $1', [id])).rowCount === 1

beforeAll(async () => {
  env = await startApiEnv('calendar')
  org = await env.agency()
  people.owner = await env.person(org.id, 'owner')
  people.manager = await env.person(org.id, 'member')
  people.editor = await env.person(org.id, 'member')
  people.viewer = await env.person(org.id, 'member')
  ;({ forno, gino, archived, igForno, igGino } = await seed(env.tdb.runtimeUrl, async (s) => {
    const f = await s.workspace(org.id, { name: 'Forno Luce' })
    const g = await s.workspace(org.id, { name: 'Pizzeria Da Gino' })
    const a = await s.workspace(org.id, { name: 'Vecchio cliente', archived: true })
    // the Manager, the Editor and the Viewer see Forno Luce only
    await s.workspaceMember(org.id, f, people.manager.userId, 'manager')
    await s.workspaceMember(org.id, f, people.editor.userId, 'editor')
    await s.workspaceMember(org.id, f, people.viewer.userId, 'viewer')
    return {
      forno: f,
      gino: g,
      archived: a,
      igForno: await s.account(org.id, { platform: 'instagram', workspaceIds: [f] }),
      igGino: await s.account(org.id, { platform: 'instagram', workspaceIds: [g] }),
    }
  }))
  await env.addPasskey(people.owner.userId)
  cookies.owner = await env.strongSignIn(people.owner)
  cookies.manager = await env.signIn(people.manager)
  cookies.editor = await env.signIn(people.editor)
  cookies.viewer = await env.signIn(people.viewer)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

interface CalendarJson {
  timeZone: string
  from: string
  to: string
  posts: {
    id: string
    workspaceId: string
    localDate: string | null
    localTime: string | null
    thumbnail: { mediaId: string } | null
    accounts: { id: string; platform: string }[]
    marks: string[]
  }[]
  entries: unknown[]
  truncated: boolean
}

describe('calendar', () => {
  let inForno: string, inGino: string, image: string

  beforeAll(async () => {
    image = await photo(forno)
    inForno = await post(forno, { accounts: [igForno], media: [image] })
    inGino = await post(gino, { accounts: [igGino] })
  })

  test('the period of every client, with the days in the agency zone', async () => {
    const r = await get<CalendarJson>('owner', '/calendar?from=2027-01-11&to=2027-01-17')
    expect(r).toMatchObject({
      timeZone: 'Europe/Rome',
      from: '2027-01-11',
      to: '2027-01-17',
      truncated: false,
    })
    expect(r.posts.map((p) => p.id).sort()).toEqual([inForno, inGino].sort())
    expect(r.posts.find((p) => p.id === inForno)).toMatchObject({
      localDate: '2027-01-14',
      localTime: '11:00',
      thumbnail: { mediaId: image },
      accounts: [{ id: igForno, platform: 'instagram' }],
      marks: [],
    })
  })

  test('a Manager of one client sees that client only, and 404 for the other', async () => {
    const r = await get<CalendarJson>('manager', '/calendar?from=2027-01-11&to=2027-01-17')
    expect(r.posts.map((p) => p.id)).toEqual([inForno])
    // narrowing «Tutti i clienti» to a hidden client gives nothing, not an error
    const narrowed = await get<CalendarJson>(
      'manager',
      `/calendar?from=2027-01-11&to=2027-01-17&workspaceIds=${gino}`,
    )
    expect(narrowed.posts).toEqual([])
    const hidden = await call(
      'manager',
      'GET',
      `/calendar?from=2027-01-11&to=2027-01-17&workspaceId=${gino}`,
    )
    expect(hidden.status).toBe(404)
    expect((hidden.json as ErrorJson).error.code).toBe('NOT_FOUND')
  })

  test('the Viewer reads the calendar without thumbnails (D-72)', async () => {
    const r = await get<CalendarJson>(
      'viewer',
      `/calendar?from=2027-01-11&to=2027-01-17&workspaceId=${forno}`,
    )
    expect(r.posts).toEqual([expect.objectContaining({ id: inForno, thumbnail: null })])
  })

  test('filters in the query, and a period longer than 42 days refused', async () => {
    const byAccount = await get<CalendarJson>(
      'owner',
      `/calendar?from=2027-01-11&to=2027-01-17&accountIds=${igGino}&platforms=instagram`,
    )
    expect(byAccount.posts.map((p) => p.id)).toEqual([inGino])
    const long = await call('owner', 'GET', '/calendar?from=2027-01-01&to=2027-02-12')
    expect(long.status).toBe(422)
    const unknown = await call(
      'owner',
      'GET',
      '/calendar?from=2027-01-01&to=2027-01-02&statuses=boh',
    )
    expect(unknown.status).toBe(422)
  })
})

describe('drafts without a date', () => {
  let mine: string, editors: string, withFile: string, withText: string, dated: string

  beforeAll(async () => {
    const image = await photo(forno)
    mine = await post(forno, { status: 'draft', when: null, caption: '' })
    editors = await post(forno, {
      status: 'draft',
      when: null,
      caption: '',
      author: people.editor.userId,
    })
    withFile = await post(forno, { status: 'draft', when: null, caption: '', media: [image] })
    withText = await post(forno, { status: 'draft', when: null, caption: 'Idea per Natale' })
    dated = await post(forno, {
      status: 'draft',
      when: new Date('2027-01-20T10:00:00Z'),
      caption: '',
    })
  })

  test('the list reads them, the empty ones said so', async () => {
    const r = await get<{ items: { id: string; empty: boolean; localDate: string | null }[] }>(
      'owner',
      `/calendar/drafts?workspaceId=${forno}`,
    )
    const ids = r.items.map((d) => d.id)
    expect(ids).toEqual(expect.arrayContaining([mine, editors, withFile, withText]))
    expect(ids).not.toContain(dated)
    expect(r.items.find((d) => d.id === mine)).toMatchObject({ empty: true, localDate: null })
    expect(r.items.find((d) => d.id === withFile)?.empty).toBe(false)
  })

  test('«Elimina le bozze vuote»: an Editor takes only their own, never a draft with a file', async () => {
    const r = await call('editor', 'POST', '/calendar/drafts/delete-empty', { all: true })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    expect(r.json).toEqual({ deleted: 1 })
    expect(await exists(editors)).toBe(false)
    expect(await exists(mine)).toBe(true)
    expect(await exists(withFile)).toBe(true)
  })

  test('the Owner takes their own without `all`, and everyone’s with it', async () => {
    const other = await post(forno, {
      status: 'draft',
      when: null,
      caption: '',
      author: people.editor.userId,
    })
    expect((await call('owner', 'POST', '/calendar/drafts/delete-empty', {})).json).toEqual({
      deleted: 1,
    })
    expect(await exists(mine)).toBe(false)
    expect(await exists(other)).toBe(true)
    expect(
      (
        await call('owner', 'POST', '/calendar/drafts/delete-empty', {
          all: true,
          workspaceId: forno,
        })
      ).json,
    ).toEqual({ deleted: 1 })
    expect(await exists(other)).toBe(false)
    for (const kept of [withFile, withText, dated]) expect(await exists(kept)).toBe(true)
    const log = await env.admin.pool.query(
      `select count(*)::int as n from audit_log where action = 'post.deleted' and entity_id = $1`,
      [other],
    )
    expect(log.rows[0]).toEqual({ n: 1 })
  })

  test('an archived client asked by name is refused, with or without empty drafts', async () => {
    const body = { all: true, workspaceId: archived }
    expect((await call('owner', 'POST', '/calendar/drafts/delete-empty', body)).status).toBe(409)
    const draft = await post(archived, { status: 'draft', when: null, caption: '' })
    expect((await call('owner', 'POST', '/calendar/drafts/delete-empty', body)).status).toBe(409)
    expect(await exists(draft)).toBe(true)
  })

  test('a draft with an internal note stays; older empty drafts are found behind many full ones', async () => {
    const noted = await post(gino, { status: 'draft', when: null, caption: '' })
    await env.admin.pool.query(
      `insert into post_notes (id, organization_id, workspace_id, post_id, author_id, body)
       values ($1, $2, $3, $4, $5, 'Chiedere le foto al cliente')`,
      [randomUUID(), org.id, gino, noted, people.manager.userId],
    )
    const old = await post(gino, { status: 'draft', when: null, caption: '' })
    await env.admin.pool.query(
      `update posts set updated_at = now() - interval '1 year' where id = $1`,
      [old],
    )
    // more full drafts, changed later, than the drafts read at once
    await env.admin.pool.query(
      `insert into posts (id, organization_id, workspace_id, type, caption, status, options,
                          created_by, updated_by)
       select gen_random_uuid(), $1, $2, 'photo', 'Idea', 'draft',
              '{"shareToFeed":true,"choices":[]}', $3, $3
       from generate_series(1, 2100)`,
      [org.id, gino, people.owner.userId],
    )
    const r = await call('owner', 'POST', '/calendar/drafts/delete-empty', {
      all: true,
      workspaceId: gino,
    })
    expect(r.json).toEqual({ deleted: 1 })
    expect(await exists(old)).toBe(false)
    expect(await exists(noted)).toBe(true)
  })

  test('a Manager with `all` takes the empty drafts of others in their client', async () => {
    const editors = await post(forno, {
      status: 'draft',
      when: null,
      caption: '',
      author: people.editor.userId,
    })
    expect(
      (await call('manager', 'POST', '/calendar/drafts/delete-empty', { all: true })).json,
    ).toEqual({
      deleted: 1,
    })
    expect(await exists(editors)).toBe(false)
  })

  test('the Viewer deletes nothing', async () => {
    const draft = await post(forno, {
      status: 'draft',
      when: null,
      caption: '',
      author: people.viewer.userId,
    })
    expect((await call('viewer', 'POST', '/calendar/drafts/delete-empty', {})).json).toEqual({
      deleted: 0,
    })
    expect(await exists(draft)).toBe(true)
  })
})

test('every member reads the agency zone in `me` (D-78)', async () => {
  await env.admin.pool.query(
    `update organizations set settings = settings || '{"timezone":"Europe/London"}' where id = $1`,
    [org.id],
  )
  const r = await env.call('GET', '/api/v1/me', undefined, { cookie: cookies.editor })
  const me = (await r.json()) as { organizations: { id: string; timezone: string }[] }
  expect(me.organizations.find((o) => o.id === org.id)?.timezone).toBe('Europe/London')
  const calendar = await get<CalendarJson>('editor', '/calendar?from=2027-01-11&to=2027-01-17')
  expect(calendar.timeZone).toBe('Europe/London')
  expect(calendar.posts[0]?.localTime).toBe('10:00')
})
