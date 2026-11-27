import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { META_MOCK } from '@app/meta-mock'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, ErrorJson, Person } from './identity-env.js'

// Instagram's grid over HTTP (plan 09 Task 12, P4): the scheduled posts of the next 30 days
// above the last ones out, read from the fake Graph API with one call per opening; the pictures
// through the server, from the sealed token the opening gave, only for that account and only
// from the allowed hosts; the swap of two scheduled times, both or neither; and nothing of
// another client or agency.

let env: ApiEnv
let org: { id: string; slug: string }
let other: { id: string; slug: string }
const people = {} as Record<
  'owner' | 'manager' | 'editor' | 'viewer' | 'ofGino' | 'ofOther',
  Person
>
const cookies = {} as Record<keyof typeof people, string>
let forno: string, gino: string, ofOther: string
/** the client's Instagram (`caffe.centrale` of the mock, 9 posts out) and another one */
let ig: string, igGino: string, igOther: string

type Who = keyof typeof people

const READY_VIDEO = {
  kind: 'video',
  format: 'mp4',
  sizeBytes: 40_000_000,
  width: 1080,
  height: 1920,
  durationMs: 20_000,
  fps: 30,
  videoCodec: 'h264',
  audioCodec: 'aac',
  faststart: true,
}

async function call(who: Who, method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) {
  const r = await env.call(method, path, body, { cookie: cookies[who] })
  const bytes = Buffer.from(await r.arrayBuffer())
  const text = bytes.toString('utf8')
  const json = r.headers.get('content-type')?.includes('json')
    ? (JSON.parse(text) as unknown)
    : null
  return { status: r.status, text, json, bytes, headers: r.headers }
}

async function ok<T>(answer: ReturnType<typeof call>): Promise<T> {
  const r = await answer
  expect(r.status, r.text).toBe(200)
  return r.json as T
}

async function failsWith(answer: ReturnType<typeof call>, status: number, code?: string) {
  const r = await answer
  expect(r.status, r.text).toBe(status)
  if (code) expect((r.json as ErrorJson).error.code).toBe(code)
}

const api = (path: string, slug = org.slug) => `/api/v1/orgs/${slug}${path}`
const gridOf = (accountId: string, workspaceId: string, slug = org.slug) =>
  api(`/workspaces/${workspaceId}/calendar/grid/${accountId}`, slug)
const thumbnailOf = (accountId: string, picture: string, workspaceId: string, slug = org.slug) =>
  api(`/workspaces/${workspaceId}/calendar/grid/${accountId}/pictures/${picture}`, slug)

/** A token of the server's key the opening never gave: of `accountId`, until `expiresAt`. */
const pictureToken = (
  organizationId: string,
  accountId: string,
  opts: { expiresAt?: Date; url?: string } = {},
) =>
  env.gridPictures.seal(
    { organizationId, accountId },
    {
      mediaId: '1790000000000001',
      pictureUrl: opts.url ?? `${env.meta.url}/pictures/post-1.jpg?oh=0a0a&oe=6B00`,
    },
    opts.expiresAt ?? new Date(Date.now() + 300_000),
  )

/** The tokens of the pictures of the account's grid, as the panel gets them. */
async function picturesOf(who: Who, accountId: string, workspaceId: string): Promise<string[]> {
  const grid = await ok<GridJson>(call(who, 'GET', gridOf(accountId, workspaceId)))
  if (!grid.published.ok) throw new Error('the posts out were not read')
  return grid.published.items.map((m) => m.picture ?? '')
}

/** A day and time `days` from now, in the agency's zone. */
function inDays(days: number, time = '10:00') {
  const at = new Date(Date.now() + days * 86_400_000)
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(at)
  return { localDate, localTime: time }
}

