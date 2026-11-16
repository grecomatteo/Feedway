import { randomBytes, randomUUID } from 'node:crypto'
import { request } from 'node:http'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createLocalDiskStorage } from '@app/infrastructure'
import { seed } from '@app/infrastructure/testing'
import { PANEL, startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

// The public host (plan 04 Task 11, spec §16.1, ADR 005): its own entry, a port of the web that
// only Tailscale Funnel (or the tunnel) reaches. There only `/m/{token}.{jpg|mp4}` answers, with
// no cookie, and the panel answers none of it; the entry is told by the port, never by `Host`.

const PUBLIC = 'https://media.example.ts.net'

let env: ApiEnv
let org: { id: string; slug: string }
let editor: Person
let cookie = ''
let workspaceId: string

/** 1000 bytes that tell their position, so any range is checked byte by byte. */
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))

const newToken = () => randomBytes(24).toString('base64url')

interface Copy {
  purpose: string
  mime: string
  ext: string
  token: string | null
}

/** A file of the workspace with its copies stored; each copy's token, when it has one. */
async function file(
  copies: Copy[],
  opts: { kind?: 'image' | 'video'; status?: 'processing' | 'ready' } = {},
) {
  const id = randomUUID()
  const keyOf = (c: Copy) => `org/${org.id}/media/${id}/${c.purpose}.${c.ext}`
  const storage = createLocalDiskStorage({ root: env.web.mediaRoot })
  for (const c of copies) await storage.put(keyOf(c), BYTES, { contentType: c.mime })
  const mediaId = await seed(env.tdb.runtimeUrl, (s) =>
    s.media(org.id, workspaceId, {
      uploadedBy: editor.userId,
      kind: opts.kind ?? 'image',
      ...(opts.status === undefined ? {} : { status: opts.status }),
      storageKey: null,
      variants: copies.map((c) => ({
        purpose: c.purpose,
        storageKey: keyOf(c),
        mime: c.mime,
        sizeBytes: BYTES.length,
        publicToken: c.token,
      })),
    }),
  )
  return mediaId
}

const photoCopy = (): Copy => ({
  purpose: 'ig_feed',
  mime: 'image/jpeg',
  ext: 'jpg',
  token: newToken(),
})
const reelCopy = (): Copy => ({ purpose: 'reel', mime: 'video/mp4', ext: 'mp4', token: newToken() })

const pub = (path: string, init: RequestInit = {}) => fetch(env.web.publicUrl(path), init)

