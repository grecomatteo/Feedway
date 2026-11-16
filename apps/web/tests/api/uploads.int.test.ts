import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createLocalDiskStorage } from '@app/infrastructure'
import { seed, withScope } from '@app/infrastructure/testing'
import { errorCodeOf, startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

// The upload in pieces (plan 04 Task 9, ADR 021): pieces of 20 MiB in any order, a resume after
// a fall, the same piece twice, a piece too large or not the one sent, a fake type, `complete`
// twice, the agency's space taken by two uploads at once, and someone else's upload. Other
// agencies and every role, route by route: the isolation battery and the matrix.

const PART = 20 * 1024 * 1024

let env: ApiEnv
let org: { id: string; slug: string }
let editor: Person, colleague: Person
const cookies = { editor: '', colleague: '' }
let workspace: string

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const digestOf = (bytes: Uint8Array) =>
  `sha-256=:${createHash('sha256').update(bytes).digest('base64')}:`

/** A file that starts as an MP4 does (an `ftyp` box), then random bytes. */
function mp4Like(size: number): Buffer {
  const file = randomBytes(size)
  Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0mp42isom').copy(file)
  return file
}

const pieces = (file: Buffer) =>
  Array.from({ length: Math.ceil(file.length / PART) }, (_, i) =>
    file.subarray(i * PART, (i + 1) * PART),
  )

interface Upload {
  id: string
  partBytes: number
  partCount: number
  received: number[]
  mediaId: string | null
  firstPartSha256: string
}

const base = (orgSlug = org.slug, ws = workspace) =>
  `/api/v1/orgs/${orgSlug}/workspaces/${ws}/uploads`

async function start(
  file: Buffer,
  opts: { cookie?: string; name?: string; type?: string; orgSlug?: string; ws?: string } = {},
): Promise<Upload> {
  const r = await env.call(
    'POST',
    base(opts.orgSlug, opts.ws),
    {
      name: opts.name ?? 'reel di prova.mp4',
      type: opts.type ?? 'video/mp4',
      sizeBytes: file.length,
      firstPartSha256: sha256(file.subarray(0, PART)),
    },
    { cookie: opts.cookie ?? cookies.editor },
  )
  const text = await r.text()
  expect(r.status, text).toBe(200)
  return JSON.parse(text) as Upload
}

const put = (
  upload: Upload,
  n: number,
  bytes: Uint8Array,
  opts: { cookie?: string; digest?: string } = {},
) =>
  env.call('PUT', `${base()}/${upload.id}/parts/${String(n)}`, bytes, {
    cookie: opts.cookie ?? cookies.editor,
    headers: { 'content-digest': opts.digest ?? digestOf(bytes) },
  })

const complete = (upload: Upload, cookie = cookies.editor) =>
  env.call('POST', `${base()}/${upload.id}/complete`, undefined, { cookie })

const state = async (upload: Upload, cookie = cookies.editor) => {
  const r = await env.call('GET', `${base()}/${upload.id}`, undefined, { cookie })
  return { status: r.status, body: (await r.json()) as Upload }
}

const piecesOnDisk = (upload: Upload, organizationId = org.id) => {
  const dir = join(env.web.mediaRoot, 'uploads', organizationId, upload.id)
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

const mediaRow = async (id: string) =>
  (
    await env.admin.pool.query<{
      status: string
      kind: string
      mime: string
      sha256: string | null
      storage_key: string | null
      size_bytes: string
      analysis: unknown
      original_name: string
    }>('select * from media where id = $1', [id])
  ).rows[0]

beforeAll(async () => {
  env = await startApiEnv('uploads')
  org = await env.agency()
  editor = await env.person(org.id, 'member')
  colleague = await env.person(org.id, 'member')
  workspace = await seed(env.tdb.runtimeUrl, async (s) => {
    const w = await s.workspace(org.id)
    await s.workspaceMember(org.id, w, editor.userId, 'editor')
    await s.workspaceMember(org.id, w, colleague.userId, 'editor')
    return w
  })
  cookies.editor = await env.signIn(editor)
  cookies.colleague = await env.signIn(colleague)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

test('three pieces sent out of order make one file, stored whole, in the library', async () => {
  const file = mp4Like(2 * PART + 1234)
  const upload = await start(file)
  expect(upload).toMatchObject({ partBytes: PART, partCount: 3, received: [], mediaId: null })
  const [p1, p2, p3] = pieces(file)
  for (const [n, bytes] of [
    [3, p3],
    [1, p1],
    [2, p2],
  ] as const) {
    const r = await put(upload, n, bytes ?? Buffer.alloc(0))
    expect(r.status, await r.clone().text()).toBe(200)
  }
  expect((await state(upload)).body.received).toEqual([1, 2, 3])
  const r = await complete(upload)
  const text = await r.text()
  expect(r.status, text).toBe(200)
  const media = JSON.parse(text) as { id: string; status: string; kind: string; mime: string }
  expect(media).toMatchObject({ status: 'processing', kind: 'video', mime: 'video/mp4' })
  expect(text).not.toMatch(/org\/|storage|token/i)

  const row = await mediaRow(media.id)
  expect(row).toMatchObject({
    sha256: sha256(file),
    size_bytes: String(file.length),
    original_name: 'reel di prova.mp4',
    storage_key: `org/${org.id}/media/${media.id}/original.mp4`,
  })
  const stored = await createLocalDiskStorage({ root: env.web.mediaRoot }).get(
    row?.storage_key ?? '',
  )
  const chunks: Uint8Array[] = []
  for await (const chunk of stored?.body ?? []) chunks.push(chunk)
  expect(sha256(Buffer.concat(chunks))).toBe(sha256(file))
  // in the library, the pieces gone, the worker woken
  const library = await env.call(
    'GET',
    `/api/v1/orgs/${org.slug}/workspaces/${workspace}/media`,
    undefined,
    {
      cookie: cookies.editor,
    },
  )
  expect(((await library.json()) as { items: { id: string }[] }).items.map((m) => m.id)).toContain(
    media.id,
  )
  expect(piecesOnDisk(upload)).toEqual([])
  const jobs = await env.admin.pool.query<{ data: unknown }>(
    `select data from pgboss.job where name = 'media.process'`,
  )
  expect(jobs.rows.map((j) => j.data)).toContainEqual({ organizationId: org.id, mediaId: media.id })
  // the upload says what it became, and is no longer to resume
  expect((await state(upload)).body.mediaId).toBe(media.id)
  const open = await env.call('GET', base(), undefined, { cookie: cookies.editor })
  expect(((await open.json()) as { items: Upload[] }).items.map((u) => u.id)).not.toContain(
    upload.id,
  )
}, 120_000)

test('after a fall only the missing piece is sent again, and the upload can be resumed', async () => {
  const file = mp4Like(PART + 10)
  const upload = await start(file)
  const [p1, p2] = pieces(file)
  expect((await put(upload, 2, p2 ?? Buffer.alloc(0))).status).toBe(200)
  // a reload: the panel finds the upload left halfway, with what it has
  const open = await env.call('GET', base(), undefined, { cookie: cookies.editor })
  const listed = ((await open.json()) as { items: Upload[] }).items.find((u) => u.id === upload.id)
  expect(listed).toMatchObject({ received: [2], firstPartSha256: sha256(p1 ?? Buffer.alloc(0)) })
  const early = await complete(upload)
  expect(early.status).toBe(409)
  expect(((await early.json()) as { error: { code: string } }).error.code).toBe('CONFLICT')
  expect((await put(upload, 1, p1 ?? Buffer.alloc(0))).status).toBe(200)
  expect((await complete(upload)).status).toBe(200)
}, 60_000)

test('the same piece twice changes nothing; another content for it is a conflict', async () => {
  const file = mp4Like(5000)
  const upload = await start(file)
  expect((await put(upload, 1, file)).status).toBe(200)
  const again = await put(upload, 1, file)
  expect(again.status).toBe(200)
  expect(((await again.json()) as Upload).received).toEqual([1])
  expect(piecesOnDisk(upload)).toEqual(['1'])
  // another first piece is not the file declared
  const other = mp4Like(5000)
  const changed = await put(upload, 1, other)
  expect(changed.status).toBe(409)
})

test('a piece with the wrong sha256, or not the declared first one, is refused and not kept', async () => {
  const file = mp4Like(PART + 100)
  const upload = await start(file)
  const [p1, p2] = pieces(file)
  const wrong = await put(upload, 2, p2 ?? Buffer.alloc(0), { digest: digestOf(Buffer.from('x')) })
  expect(wrong.status).toBe(422)
  expect((await state(upload)).body.received).toEqual([])
  expect(piecesOnDisk(upload)).toEqual([])
  // the first piece must be the one declared at the start
  const notFirst = Buffer.from(p1 ?? Buffer.alloc(0))
  notFirst[100] = (notFirst[100] ?? 0) ^ 0xff
  expect((await put(upload, 1, notFirst)).status).toBe(422)
  // no digest, a piece that is not of the file, a piece too short
  const noDigest = await env.call('PUT', `${base()}/${upload.id}/parts/2`, p2, {
    cookie: cookies.editor,
  })
  expect(noDigest.status).toBe(422)
  expect((await put(upload, 3, Buffer.from('oltre'))).status).toBe(422)
  expect((await put(upload, 2, Buffer.from('corto'))).status).toBe(422)
  expect(piecesOnDisk(upload)).toEqual([])
}, 60_000)

test('a piece refused before its route (no session) closes the connection', async () => {
  const file = mp4Like(1000)
  const upload = await start(file)
  const r = await put(upload, 1, file, { cookie: '' })
  expect(r.status).toBe(401)
  // the body is not drained without a limit: the socket closes after the answer
  expect(r.headers.get('connection')).toBe('close')
})

test('a piece larger than declared is refused without reading it all', async () => {
  const file = mp4Like(1000)
  const upload = await start(file)
  // a declared length over the piece: refused before any byte is read
  const declared = await put(upload, 1, Buffer.concat([file, Buffer.alloc(1)]))
  expect(declared.status).toBe(413)
  // over the 20 MiB of any piece
  const huge = await put(upload, 1, Buffer.alloc(PART + 1))
  expect(huge.status).toBe(413)
  // in chunks, with no length: the server stops reading past the piece's size
  let sent = 0
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 1
      if (sent > 10_000) controller.close()
      else controller.enqueue(new Uint8Array(64 * 1024))
    },
  })
  const r = await fetch(env.web.url(`${base()}/${upload.id}/parts/1`), {
    method: 'PUT',
    headers: {
      origin: 'https://pannello.example.ts.net',
      'x-app-request': '1',
      'x-forwarded-for': '10.99.0.1',
      'content-type': 'application/octet-stream',
      'content-digest': digestOf(file),
      cookie: cookies.editor,
    },
    body: endless,
    duplex: 'half',
  } as RequestInit)
  expect(r.status).toBe(413)
  expect(sent).toBeLessThan(10_000)
  expect(piecesOnDisk(upload)).toEqual([])
  expect((await state(upload)).body.received).toEqual([])
})

test('bytes that are no photo nor video make a failed file, and nothing is stored', async () => {
  // a Windows program named as a photo
  const exe = Buffer.concat([Buffer.from('MZ\x90\0\x03\0\0\0'), randomBytes(3000)])
  const upload = await start(exe, { name: 'foto.jpg', type: 'image/jpeg' })
  expect((await put(upload, 1, exe)).status).toBe(200)
  const r = await complete(upload)
  const text = await r.text()
  expect(r.status, text).toBe(200)
  const media = JSON.parse(text) as { id: string; status: string }
  expect(media.status).toBe('failed')
  expect(await mediaRow(media.id)).toMatchObject({
    storage_key: null,
    mime: 'application/octet-stream',
    analysis: { kind: 'unknown', sizeBytes: exe.length },
  })
  expect(existsSync(join(env.web.mediaRoot, 'org', org.id, 'media', media.id))).toBe(false)
  expect(piecesOnDisk(upload)).toEqual([])
  const jobs = await env.admin.pool.query(
    `select 1 from pgboss.job where name = 'media.process' and data->>'mediaId' = $1`,
    [media.id],
  )
  expect(jobs.rowCount).toBe(0)
})

test('complete twice gives one file; a call while it is being made waits its turn', async () => {
  const file = mp4Like(4000)
  const upload = await start(file)
  expect((await put(upload, 1, file)).status).toBe(200)
  // at once: one makes the file, the other either finds it or is told to retry
  const answers = await Promise.all([complete(upload), complete(upload)])
  const made = answers.filter((r) => r.status === 200)
  expect(made.length).toBeGreaterThan(0)
  for (const r of answers.filter((x) => x.status !== 200)) {
    expect(r.status).toBe(409)
    expect(await errorCodeOf(r)).toBe('CONFLICT')
  }
  const ids = await Promise.all(made.map(async (r) => ((await r.json()) as { id: string }).id))
  const third = (await (await complete(upload)).json()) as { id: string }
  for (const id of ids) expect(id).toBe(third.id)
  const { rows } = await env.admin.pool.query<{ n: string }>(
    `select count(*)::text as n from media where organization_id = $1 and sha256 = $2`,
    [org.id, sha256(file)],
  )
  expect(rows[0]?.n).toBe('1')
  // only that file's folder is in the storage
  const folders = readdirSync(join(env.web.mediaRoot, 'org', org.id, 'media'))
  expect(folders).toContain(third.id)
  const { rows: all } = await env.admin.pool.query<{ id: string }>(
    'select id from media where organization_id = $1',
    [org.id],
  )
  for (const folder of folders) expect(all.map((m) => m.id)).toContain(folder)

  // a completion in progress elsewhere: no copy is made until its hold ends
  const other = await start(file)
  expect((await put(other, 1, file)).status).toBe(200)
  await env.admin.pool.query(
    `update upload_sessions set completing_until = now() + interval '10 minutes' where id = $1`,
    [other.id],
  )
  const busy = await complete(other)
  expect(busy.status).toBe(409)
  expect(await errorCodeOf(busy)).toBe('CONFLICT')
  expect((await state(other)).body.mediaId).toBeNull()
  await env.admin.pool.query(
    `update upload_sessions set completing_until = now() - interval '1 second' where id = $1`,
    [other.id],
  )
  expect((await complete(other)).status).toBe(200)
})

test("two uploads at once cannot take more than the agency's space together", async () => {
  const small = await env.agency()
  const person = await env.person(small.id, 'admin')
  await env.addPasskey(person.userId)
  const cookie = await env.strongSignIn(person)
  const ws = await seed(env.tdb.runtimeUrl, (s) => s.workspace(small.id))
  await withScope(env.tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query(`update organizations set limits = '{"storage_bytes": 15000}'::jsonb where id = $1`, [
      small.id,
    ]),
  )
  const file = mp4Like(10_000)
  const body = {
    name: 'video.mp4',
    type: 'video/mp4',
    sizeBytes: file.length,
    firstPartSha256: sha256(file),
  }
  const answers = await Promise.all(
    [1, 2].map(() => env.call('POST', base(small.slug, ws), body, { cookie })),
  )
  expect(answers.map((r) => r.status).sort()).toEqual([200, 409])
  const refused = answers.find((r) => r.status === 409)
  expect(refused && (await errorCodeOf(refused))).toBe('LIMIT_REACHED')
  // cancelling frees the space it held
  const kept = (await answers.find((r) => r.status === 200)?.json()) as Upload
  const cancelled = await env.call('DELETE', `${base(small.slug, ws)}/${kept.id}`, undefined, {
    cookie,
  })
  expect(cancelled.status).toBe(200)
  expect((await env.call('POST', base(small.slug, ws), body, { cookie })).status).toBe(200)
})

test("someone else's upload does not exist, even for a colleague of the same workspace", async () => {
  const file = mp4Like(2000)
  const upload = await start(file)
  const at = `${base()}/${upload.id}`
  const asColleague = [
    await put(upload, 1, file, { cookie: cookies.colleague }),
    await env.call('GET', at, undefined, { cookie: cookies.colleague }),
    await complete(upload, cookies.colleague),
    await env.call('DELETE', at, undefined, { cookie: cookies.colleague }),
  ]
  for (const r of asColleague) {
    expect(r.status).toBe(404)
    expect(await errorCodeOf(r)).toBe('NOT_FOUND')
  }
  const listed = await env.call('GET', base(), undefined, { cookie: cookies.colleague })
  expect(((await listed.json()) as { items: Upload[] }).items).toEqual([])
  expect(piecesOnDisk(upload)).toEqual([])
  expect((await state(upload)).body.received).toEqual([])
})

test('a cancelled upload loses its pieces; an expired one is gone for its person', async () => {
  const file = mp4Like(3000)
  const upload = await start(file)
  expect((await put(upload, 1, file)).status).toBe(200)
  expect(piecesOnDisk(upload)).toEqual(['1'])
  expect(
    (await env.call('DELETE', `${base()}/${upload.id}`, undefined, { cookie: cookies.editor }))
      .status,
  ).toBe(200)
  expect(piecesOnDisk(upload)).toEqual([])
  expect((await state(upload)).status).toBe(404)

  const late = await start(file)
  await env.admin.pool.query(
    `update upload_sessions set expires_at = now() - interval '1 second' where id = $1`,
    [late.id],
  )
  expect((await put(late, 1, file)).status).toBe(404)
  expect((await state(late)).status).toBe(404)
})

test('only photos and videos up to the video limit start; the name is shown clean', async () => {
  const sha = sha256(Buffer.from('x'))
  const post = (body: Record<string, unknown>) =>
    env.call(
      'POST',
      base(),
      { name: 'file', type: 'video/mp4', sizeBytes: 10, firstPartSha256: sha, ...body },
      { cookie: cookies.editor },
    )
  expect((await post({ type: 'application/x-msdownload' })).status).toBe(415)
  expect((await post({ sizeBytes: 300_000_001 })).status).toBe(413)
  expect((await post({ name: '\u0000‮' })).status).toBe(422)
  const r = await post({ name: '../../etc/‮passwd\u0007.mp4' })
  expect(r.status).toBe(200)
  expect(((await r.json()) as { name: string }).name).toBe('../../etc/passwd.mp4')
  // a folder that is not of this workspace
  expect((await post({ folderId: '0190aaaa-0000-7000-8000-000000000009' })).status).toBe(422)
  // the panel reads the limits of each kind with the uploads to resume, to refuse at once
  const listed = await env.call('GET', base(), undefined, { cookie: cookies.editor })
  expect(((await listed.json()) as { limits: unknown }).limits).toEqual({
    maxImageBytes: 50_000_000,
    maxVideoBytes: 300_000_000,
  })
})