async function video(workspaceId = forno): Promise<string> {
  const id = await seed(env.tdb.runtimeUrl, (s) =>
    s.media(org.id, workspaceId, { uploadedBy: people.manager.userId }),
  )
  await env.admin.pool.query(
    'update media set analysis = $2, checks = $3, sha256 = $4 where id = $1',
    [
      id,
      JSON.stringify(READY_VIDEO),
      JSON.stringify({ fixes: [], warnings: [] }),
      randomBytes(32).toString('hex'),
    ],
  )
  return id
}

interface PostJson {
  id: string
  version: number
  scheduledAt: string | null
}

/** A reel on the client's Instagram, `days` from now; scheduled unless `draft`. */
async function reel(
  days: number,
  opts: { draft?: boolean; type?: 'reel' | 'story'; shareToFeed?: boolean; time?: string } = {},
): Promise<PostJson> {
  const posts = api(`/workspaces/${forno}/posts`)
  const draft = await ok<PostJson>(
    call('manager', 'POST', posts, {
      type: opts.type ?? 'reel',
      mediaIds: [await video()],
      caption: { common: `Il pane di oggi ${randomUUID().slice(0, 6)}` },
      destinations: [{ accountId: ig }],
      when: inDays(days, opts.time),
      ...(opts.shareToFeed === undefined ? {} : { shareToFeed: opts.shareToFeed }),
    }),
  )
  if (opts.draft) return draft
  return ok<PostJson>(
    call('manager', 'POST', `${posts}/${draft.id}/schedule`, { version: draft.version }),
  )
}

const postNow = async (id: string) =>
  ok<PostJson>(call('manager', 'GET', api(`/workspaces/${forno}/posts/${id}`)))

/** The system user of the agency, connected through the panel to the fake Graph API. */
async function connect(slug: string, cookie: string): Promise<string> {
  await env.admin.pool.query('update sessions set reauthenticated_at = now()')
  for (const [method, path, body] of [
    ['PUT', 'integrations/meta', { appId: META_MOCK.app.id, appSecret: META_MOCK.app.secret }],
    ['POST', 'connections/system-user', { token: META_MOCK.tokens.systemUser }],
  ] as const) {
    const r = await env.call(method, `/api/v1/orgs/${slug}/${path}`, body, { cookie })
    const text = await r.text()
    expect(r.status, text).toBe(200)
    if (path === 'connections/system-user')
      return (JSON.parse(text) as { connection: { id: string } }).connection.id
  }
  throw new Error('not connected')
}

/** An Instagram account of the connection, put into the client, checked and healthy. */
async function instagram(
  organizationId: string,
  connectionId: string,
  externalId: string,
  workspaceId: string,
): Promise<string> {
  const id = randomUUID()
  await env.admin.pool.query(
    `insert into social_accounts (id, organization_id, platform, external_id, name, username,
                                  connection_id, health)
     values ($1, $2, 'instagram', $3, 'Caffè Centrale', 'caffe.centrale', $4, 'ok')`,
    [id, organizationId, externalId, connectionId],
  )
  await env.admin.pool.query(
    'insert into workspace_accounts (organization_id, workspace_id, account_id) values ($1, $2, $3)',
    [organizationId, workspaceId, id],
  )
  return id
}