/** A raw request to the public entry: fetch would not send a `Host` of our choice. */
function rawPublic(
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  const url = new URL(env.web.publicUrl(path))
  return new Promise((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path, method: 'GET', headers },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => (body += chunk))
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

/** How many system-scope reads the server logged so far: each `/m/` lookup is one. */
const systemReads = () =>
  env.web
    .output()
    .split('\n')
    .filter((l) => l.includes('public host: copy by token')).length

beforeAll(async () => {
  env = await startApiEnv('public-host', { publicUrl: PUBLIC })
  org = await env.agency()
  editor = await env.person(org.id, 'member')
  workspaceId = await seed(env.tdb.runtimeUrl, async (s) => {
    const w = await s.workspace(org.id)
    await s.workspaceMember(org.id, w, editor.userId, 'editor')
    return w
  })
  cookie = await env.signIn(editor)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

describe('the copy to publish, on the public entry', () => {
  test('a photo is served whole, as JPEG, with no cookie and not to be indexed', async () => {
    const copy = photoCopy()
    await file([copy])
    // even a request that carries the panel's cookie gets none back
    const r = await pub(`/m/${String(copy.token)}.jpg`, { headers: { cookie } })
    expect(r.status).toBe(200)
    expect(Buffer.from(await r.arrayBuffer())).toEqual(BYTES)
    expect(r.headers.get('content-type')).toBe('image/jpeg')
    expect(r.headers.get('content-length')).toBe(String(BYTES.length))
    expect(r.headers.get('accept-ranges')).toBe('bytes')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(r.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(r.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(r.headers.getSetCookie()).toEqual([])
    expect(r.headers.get('set-cookie')).toBeNull()
  })

  test('a reel is served as MP4, by byte ranges', async () => {
    const copy = reelCopy()
    await file([copy], { kind: 'video' })
    const path = `/m/${String(copy.token)}.mp4`
    const r = await pub(path, { headers: { range: 'bytes=10-19' } })
    expect(r.status).toBe(206)
    expect(r.headers.get('content-type')).toBe('video/mp4')
    expect(r.headers.get('content-range')).toBe('bytes 10-19/1000')
    expect(r.headers.get('content-length')).toBe('10')
    expect(Buffer.from(await r.arrayBuffer())).toEqual(BYTES.subarray(10, 20))

    const suffix = await pub(path, { headers: { range: 'bytes=-5' } })
    expect(suffix.status).toBe(206)
    expect(suffix.headers.get('content-range')).toBe('bytes 995-999/1000')
    expect(Buffer.from(await suffix.arrayBuffer())).toEqual(BYTES.subarray(995))

    const past = await pub(path, { headers: { range: 'bytes=5000-' } })
    expect(past.status).toBe(416)
    expect(past.headers.get('content-range')).toBe('bytes */1000')
    expect(past.headers.getSetCookie()).toEqual([])
  })

  test('HEAD answers the headers without a body', async () => {
    const copy = reelCopy()
    await file([copy], { kind: 'video' })
    const path = `/m/${String(copy.token)}.mp4`
    const whole = await pub(path, { method: 'HEAD' })
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-length')).toBe('1000')
    expect(whole.headers.get('content-type')).toBe('video/mp4')
    expect((await whole.arrayBuffer()).byteLength).toBe(0)
    const part = await pub(path, { method: 'HEAD', headers: { range: 'bytes=0-99' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-length')).toBe('100')
    expect((await part.arrayBuffer()).byteLength).toBe(0)
  })

  test('an ETag that did not change answers 304', async () => {
    const copy = photoCopy()
    await file([copy])
    const path = `/m/${String(copy.token)}.jpg`
    const first = await pub(path)
    const etag = first.headers.get('etag')
    expect(etag).toMatch(/^"[0-9a-f-]{36}"$/)
    const again = await pub(path, { headers: { 'if-none-match': String(etag) } })
    expect(again.status).toBe(304)
  })

  test('only GET and HEAD', async () => {
    const copy = photoCopy()
    await file([copy])
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const r = await pub(`/m/${String(copy.token)}.jpg`, { method })
      expect(r.status, method).toBe(405)
      expect(r.headers.get('allow')).toBe('GET, HEAD')
    }
  })
})

describe('what the public entry never serves', () => {
  const notFound = async (path: string, init: RequestInit = {}) => {
    const r = await pub(path, init)
    expect(r.status, path).toBe(404)
    expect(r.headers.getSetCookie(), path).toEqual([])
    expect(r.headers.get('x-robots-tag'), path).toBe('noindex, nofollow')
    expect(r.headers.get('content-type'), path).toBe('text/plain; charset=utf-8')
    // nothing of the panel: not its page, not its JSON errors
    expect(await r.text(), path).toBe('Not Found')
  }

  test('a thumbnail or the preview, even with a token', async () => {
    const thumbnail: Copy = {
      purpose: 'thumbnail',
      mime: 'image/jpeg',
      ext: 'jpg',
      token: newToken(),
    }
    const id = await file(
      [{ purpose: 'preview', mime: 'video/mp4', ext: 'mp4', token: null }, thumbnail],
      { kind: 'video' },
    )
    await notFound(`/m/${String(thumbnail.token)}.jpg`)
    // the database refuses a token on the preview
    await expect(
      env.admin.pool.query(
        `update media_variants set public_token = $1 where media_id = $2 and purpose = 'preview'`,
        [newToken(), id],
      ),
    ).rejects.toThrow(/media_variants_preview_private/)
  })

  test('the copy of a deleted file, at once', async () => {
    const copy = photoCopy()
    const id = await file([copy])
    const path = `/m/${String(copy.token)}.jpg`
    expect((await pub(path)).status).toBe(200)
    const r = await env.call(
      'DELETE',
      `/api/v1/orgs/${org.slug}/workspaces/${workspaceId}/media/${id}`,
      undefined,
      { cookie },
    )
    expect(r.status).toBe(200)
    await notFound(path)
  })

  test('the copy of a file not ready yet', async () => {
    const copy = photoCopy()
    await file([copy], { status: 'processing' })
    await notFound(`/m/${String(copy.token)}.jpg`)
  })

  test('a photo asked as MP4, a reel asked as JPEG, a token nobody has', async () => {
    const photo = photoCopy()
    const reel = reelCopy()
    await file([photo])
    await file([reel], { kind: 'video' })
    await notFound(`/m/${String(photo.token)}.mp4`)
    await notFound(`/m/${String(reel.token)}.jpg`)
    await notFound(`/m/${newToken()}.jpg`)
  })

  test('a name of the wrong form, without asking the database', async () => {
    const copy = photoCopy()
    await file([copy])
    const token = String(copy.token)
    const before = systemReads()
    for (const name of [
      `${token.slice(1)}.jpg`,
      `${token}x.jpg`,
      `${token}.png`,
      `${token}.JPG`,
      token,
      `${token}.jpg.mp4`,
    ])
      await notFound(`/m/${name}`)
    await notFound(`/m/${token}.jpg/x`)
    await notFound('/m/')
    await notFound('/m')
    expect(systemReads()).toBe(before)
    // and a well formed name does ask it
    expect((await pub(`/m/${token}.jpg`)).status).toBe(200)
    expect(systemReads()).toBe(before + 1)
  })

  test('the panel: its pages, its API, its files, its sign-in', async () => {
    for (const path of [
      '/',
      '/accedi',
      '/api/health',
      '/api/ready',
      '/api/v1/me',
      '/api/v1/openapi.json',
      '/favicon.ico',
      '/brand/favicon.svg',
      '/_nuxt/',
      '/__nuxt_error?statusCode=404',
      `/api/v1/orgs/${org.slug}/workspaces/${workspaceId}/media`,
    ])
      await notFound(path, { headers: { cookie } })
    const signIn = await pub('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: PANEL },
      body: JSON.stringify({ email: editor.email, password: 'x' }),
    })
    expect(signIn.status).toBe(405)
    expect(signIn.headers.getSetCookie()).toEqual([])
  })

  test('the panel, even with the panel host in Host or in the forwarded headers', async () => {
    const panelHost = new URL(PANEL).host
    for (const headers of [
      { host: panelHost },
      { host: panelHost, 'x-forwarded-host': panelHost, 'x-forwarded-proto': 'https' },
      { host: 'localhost' },
    ]) {
      const r = await rawPublic('/api/health', { ...headers, cookie })
      expect(r.status).toBe(404)
      expect(r.headers['set-cookie']).toBeUndefined()
      expect(r.body).toBe('Not Found')
    }
  })

  test('/share/ answers nothing until the client link of stage 10', async () => {
    await notFound('/share/')
    await notFound(`/share/${newToken()}`)
  })

  test('robots.txt keeps everything out of the search engines', async () => {
    const r = await pub('/robots.txt')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await r.text()).toBe('User-agent: *\nDisallow: /\n')
    expect(r.headers.getSetCookie()).toEqual([])
  })
})

describe('the panel entry', () => {
  test('/m/ and /share/ are not found there, even for a token that exists', async () => {
    const copy = photoCopy()
    await file([copy])
    for (const path of [
      `/m/${String(copy.token)}.jpg`,
      `/M/${String(copy.token)}.jpg`,
      '/m/',
      '/share/',
      `/share/${newToken()}`,
    ]) {
      const r = await env.call('GET', path, undefined, { cookie })
      expect(r.status, path).toBe(404)
      expect(r.headers.get('content-type'), path).not.toMatch(/^image\//)
    }
  })

  test('nothing of the panel is to be indexed', async () => {
    for (const path of ['/accedi', '/api/health', '/pagina-che-non-esiste']) {
      const r = await env.call('GET', path, undefined, { headers: { accept: 'text/html' } })
      expect(r.headers.get('x-robots-tag'), path).toBe('noindex, nofollow')
    }
    const robots = await env.call('GET', '/robots.txt')
    expect(robots.status).toBe(200)
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')
    expect(robots.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })
})
