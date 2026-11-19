import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, ErrorJson, Person } from './identity-env.js'

// «Oggi» over HTTP (redesign R3): the posts that go out, the drafts to finish, what needs a hand
// and the clients' activity, across the clients the person sees and never the others, not even
// in a count.

let env: ApiEnv
let org: { id: string; slug: string }
const people = {} as Record<'owner' | 'editor' | 'viewer', Person>
const cookies = {} as Record<keyof typeof people, string>
let forno: string, gino: string, archived: string
let igForno: string, fbForno: string, igGino: string

type Who = keyof typeof people

const HOUR = 60 * 60 * 1000
/** From the real clock: the server reads «from now» with it. */
const at = (hours: number) => new Date(Date.now() + hours * HOUR)

async function get<T>(who: Who, path: string): Promise<T> {
  const r = await env.call('GET', `/api/v1/orgs/${org.slug}${path}`, undefined, {
    cookie: cookies[who],
  })
  const text = await r.text()
  expect(r.status, text).toBe(200)
  return JSON.parse(text) as T
}

async function status(who: Who, path: string) {
  const r = await env.call('GET', `/api/v1/orgs/${org.slug}${path}`, undefined, {
    cookie: cookies[who],
  })
  return { status: r.status, code: ((await r.json()) as ErrorJson).error.code }
}