beforeAll(async () => {
  env = await startApiEnv('grid')
  org = await env.agency()
  other = await env.agency()
  people.owner = await env.person(org.id, 'owner')
  for (const key of ['manager', 'editor', 'viewer', 'ofGino'] as const)
    people[key] = await env.person(org.id, 'member')
  people.ofOther = await env.person(other.id, 'owner')
  ;({ forno, gino, ofOther } = await seed(env.tdb.runtimeUrl, async (s) => {
    const f = await s.workspace(org.id, { name: 'Caffè Centrale' })
    const g = await s.workspace(org.id, { name: 'Pizzeria Da Gino' })
    const o = await s.workspace(other.id, { name: 'Un cliente di un’altra agenzia' })
    await s.workspaceMember(org.id, f, people.manager.userId, 'manager')
    await s.workspaceMember(org.id, f, people.editor.userId, 'editor')
    await s.workspaceMember(org.id, f, people.viewer.userId, 'viewer')
    await s.workspaceMember(org.id, g, people.ofGino.userId, 'manager')
    return { forno: f, gino: g, ofOther: o }
  }))
  await env.addPasskey(people.owner.userId)
  for (const key of Object.keys(people) as Who[])
    cookies[key] =
      key === 'owner' || key === 'ofOther'
        ? await env.strongSignIn(people[key])
        : await env.signIn(people[key])
  const connection = await connect(org.slug, cookies.owner)
  ig = await instagram(org.id, connection, META_MOCK.instagram.shared, forno)
  igGino = await instagram(org.id, connection, META_MOCK.instagram.agencyOnly, gino)
  const otherConnection = await connect(other.slug, cookies.ofOther)
  igOther = await instagram(other.id, otherConnection, META_MOCK.instagram.shared, ofOther)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

interface GridJson {
  account: { id: string; username: string | null }
  scheduled: { id: string; type: string; scheduledAt: string; version: number }[]
  published:
    | {
        ok: true
        items: { id: string; kind: string; reel: boolean; picture: string | null }[]
      }
    | { ok: false; reason: string }
}

describe('the grid', () => {
  test('the scheduled posts of the next 30 days, the furthest first, above the 9 out', async () => {
    const near = await reel(3)
    const far = await reel(12)
    // not in the grid: a draft, a story, a reel kept among the reels, one beyond 30 days
    await reel(5, { draft: true })
    await reel(6, { type: 'story' })
    await reel(7, { shareToFeed: false })
    await reel(40)
    const grid = await ok<GridJson>(call('viewer', 'GET', gridOf(ig, forno)))
    expect(grid.account).toMatchObject({ id: ig, username: 'caffe.centrale' })
    expect(grid.scheduled.map((p) => p.id)).toEqual([far.id, near.id])
    expect(grid.published.ok).toBe(true)
    if (!grid.published.ok) return
    expect(grid.published.items).toHaveLength(9)
    expect(grid.published.items.every((m) => typeof m.picture === 'string')).toBe(true)
    expect(grid.published.items.filter((m) => m.reel).map((m) => m.kind)).toEqual([
      'video',
      'video',
    ])
    // Meta's addresses never leave the server
    const text = JSON.stringify(grid)
    expect(text).not.toContain('/pictures/')
    expect(text).not.toContain(env.meta.url)
  })

  test('a post already on its way, its time gone, stays among the scheduled ones', async () => {
    const late = await reel(2)
    // the worker took it ten minutes ago and is trying again (a transient error)
    await env.admin.pool.query(
      "update posts set scheduled_at = now() - interval '10 minutes' where id = $1",
      [late.id],
    )
    await env.admin.pool.query("update post_targets set status = 'retrying' where post_id = $1", [
      late.id,
    ])
    const grid = await ok<GridJson>(call('viewer', 'GET', gridOf(ig, forno)))
    expect(grid.scheduled.map((p) => p.id)).toContain(late.id)
  })

  test('an opening is one call to Meta; its pictures call Meta no more', async () => {
    const before = env.meta.calls().length
    const pictures = await picturesOf('editor', ig, forno)
    const opening = env.meta.calls().slice(before)
    expect(opening.map((c) => c.path)).toEqual([expect.stringMatching(/\/media$/)])
    const after = env.meta.calls().length
    for (const picture of pictures) {
      const r = await call('viewer', 'GET', thumbnailOf(ig, picture, forno))
      expect(r.status, r.text).toBe(200)
      expect(r.headers.get('content-type')).toBe('image/jpeg')
      expect(r.headers.get('cache-control')).toBe('private, max-age=300')
      expect([...r.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
    }
    // only the downloads from the picture hosts, one each
    const downloads = env.meta.calls().slice(after)
    expect(downloads.map((c) => c.path.startsWith('/pictures/'))).toEqual(pictures.map(() => true))
  })

  test('a token expired, changed, of another account or of another agency is not found', async () => {
    const [picture = ''] = await picturesOf('owner', ig, forno)
    const before = env.meta.calls().length
    // the token of the client's Instagram on another account the same connection sees
    await failsWith(call('owner', 'GET', thumbnailOf(igGino, picture, gino)), 404)
    // a byte changed: its last character, in its last bits
    const last = picture.at(-1) === 'A' ? 'B' : 'A'
    await failsWith(call('owner', 'GET', thumbnailOf(ig, picture.slice(0, -1) + last, forno)), 404)
    // made with the server's key, five minutes ago
    const expired = pictureToken(org.id, ig, { expiresAt: new Date(Date.now() - 1000) })
    await failsWith(call('owner', 'GET', thumbnailOf(ig, expired, forno)), 404)
    // another agency's account, or this account under another agency
    await failsWith(
      call('owner', 'GET', thumbnailOf(ig, pictureToken(other.id, igOther), forno)),
      404,
    )
    await failsWith(call('owner', 'GET', thumbnailOf(ig, pictureToken(other.id, ig), forno)), 404)
    // a token the key accepts, of this agency but naming another agency's account: the account
    // is not among this agency's, so nothing is downloaded
    await failsWith(
      call('owner', 'GET', thumbnailOf(igOther, pictureToken(org.id, igOther), forno)),
      404,
    )
    // the same account's, from the server's key: it opens
    const r = await call('owner', 'GET', thumbnailOf(ig, pictureToken(org.id, ig), forno))
    expect(r.status, r.text).toBe(200)
    // nothing above asked Meta: only the one good download
    expect(
      env.meta
        .calls()
        .slice(before)
        .map((c) => c.path),
    ).toEqual(['/pictures/post-1.jpg'])
    // not a token at all: refused by the address, before anything is read
    for (const bad of ['1790000000000001', '..%2Fme', 'a'.repeat(4097)])
      await failsWith(call('owner', 'GET', thumbnailOf(ig, bad, forno)), 422, 'VALIDATION')
  })

  test('a picture on another host is never downloaded', async () => {
    const grid = await ok<GridJson>(call('owner', 'GET', gridOf(ig, forno)))
    if (!grid.published.ok) throw new Error('the posts out were not read')
    const media = grid.published.items[1]?.id ?? ''
    env.meta.scenario('media_url_changed', {
      id: media,
      url: 'https://example.com/pictures/post-2.jpg',
    })
    try {
      const moved = await ok<GridJson>(call('owner', 'GET', gridOf(ig, forno)))
      if (!moved.published.ok) throw new Error('the posts out were not read')
      const picture = moved.published.items.find((m) => m.id === media)?.picture ?? ''
      const before = env.meta.calls().length
      await failsWith(call('owner', 'GET', thumbnailOf(ig, picture, forno)), 404)
      // refused before any request: nothing reached anywhere
      expect(env.meta.calls().slice(before)).toEqual([])
    } finally {
      env.meta.scenario('default')
    }
  })

  test('a token Meta no longer takes: the scheduled posts, and a word on the ones out', async () => {
    env.meta.scenario('token_expired', { token: META_MOCK.tokens.systemUser })
    try {
      const grid = await ok<GridJson>(call('manager', 'GET', gridOf(ig, forno)))
      expect(grid.scheduled.length).toBeGreaterThan(0)
      expect(grid.published).toEqual({ ok: false, reason: 'rejected' })
    } finally {
      env.meta.scenario('default')
    }
  })

  test('a connection that does not work: no call to Meta, the scheduled posts all the same', async () => {
    const [picture = ''] = await picturesOf('manager', ig, forno)
    await env.admin.pool.query(
      "update account_connections set status = 'expired' where organization_id = $1",
      [org.id],
    )
    try {
      const before = env.meta.calls().length
      const grid = await ok<GridJson>(call('manager', 'GET', gridOf(ig, forno)))
      expect(grid.published).toEqual({ ok: false, reason: 'unreachable' })
      // a token given before is no longer opened either
      await failsWith(call('manager', 'GET', thumbnailOf(ig, picture, forno)), 404)
      expect(env.meta.calls()).toHaveLength(before)
    } finally {
      await env.admin.pool.query(
        "update account_connections set status = 'active' where organization_id = $1",
        [org.id],
      )
    }
  })

  test('the usage Meta says is kept on the account, for the slowing down (D-111)', async () => {
    env.meta.scenario('usage_high', { app: 91, business: 87 })
    try {
      await ok<GridJson>(call('manager', 'GET', gridOf(ig, forno)))
    } finally {
      env.meta.scenario('default')
    }
    const { rows } = await env.admin.pool.query<{ account: number; app: number }>(
      `select usage_account_percent as account, usage_app_percent as app
       from social_accounts where id = $1`,
      [ig],
    )
    expect(rows[0]).toEqual({ account: 87, app: 91 })
  })
})

describe('who sees which grid', () => {
  test('only the clients one sees, and only their Instagram accounts', async () => {
    // a client the person does not see, an account of another client, another agency's
    await failsWith(call('editor', 'GET', gridOf(igGino, gino)), 404)
    await failsWith(call('ofGino', 'GET', gridOf(ig, forno)), 404)
    await failsWith(call('owner', 'GET', gridOf(igGino, forno)), 404)
    await failsWith(call('owner', 'GET', gridOf(igOther, forno)), 404)
    await failsWith(call('owner', 'GET', gridOf(ig, ofOther)), 404)
    await failsWith(call('ofOther', 'GET', gridOf(ig, forno, other.slug)), 404)
    const ofIg = pictureToken(org.id, ig)
    await failsWith(call('ofGino', 'GET', thumbnailOf(ig, ofIg, forno)), 404)
    await failsWith(call('ofOther', 'GET', thumbnailOf(ig, ofIg, forno)), 404)
    await failsWith(call('ofOther', 'GET', thumbnailOf(ig, ofIg, forno, other.slug)), 404)
    await failsWith(
      call('editor', 'GET', thumbnailOf(igGino, pictureToken(org.id, igGino), gino)),
      404,
    )
    // the account of another client, through the client one sees
    await failsWith(
      call('owner', 'GET', thumbnailOf(igGino, pictureToken(org.id, igGino), forno)),
      404,
    )
  })
})

describe('swapping two scheduled posts', () => {
  const swap = (who: Who, a: PostJson, b: PostJson, accountId = ig) =>
    call(who, 'POST', api(`/workspaces/${forno}/calendar/grid/swap`), {
      accountId,
      a: { postId: a.id, version: a.version },
      b: { postId: b.id, version: b.version },
    })

  test('the two times swap, each post a version up; the same swap again puts them back', async () => {
    const a = await reel(4, { time: '09:30' })
    const b = await reel(9, { time: '18:15' })
    const done = await ok<{ posts: PostJson[] }>(swap('manager', a, b))
    expect(done.posts).toEqual([
      { id: a.id, version: a.version + 1, scheduledAt: b.scheduledAt },
      { id: b.id, version: b.version + 1, scheduledAt: a.scheduledAt },
    ])
    expect((await postNow(a.id)).scheduledAt).toBe(b.scheduledAt)
    expect((await postNow(b.id)).scheduledAt).toBe(a.scheduledAt)
    // «Annulla»: the same swap, with the versions the first one gave
    const [a2, b2] = done.posts as [PostJson, PostJson]
    await ok(swap('manager', a2, b2))
    expect((await postNow(a.id)).scheduledAt).toBe(a.scheduledAt)
    expect((await postNow(b.id)).scheduledAt).toBe(b.scheduledAt)
  })

  test('one of the two changed meanwhile: 409, and neither moves', async () => {
    const a = await reel(5, { time: '11:00' })
    const b = await reel(8, { time: '12:00' })
    const moved = await ok<PostJson>(
      call('manager', 'PATCH', api(`/workspaces/${forno}/posts/${b.id}`), {
        version: b.version,
        when: inDays(10, '12:00'),
      }),
    )
    await failsWith(swap('manager', a, b), 409, 'CONFLICT')
    expect((await postNow(a.id)).scheduledAt).toBe(a.scheduledAt)
    expect((await postNow(b.id)).scheduledAt).toBe(moved.scheduledAt)
  })

  test('a check that fails for one leaves both where they were', async () => {
    const a = await reel(6, { time: '08:00' })
    const b = await reel(11, { time: '08:00' })
    // the account stops working after b was scheduled: its checks no longer pass
    await env.admin.pool.query("update social_accounts set health = 'error' where id = $1", [ig])
    try {
      await failsWith(swap('manager', a, b), 422, 'VALIDATION')
    } finally {
      await env.admin.pool.query("update social_accounts set health = 'ok' where id = $1", [ig])
    }
    expect((await postNow(a.id)).scheduledAt).toBe(a.scheduledAt)
    expect((await postNow(b.id)).scheduledAt).toBe(b.scheduledAt)
  })

  test('the Editor and the Viewer do not swap; nor anyone outside the client', async () => {
    const a = await reel(13)
    const b = await reel(14)
    await failsWith(swap('editor', a, b), 403)
    await failsWith(swap('viewer', a, b), 403)
    await failsWith(swap('ofGino', a, b), 404)
    // an account of another client, and a post that is not in this account's grid
    await failsWith(swap('manager', a, b, igGino), 404)
    await failsWith(swap('manager', a, a), 422, 'VALIDATION')
    const draft = await reel(15, { draft: true })
    await failsWith(swap('manager', a, draft), 409)
    // a story and a reel kept among the reels are not in the grid either
    const story = await reel(16, { type: 'story' })
    await failsWith(swap('manager', a, story), 409, 'CONFLICT')
    const hidden = await reel(17, { shareToFeed: false })
    await failsWith(swap('manager', hidden, a), 409, 'CONFLICT')
    expect((await postNow(a.id)).scheduledAt).toBe(a.scheduledAt)
  })
})

describe('the calls to Meta of one account', () => {
  const accountReads = async (accountId: string) => {
    const { rows } = await env.admin.pool.query<{ count: number }>(
      `select count from rate_limit_counters
        where key = $1 and started_at > now() - interval '1 minute'`,
      [`hits:account:grid-account-reads:${org.id}:${accountId}`],
    )
    return rows[0]?.count ?? 0
  }

  test('only a call to Meta counts on the account: not an account one does not see', async () => {
    const before = await accountReads(igGino)
    // the account of a client the Editor does not see, through the client the Editor sees
    for (let i = 0; i < 3; i++) await failsWith(call('editor', 'GET', gridOf(igGino, forno)), 404)
    await failsWith(call('editor', 'GET', gridOf(igGino, gino)), 404)
    expect(await accountReads(igGino)).toBe(before)
    // an opening that reaches Meta counts once
    await ok(call('ofGino', 'GET', gridOf(igGino, gino)))
    expect(await accountReads(igGino)).toBe(before + 1)
  })

  // last: it uses up the account's openings of this minute
  test('everyone together opens an account’s grid at most 60 times a minute', async () => {
    const statuses: number[] = []
    // three people who see the client, each well within their own 30
    for (let i = 0; i < 22; i++)
      for (const who of ['owner', 'editor', 'viewer'] as const)
        statuses.push((await call(who, 'GET', gridOf(ig, forno))).status)
    expect(statuses).toContain(429)
    expect(statuses.indexOf(429)).toBeLessThanOrEqual(60)
  })
})
