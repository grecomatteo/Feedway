import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createLocalDiskStorage } from '@app/infrastructure'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

// The files of a workspace in the panel (plan 04 Task 8): the library is for Editor and above,
// a copy is served whole or by byte ranges for the video player, a deletion leaves the library
// at once. Other agencies and every role, route by route: the isolation battery and the matrix.

let env: ApiEnv
let org: { id: string; slug: string }
let editor: Person, viewer: Person
const cookies = { editor: '', viewer: '' }
let w1: string, w2: string

/** 1000 bytes that tell their position, so any range is checked byte by byte. */
const PREVIEW = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))

/** A video of the workspace, ready, with its preview (and, if asked, a thumbnail) stored. */
async function video(workspaceId: string, opts: { thumbnail?: boolean } = {}) {
  const id = await seed(env.tdb.runtimeUrl, (s) =>
    s.media(org.id, workspaceId, { uploadedBy: editor.userId, sizeBytes: 5000 }),
  )
  const storage = createLocalDiskStorage({ root: env.web.mediaRoot })
  const files = [
    { purpose: 'preview', bytes: PREVIEW, mime: 'video/mp4', ext: 'mp4' },
    ...(opts.thumbnail
      ? [{ purpose: 'thumbnail', bytes: randomBytes(10), mime: 'image/jpeg', ext: 'jpg' }]
      : []),
  ]
  for (const f of files) {
    const key = `org/${org.id}/media/${id}/${f.purpose}.${f.ext}`
    await storage.put(key, f.bytes, { contentType: f.mime })
    await env.admin.pool.query(
      `insert into media_variants (id, organization_id, media_id, purpose, storage_key, mime,
                                   size_bytes, public_token)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        org.id,
        id,
        f.purpose,
        key,
        f.mime,
        f.bytes.length,
        // a public token never leaves through the panel's API
        f.purpose === 'thumbnail' ? randomBytes(24).toString('base64url') : null,
      ],
    )
  }
  return id
}

const base = (workspaceId: string) => `/api/v1/orgs/${org.slug}/workspaces/${workspaceId}/media`
const fileOf = (workspaceId: string, mediaId: string, variant = 'preview') =>
  `${base(workspaceId)}/${mediaId}/file/${variant}`
const get = (path: string, cookie: string, headers: Record<string, string> = {}) =>
  env.call('GET', path, undefined, { cookie, headers })

beforeAll(async () => {
  env = await startApiEnv('media')
  org = await env.agency()
  editor = await env.person(org.id, 'member')
  viewer = await env.person(org.id, 'member')
  ;({ w1, w2 } = await seed(env.tdb.runtimeUrl, async (s) => {
    const first = await s.workspace(org.id)
    const second = await s.workspace(org.id)
    await s.workspaceMember(org.id, first, editor.userId, 'editor')
    await s.workspaceMember(org.id, second, editor.userId, 'editor')
    await s.workspaceMember(org.id, first, viewer.userId, 'viewer')
    return { w1: first, w2: second }
  }))
  cookies.editor = await env.signIn(editor)
  cookies.viewer = await env.signIn(viewer)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

test('the library lists its files, newest first, with the space they take, by pages', async () => {
  const first = await video(w2)
  const second = await video(w2, { thumbnail: true })
  const r = await get(`${base(w2)}?limit=1`, cookies.editor)
  const text = await r.text()
  expect(r.status, text).toBe(200)
  const page = JSON.parse(text) as {
    items: { id: string; variants: { purpose: string }[] }[]
    next: string | null
    usedBytes: number
  }
  expect(page.items.map((m) => m.id)).toEqual([second])
  expect(page.items[0]?.variants.map((v) => v.purpose)).toEqual(['preview', 'thumbnail'])
  // originals, copies and thumbnails: 5000 + 1000 for each, and the thumbnail
  expect(page.usedBytes).toBe(5000 + 1000 + 5000 + 1000 + 10)
  expect(page.next).toBe(second)
  // never a key of the storage, nor a public token
  expect(text).not.toMatch(/org\/|storage|public|token/i)
  const rest = (await (await get(`${base(w2)}?before=${second}`, cookies.editor)).json()) as {
    items: { id: string }[]
    next: string | null
  }
  expect(rest).toMatchObject({ items: [{ id: first }], next: null })
})

test('a copy is served whole, with Accept-Ranges, and only in the panel', async () => {
  const id = await video(w1)
  const r = await get(fileOf(w1, id), cookies.editor)
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toBe('video/mp4')
  expect(r.headers.get('accept-ranges')).toBe('bytes')
  expect(r.headers.get('cache-control')).toBe('private, max-age=3600')
  expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  expect(Buffer.from(await r.arrayBuffer())).toEqual(PREVIEW)
})

test('Range gives 206 with exactly the bytes asked', async () => {
  const id = await video(w1)
  const cases = [
    { range: 'bytes=100-199', start: 100, end: 199 },
    { range: 'bytes=990-', start: 990, end: 999 },
    { range: 'bytes=-10', start: 990, end: 999 },
    // an end past the file stops at its last byte
    { range: 'bytes=500-5000', start: 500, end: 999 },
  ]
  for (const c of cases) {
    const r = await get(fileOf(w1, id), cookies.editor, { range: c.range })
    expect(r.status, c.range).toBe(206)
    expect(r.headers.get('content-range'), c.range).toBe(
      `bytes ${String(c.start)}-${String(c.end)}/1000`,
    )
    expect(r.headers.get('content-length'), c.range).toBe(String(c.end - c.start + 1))
    expect(Buffer.from(await r.arrayBuffer()), c.range).toEqual(
      PREVIEW.subarray(c.start, c.end + 1),
    )
  }
})

test('a range past the end is 416; a range not understood gives the whole file', async () => {
  const id = await video(w1)
  const past = await get(fileOf(w1, id), cookies.editor, { range: 'bytes=1000-' })
  expect(past.status).toBe(416)
  expect(past.headers.get('content-range')).toBe('bytes */1000')
  expect((await past.arrayBuffer()).byteLength).toBe(0)
  const several = await get(fileOf(w1, id), cookies.editor, { range: 'bytes=0-1,5-9' })
  expect(several.status).toBe(200)
  expect(Buffer.from(await several.arrayBuffer())).toEqual(PREVIEW)
})

test('a copy not made yet, the original and an unknown variant are not found', async () => {
  const id = await video(w1)
  for (const variant of ['reel', 'original', 'qualsiasi']) {
    const r = await get(fileOf(w1, id, variant), cookies.editor)
    expect(r.status, variant).toBe(variant === 'reel' ? 404 : 422)
  }
})

test('a copy of a type the panel does not serve is not found', async () => {
  const id = await video(w1)
  await env.admin.pool.query(`update media_variants set mime = 'text/html' where media_id = $1`, [
    id,
  ])
  expect((await get(fileOf(w1, id), cookies.editor)).status).toBe(404)
})

test('for a Viewer the library does not exist', async () => {
  const id = await video(w1)
  for (const path of [base(w1), `${base(w1)}/${id}`, fileOf(w1, id)]) {
    const r = await get(path, cookies.viewer)
    expect(r.status, path).toBe(404)
  }
  const del = await env.call('DELETE', `${base(w1)}/${id}`, undefined, { cookie: cookies.viewer })
  expect(del.status).toBe(404)
  // the file is still there
  expect((await get(`${base(w1)}/${id}`, cookies.editor)).status).toBe(200)
})

test('a file of another workspace is not deleted through this one', async () => {
  const inW2 = await video(w2)
  const r = await env.call('DELETE', `${base(w1)}/${inW2}`, undefined, { cookie: cookies.editor })
  expect(r.status).toBe(404)
  expect((await get(`${base(w2)}/${inW2}`, cookies.editor)).status).toBe(200)
})

test('a deleted file leaves the library at once, and its copies are queued for removal', async () => {
  const id = await video(w1)
  const r = await env.call('DELETE', `${base(w1)}/${id}`, undefined, { cookie: cookies.editor })
  expect(r.status, await r.clone().text()).toBe(200)
  expect(await r.json()).toEqual({ deleted: true })
  for (const path of [`${base(w1)}/${id}`, fileOf(w1, id)])
    expect((await get(path, cookies.editor)).status, path).toBe(404)
  const list = (await (await get(base(w1), cookies.editor)).json()) as { items: { id: string }[] }
  expect(list.items.map((m) => m.id)).not.toContain(id)
  // twice: nothing left to delete
  const again = await env.call('DELETE', `${base(w1)}/${id}`, undefined, { cookie: cookies.editor })
  expect(again.status).toBe(404)
  const { rows } = await env.admin.pool.query<{ status: string; in_library: boolean }>(
    `select status, exists (select 1 from library_items i where i.media_id = m.id) as in_library
       from media m where id = $1`,
    [id],
  )
  expect(rows).toEqual([{ status: 'deleted', in_library: false }])
  const jobs = await env.admin.pool.query<{ data: { mediaId: string; organizationId: string } }>(
    `select data from pgboss.job where name = 'media.delete_files'`,
  )
  expect(jobs.rows.map((j) => j.data)).toContainEqual({ organizationId: org.id, mediaId: id })
})

/** A file of the workspace `failed` with this reason; `keepsOriginal`: its original stored. */
async function failedFile(workspaceId: string, code: string, keepsOriginal: boolean) {
  const id = await seed(env.tdb.runtimeUrl, (s) =>
    s.media(org.id, workspaceId, {
      uploadedBy: editor.userId,
      status: 'processing',
      ...(keepsOriginal ? {} : { storageKey: null }),
    }),
  )
  await env.admin.pool.query(
    `update media set status = 'failed', failure = $2, processing_attempts = 3 where id = $1`,
    [id, JSON.stringify({ code })],
  )
  return id
}

test('«Riprova» prepares again a file that failed with its original kept (D-39)', async () => {
  const id = await failedFile(w1, 'timeout', true)
  const r = await env.call('POST', `${base(w1)}/${id}/retry`, undefined, {
    cookie: cookies.editor,
  })
  expect(r.status, await r.clone().text()).toBe(200)
  expect(await r.json()).toMatchObject({ id, status: 'processing', failure: null })
  const { rows } = await env.admin.pool.query<{ processing_attempts: number }>(
    'select processing_attempts from media where id = $1',
    [id],
  )
  // the attempts start again: the cap is for runs that never end
  expect(rows[0]?.processing_attempts).toBe(0)
  const jobs = await env.admin.pool.query<{ data: unknown }>(
    `select data from pgboss.job where name = 'media.process'`,
  )
  expect(jobs.rows.map((j) => j.data)).toContainEqual({ organizationId: org.id, mediaId: id })
  // once: it is no longer failed
  const again = await env.call('POST', `${base(w1)}/${id}/retry`, undefined, {
    cookie: cookies.editor,
  })
  expect(again.status).toBe(409)
})

test('a file refused for good, or not failed, cannot be tried again', async () => {
  const unreadable = await failedFile(w1, 'unreadable', false)
  const ready = await video(w1)
  for (const id of [unreadable, ready]) {
    const r = await env.call('POST', `${base(w1)}/${id}/retry`, undefined, {
      cookie: cookies.editor,
    })
    expect(r.status, id).toBe(409)
  }
  // through another workspace, or for a Viewer: not there
  const inW2 = await failedFile(w2, 'timeout', true)
  expect(
    (await env.call('POST', `${base(w1)}/${inW2}/retry`, undefined, { cookie: cookies.editor }))
      .status,
  ).toBe(404)
  const own = await failedFile(w1, 'timeout', true)
  expect(
    (await env.call('POST', `${base(w1)}/${own}/retry`, undefined, { cookie: cookies.viewer }))
      .status,
  ).toBe(404)
})

test('a copy that was published is served by its id, only with its own file (plan 08 Task 10)', async () => {
  const id = await video(w1)
  const other = await video(w1)
  const storage = createLocalDiskStorage({ root: env.web.mediaRoot })
  const copyId = randomUUID()
  const key = `org/${org.id}/media/${id}/reel-abc.mp4`
  await storage.put(key, PREVIEW, { contentType: 'video/mp4' })
  await env.admin.pool.query(
    `insert into media_variants (id, organization_id, media_id, purpose, recipe, storage_key,
                                 mime, size_bytes, public_token)
     values ($1, $2, $3, 'reel', 'abc', $4, 'video/mp4', $5, $6)`,
    [copyId, org.id, id, key, PREVIEW.length, randomBytes(24).toString('base64url')],
  )
  const copy = (mediaId: string) => `${base(w1)}/${mediaId}/copies/${copyId}`
  const whole = await get(copy(id), cookies.editor)
  expect(whole.status).toBe(200)
  expect(whole.headers.get('content-type')).toBe('video/mp4')
  expect(Buffer.from(await whole.arrayBuffer())).toEqual(PREVIEW)
  const part = await get(copy(id), cookies.editor, { range: 'bytes=10-19' })
  expect(part.status).toBe(206)
  expect(Buffer.from(await part.arrayBuffer())).toEqual(PREVIEW.subarray(10, 20))
  // through another file, another workspace or by the Viewer: as if it did not exist
  expect((await get(copy(other), cookies.editor)).status).toBe(404)
  expect((await get(`${base(w2)}/${id}/copies/${copyId}`, cookies.editor)).status).toBe(404)
  expect((await get(copy(id), cookies.viewer)).status).toBe(404)
  // a copy not made yet, or thrown away
  await env.admin.pool.query("update media_variants set status = 'pending' where id = $1", [copyId])
  expect((await get(copy(id), cookies.editor)).status).toBe(404)
})