/** A post written as the panel would leave it, in the past or the future. */
async function post(
  workspaceId: string,
  opts: {
    status?: 'draft' | 'scheduled' | 'cancelled'
    when?: Date | null
    caption?: string
    type?: 'photo' | 'carousel' | 'reel'
    accounts?: string[]
    media?: string[]
    changed?: Date
  } = {},
): Promise<string> {
  const id = randomUUID()
  const { pool } = env.admin
  await pool.query(
    `insert into posts (id, organization_id, workspace_id, type, caption, status, scheduled_at,
                        options, created_by, updated_by, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, '{"shareToFeed":true,"choices":[]}', $8, $8, $9)`,
    [
      id,
      org.id,
      workspaceId,
      opts.type ?? 'photo',
      opts.caption ?? 'Il pane di oggi',
      opts.status ?? 'scheduled',
      opts.when === undefined ? at(5) : opts.when,
      people.owner.userId,
      opts.changed ?? new Date(),
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

/** A photo of the client with its thumbnail, as the worker leaves it. */
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

/** A file the worker could not prepare; `kept`: its original is still stored. */
async function failed(workspaceId: string, code: string, kept = true) {
  const id = await seed(env.tdb.runtimeUrl, (s) =>
    s.media(org.id, workspaceId, {
      uploadedBy: people.owner.userId,
      ...(kept ? {} : { storageKey: null }),
    }),
  )
  await env.admin.pool.query(
    `update media set status = 'failed', failure = $2, original_name = $3 where id = $1`,
    [id, JSON.stringify({ code }), `${code}.mov`],
  )
  return id
}

beforeAll(async () => {
  env = await startApiEnv('agenda')
  org = await env.agency()
  people.owner = await env.person(org.id, 'owner')
  people.editor = await env.person(org.id, 'member')
  people.viewer = await env.person(org.id, 'member')
  ;({ forno, gino, archived, igForno, fbForno, igGino } = await seed(
    env.tdb.runtimeUrl,
    async (s) => {
      const f = await s.workspace(org.id, { name: 'Forno Luce' })
      const g = await s.workspace(org.id, { name: 'Pizzeria Da Gino' })
      const a = await s.workspace(org.id, { name: 'Vecchio cliente', archived: true })
      // the Editor and the Viewer see Forno Luce only (and the archived one)
      for (const w of [f, a]) {
        await s.workspaceMember(org.id, w, people.editor.userId, 'editor')
        await s.workspaceMember(org.id, w, people.viewer.userId, 'viewer')
      }
      return {
        forno: f,
        gino: g,
        archived: a,
        igForno: await s.account(org.id, { platform: 'instagram', workspaceIds: [f] }),
        fbForno: await s.account(org.id, { platform: 'facebook', workspaceIds: [f] }),
        igGino: await s.account(org.id, { platform: 'instagram', workspaceIds: [g] }),
      }
    },
  ))
  // every connection works, every account checked: no issue but those a test makes
  await env.admin.pool.query(`update account_connections set status = 'active'`)
  await env.admin.pool.query(`update social_accounts set health = 'ok'`)
  // an Owner's session needs the second factor
  await env.addPasskey(people.owner.userId)
  cookies.owner = await env.strongSignIn(people.owner)
  cookies.editor = await env.signIn(people.editor)
  cookies.viewer = await env.signIn(people.viewer)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

interface AgendaJson {
  items: {
    id: string
    workspaceId: string
    type: string
    status: string
    scheduledAt: string
    text: string
    platforms: string[]
    mediaCount: number
    thumbnail: { mediaId: string; variant: string } | null
  }[]
}

describe('agenda', () => {
  // a period of its own, far from the other tests' posts
  const from = at(24 * 100)
  const period = (to = 48) =>
    `from=${from.toISOString()}&to=${new Date(from.getTime() + to * HOUR).toISOString()}`
  let first: string, second: string, other: string, image: string

  beforeAll(async () => {
    image = await photo(forno)
    const inside = (h: number) => new Date(from.getTime() + h * HOUR)
    second = await post(forno, {
      when: inside(20),
      caption: '  Dietro il banco:\n\ncome nasce la sfoglia ',
      type: 'reel',
      accounts: [igForno],
    })
    first = await post(forno, {
      when: inside(2),
      type: 'carousel',
      accounts: [igForno, fbForno],
      media: [image],
    })
    other = await post(gino, { when: inside(10), accounts: [igGino] })
    // not in the agenda: a draft and a cancelled post in the period, a post after it, and the
    // scheduled post of an archived client
    await post(forno, { status: 'draft', when: inside(3) })
    await post(forno, { status: 'cancelled', when: inside(4) })
    await post(forno, { when: inside(60) })
    await post(archived, { when: inside(5) })
  })

  test('the posts that go out in the period, by time, with what a row shows', async () => {
    const { items } = await get<AgendaJson>('owner', `/agenda?${period()}`)
    expect(items.map((p) => p.id)).toEqual([first, other, second])
    expect(items[0]).toMatchObject({
      workspaceId: forno,
      type: 'carousel',
      status: 'scheduled',
      text: 'Il pane di oggi',
      platforms: ['instagram', 'facebook'],
      mediaCount: 1,
      thumbnail: { mediaId: image, variant: 'thumbnail' },
    })
    expect(items[2]).toMatchObject({
      text: 'Dietro il banco: come nasce la sfoglia',
      platforms: ['instagram'],
      thumbnail: null,
    })
  })

  test('one client, as the selector asks', async () => {
    const { items } = await get<AgendaJson>('owner', `/agenda?${period()}&workspaceId=${gino}`)
    expect(items.map((p) => p.id)).toEqual([other])
  })

  test('an Editor of one client neither sees nor reaches the others', async () => {
    const { items } = await get<AgendaJson>('editor', `/agenda?${period()}`)
    expect(items.map((p) => p.id)).toEqual([first, second])
    expect(await status('editor', `/agenda?${period()}&workspaceId=${gino}`)).toEqual({
      status: 404,
      code: 'NOT_FOUND',
    })
    // an archived client is not in the agenda, even when asked
    expect((await status('owner', `/agenda?${period()}&workspaceId=${archived}`)).status).toBe(404)
  })

  test('the Viewer sees the posts without thumbnails (D-72)', async () => {
    const { items } = await get<AgendaJson>('viewer', `/agenda?${period()}`)
    expect(items.map((p) => [p.id, p.thumbnail])).toEqual([
      [first, null],
      [second, null],
    ])
  })

  test('a period reversed or longer than six weeks is refused', async () => {
    const back = `from=${from.toISOString()}&to=${new Date(from.getTime() - HOUR).toISOString()}`
    expect(await status('owner', `/agenda?${back}`)).toEqual({ status: 422, code: 'VALIDATION' })
    expect(await status('owner', `/agenda?${period(42 * 24 + 1)}`)).toEqual({
      status: 422,
      code: 'VALIDATION',
    })
  })
})

describe('drafts to finish', () => {
  test('the latest changed first, with what each lacks, and how many there are', async () => {
    const before = await get<{ total: number }>('editor', '/agenda/drafts')
    const image = await photo(forno)
    const ready = await post(forno, {
      status: 'draft',
      when: null,
      accounts: [igForno],
      media: [image],
      changed: at(1),
    })
    // changed after every other draft of the file
    const empty = await post(forno, { status: 'draft', when: null, caption: '', changed: at(2) })
    const hidden = await post(gino, { status: 'draft', when: null, changed: at(3) })
    const owner = await get<{
      items: { id: string; missing: string[]; thumbnail: unknown }[]
      total: number
    }>('owner', '/agenda/drafts?limit=3')
    expect(owner.items.map((d) => d.id)).toEqual([hidden, empty, ready])
    const editor = await get<typeof owner>('editor', '/agenda/drafts?limit=2')
    expect(editor.items).toEqual([
      expect.objectContaining({ id: empty, missing: ['media', 'text', 'accounts'] }),
      expect.objectContaining({
        id: ready,
        missing: [],
        thumbnail: { mediaId: image, variant: 'thumbnail' },
      }),
    ])
    // Pizzeria Da Gino's draft is not counted for who does not see it
    expect(editor.total).toBe(before.total + 2)
    expect(owner.total).toBeGreaterThan(editor.total)
  })
})

interface IssuesJson {
  items: (
    | {
        kind: 'profile'
        workspaceId: string
        name: string
        platform: string
        link: string
        scheduled: number
      }
    | { kind: 'media'; workspaceId: string; mediaId: string; name: string; retryable: boolean }
  )[]
}

describe('issues', () => {
  let timeout: string, refused: string, lost: string, inGino: string

  beforeAll(async () => {
    timeout = await failed(forno, 'timeout')
    refused = await failed(forno, 'unreadable')
    lost = await failed(forno, 'processing_failed', false)
    inGino = await failed(gino, 'timeout')
    // Forno Luce's Page must be connected again; two posts go to it from now, one went before
    await env.admin.pool.query(
      `update account_connections set status = 'revoked'
        where id = (select connection_id from social_accounts where id = $1)`,
      [fbForno],
    )
    await post(forno, { accounts: [fbForno] })
    await post(forno, { accounts: [igForno, fbForno] })
    await post(forno, { accounts: [fbForno], when: at(-30) })
  })

  afterAll(async () => {
    await env.admin.pool.query(`update account_connections set status = 'active'`)
  })

  test('the profiles to connect again, then the files not prepared', async () => {
    const { items } = await get<IssuesJson>('owner', '/agenda/issues')
    // the two posts above, and the carousel of the agenda's tests
    const { rows } = await env.admin.pool.query<{ n: number }>(
      `select count(distinct p.id)::int as n from posts p join post_targets t on t.post_id = p.id
        where t.account_id = $1 and p.status = 'scheduled' and p.scheduled_at >= now()`,
      [fbForno],
    )
    expect(items[0]).toEqual({
      kind: 'profile',
      workspaceId: forno,
      profileKey: expect.any(String) as string,
      name: 'Forno',
      platform: 'facebook',
      link: 'reconnect',
      scheduled: rows[0]?.n,
    })
    const files = items.flatMap((i) => (i.kind === 'media' ? [[i.mediaId, i.retryable]] : []))
    expect(files).toEqual(
      expect.arrayContaining([
        [timeout, true],
        [refused, false],
        [lost, false],
        [inGino, true],
      ]),
    )
  })

  test('an Editor sees the issues of their clients only, a Viewer no file', async () => {
    const editor = await get<IssuesJson>('editor', '/agenda/issues')
    expect(editor.items.every((i) => i.workspaceId === forno)).toBe(true)
    expect(editor.items.some((i) => i.kind === 'media' && i.mediaId === timeout)).toBe(true)
    const viewer = await get<IssuesJson>('viewer', '/agenda/issues')
    expect(viewer.items.map((i) => i.kind)).toEqual(['profile'])
    const gino_ = await get<IssuesJson>('owner', `/agenda/issues?workspaceId=${gino}`)
    expect(gino_.items).toEqual([expect.objectContaining({ kind: 'media', mediaId: inGino })])
  })
})

describe('clients', () => {
  test('per client: posts from now, the next one, the latest change; hidden ones left out', async () => {
    const owner = await get<{
      items: { workspaceId: string; scheduled: number; nextAt: string | null }[]
    }>('owner', '/agenda/clients')
    const ids = owner.items.map((c) => c.workspaceId)
    expect(ids).toEqual(expect.arrayContaining([forno, gino]))
    expect(ids).not.toContain(archived)
    const fornoRow = owner.items.find((c) => c.workspaceId === forno)
    const { rows } = await env.admin.pool.query<{ n: number; next: Date }>(
      `select count(*)::int as n, min(scheduled_at) as next from posts
        where workspace_id = $1 and status = 'scheduled' and scheduled_at >= now()`,
      [forno],
    )
    expect(fornoRow).toMatchObject({
      scheduled: rows[0]?.n,
      nextAt: rows[0]?.next.toISOString(),
    })
    const editor = await get<typeof owner>('editor', '/agenda/clients')
    expect(editor.items.map((c) => c.workspaceId)).toEqual([forno])
    // counted from the panel's moment: after every post, none is left to go out
    const later = await get<typeof owner>(
      'owner',
      `/agenda/clients?from=${at(24 * 400).toISOString()}`,
    )
    expect(later.items.find((c) => c.workspaceId === forno)).toMatchObject({
      scheduled: 0,
      nextAt: null,
    })
  })
})
