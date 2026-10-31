import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createDb, createPasswordHasher } from '@app/infrastructure'
import type { DbHandle } from '@app/infrastructure'
import { seed, startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { panelClient, sessionCookieOf, sleep, startWeb, uuidRe } from './helpers.js'
import type { RunningWeb } from './helpers.js'

const PANEL = 'https://pannello.example.ts.net'
// low entropy on purpose: made-up values, not secrets for the leak scanner
const PASSWORD = 'cavallo-batteria-graffetta-lago'
const LONG_SECRET = `segreto-${'molto-'.repeat(200)}lungo`

let tdb: TestDatabase
let web: RunningWeb
let admin: DbHandle
let panel: ReturnType<typeof panelClient>

// every request from its own address: the per-address limits (sign-in, lock link) stay out of the way
let nextHost = 0
const call: ReturnType<typeof panelClient> = (method, path, body, opts) =>
  panel(method, path, body, {
    ...opts,
    headers: {
      'x-forwarded-for': `10.19.${String(Math.floor(++nextHost / 250))}.${String(nextHost % 250)}`,
      ...opts?.headers,
    },
  })

beforeAll(async () => {
  tdb = await startTestDatabase()
  admin = createDb(tdb.adminUrl, { max: 2, applicationName: 'http-layer-web-test' })
  web = await startWeb({
    DATABASE_URL: tdb.runtimeUrl,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    PANEL_URL: PANEL,
  })
  panel = panelClient(web, PANEL)
}, 300_000)

afterAll(async () => {
  await web.stop()
  await admin.close()
  await tdb.stop()
})

interface ErrorJson {
  error: {
    code: string
    message: string
    requestId: string
    issues?: { path: (string | number)[]; message: string }[]
    reason?: string
  }
}
const errorOf = async (r: Response) => ((await r.json()) as ErrorJson).error

/** A person with a password, in a new agency with the given role. */
async function personIn(role: 'admin' | 'member', opts: { status?: 'suspended' } = {}) {
  const email = `http-${randomUUID().slice(0, 8)}@example.test`
  const ids = await seed(tdb.runtimeUrl, async (s) => {
    const userId = await s.user({ email })
    const organizationId = await s.organization(opts)
    await s.member(organizationId, userId, role)
    return { userId, organizationId }
  })
  await admin.pool.query(
    `insert into accounts (id, account_id, provider_id, user_id, password, updated_at)
     values ($1, $2::text, 'credential', $2::uuid, $3, now())`,
    [randomUUID(), ids.userId, await createPasswordHasher().hash(PASSWORD)],
  )
  // the seeded slug is the agency id
  return { ...ids, email, slug: ids.organizationId }
}

async function signIn(email: string): Promise<string> {
  const r = await call('POST', '/api/auth/sign-in/email', { email, password: PASSWORD })
  expect(r.status).toBe(200)
  const cookie = sessionCookieOf(r)
  expect(cookie).toBeDefined()
  return cookie ?? ''
}

async function addPasskeyDirectly(userId: string) {
  await admin.pool.query(
    `insert into passkeys (id, name, public_key, user_id, credential_id, counter, device_type, backed_up, created_at)
     values ($1, 'Portatile', 'chiave-finta', $2, $3, 0, 'multiDevice', true, now())`,
    [randomUUID(), userId, randomBytes(16).toString('base64url')],
  )
}

async function inviteToken(email: string) {
  const token = randomBytes(32).toString('base64url')
  const organizationId = await seed(tdb.runtimeUrl, (s) => s.organization())
  await admin.pool.query(
    `insert into invites (id, organization_id, purpose, email, token_hash, org_role, memberships, expires_at)
     values ($1, $2, 'invite', $3, $4, 'member', '[]', now() + interval '1 hour')`,
    [randomUUID(), organizationId, email, createHash('sha256').update(token, 'utf8').digest()],
  )
  return token
}

const sessionCount = async (userId: string) =>
  Number(
    (
      await admin.pool.query<{ count: string }>(
        'select count(*) from sessions where user_id = $1',
        [userId],
      )
    ).rows[0]?.count,
  )

const makeRenewable = (userId: string) =>
  // Better Auth renews a session read more than updateAge (5 minutes) after its last renewal
  admin.pool.query(
    `update sessions set expires_at = now() + interval '11 hours', updated_at = now() - interval '1 hour' where user_id = $1`,
    [userId],
  )
const sessionSetCookies = (r: Response) =>
  r.headers.getSetCookie().filter((c) => c.startsWith('__Host-session='))

/**
 * A request sent with its path exactly as written: fetch and URL resolve `.` and `..` (also
 * `%2e`) on the client, so they never show what the server does with them.
 */
function rawRequest(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  const { hostname, port } = new URL(web.url('/'))
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname, port, path, method: opts.method ?? 'POST', headers: opts.headers },
      (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers })
        })
      },
    )
    req.on('error', reject)
    req.end(opts.body)
  })
}

/** One piece over the 1 MiB body limit of the server. */
const OVER_BODY_LIMIT = 1024 * 1024 + 64 * 1024

/**
 * A chunked upload of `sendBytes` that stops writing without ending the body, then waits for the
 * answer. The server reads every byte sent before it refuses, so it closes without unread data
 * (which would reset the connection and could lose the 413). If no answer comes, the body is ended
 * and whatever the server then answers is returned: a limit that was not enforced shows up there.
 */
function chunkedUpload(
  path: string,
  contentType: string,
  sendBytes: number,
): Promise<{ status: number }> {
  const { hostname, port } = new URL(web.url('/'))
  const piece = Buffer.alloc(64 * 1024, 97)
  return new Promise((resolve, reject) => {
    let answered = false
    const req = httpRequest(
      {
        hostname,
        port,
        path,
        method: 'POST',
        headers: {
          'content-type': contentType,
          'transfer-encoding': 'chunked',
          origin: PANEL,
          'x-app-request': '1',
        },
      },
      (res) => {
        answered = true
        res.resume()
        resolve({ status: res.statusCode ?? 0 })
      },
    )
    req.on('error', (error) => {
      if (!answered) reject(error)
    })
    let sent = 0
    const writeMore = (): void => {
      while (sent < sendBytes) {
        sent += piece.length
        if (!req.write(piece)) {
          req.once('drain', writeMore)
          return
        }
      }
      setTimeout(() => {
        if (!answered && !req.destroyed) req.end()
      }, 3000)
    }
    writeMore()
  })
}

/** The server log lines written while `action` ran and shortly after. */
async function logLinesDuring(action: () => Promise<unknown>): Promise<string[]> {
  const before = web.output().length
  await action()
  await sleep(500)
  return web.output().slice(before).split('\n').filter(Boolean)
}

describe('csrf', () => {
  test('mutation without custom header or from foreign origin is rejected', async () => {
    const token = 'qualsiasi'
    const missing = await call('POST', '/api/v1/security/lock', { token }, { omitAppHeader: true })
    expect(missing.status).toBe(403)
    const body = await errorOf(missing)
    expect(body).toMatchObject({
      code: 'FORBIDDEN',
      requestId: missing.headers.get('x-request-id'),
    })
    expect(
      (await call('POST', '/api/v1/security/lock', { token }, { origin: 'https://evil.example' }))
        .status,
    ).toBe(403)
  })

  test('a cross-site fetch metadata header is refused even with the right origin and header', async () => {
    const cross = await call(
      'POST',
      '/api/v1/security/lock',
      { token: 'x' },
      { headers: { 'sec-fetch-site': 'cross-site' } },
    )
    expect(cross.status).toBe(403)
    const sibling = await call(
      'POST',
      '/api/auth/sign-out',
      {},
      { headers: { 'sec-fetch-site': 'same-site' } },
    )
    expect(sibling.status).toBe(403)
    const same = await call(
      'POST',
      '/api/v1/security/lock',
      { token: 'x' },
      { headers: { 'sec-fetch-site': 'same-origin' } },
    )
    expect(same.status).toBe(410)
  })

  test('spellings of the path that reach the same route are checked too', async () => {
    for (const path of [
      '/%61pi/v1/security/lock',
      '/api/v1/x/../security/lock',
      '/api/v1//security/lock',
    ])
      expect((await call('POST', path, { token: 'x' }, { omitAppHeader: true })).status, path).toBe(
        403,
      )
  })
})

describe('canonical paths', () => {
  test('a path with dot segments is refused before any check reads it', async () => {
    const withPasskey = await personIn('admin')
    await addPasskeyDirectly(withPasskey.userId)
    const stolen = await signIn(withPasskey.email)
    for (const path of [
      '/api/auth/x/../change-password',
      '/api/auth/./change-password',
      '/api/auth/x/../two-factor/enable',
      '/api/auth/x/%2e%2e/change-password',
      '/api/auth/x/%2E%2e/two-factor/enable',
      '/api/auth/%2e/change-password',
      '/api/v1/x/../security/lock',
      '/api/v1/links/../security/lock?x=1',
    ]) {
      const r = await rawRequest(path, {
        headers: {
          origin: PANEL,
          'x-app-request': '1',
          'content-type': 'application/json',
          'x-forwarded-for': '10.20.0.1',
          cookie: stolen,
        },
        body: JSON.stringify({ password: PASSWORD, currentPassword: PASSWORD, newPassword: 'x' }),
      })
      expect(r.status, path).toBe(400)
      const body = JSON.parse(r.body) as ErrorJson
      expect(body.error.code, path).toBe('BAD_REQUEST')
      expect(body.error.requestId, path).toBe(r.headers['x-request-id'])
    }
  })

  test('canonical paths are not affected', async () => {
    const r = await rawRequest('/api/v1/links/sconosciuto', { method: 'GET' })
    expect(r.status).toBe(410)
  })
})

describe('test routes', () => {
  test('without APP_TEST_ROUTES the test routes do not exist', async () => {
    const plain = await startWeb({
      DATABASE_URL: tdb.runtimeUrl,
      APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
      PANEL_URL: PANEL,
      APP_TEST_ROUTES: '0',
    })
    try {
      const page = await fetch(plain.url('/__test/fail'), { headers: { accept: 'text/html' } })
      expect(page.status).toBe(404)
      const api = await fetch(plain.url('/api/__test/orgs/qualsiasi/actor'))
      expect(api.status).toBe(404)
    } finally {
      await plain.stop()
    }
  }, 120_000)
})

describe('second factor', () => {
  test('first-time setup reaches enrollment, a user with a factor only sign-out and get-session', async () => {
    const withoutFactor = await personIn('admin')
    const first = await signIn(withoutFactor.email)
    expect(
      (await call('POST', '/api/auth/two-factor/enable', { password: PASSWORD }, { cookie: first }))
        .status,
    ).toBe(200)
    const change = await call(
      'POST',
      '/api/auth/change-password',
      { currentPassword: PASSWORD, newPassword: 'una-nuova-password-lunga' },
      { cookie: first },
    )
    expect(change.status).toBe(403)
    expect(await errorOf(change)).toMatchObject({ code: 'SECOND_FACTOR_REQUIRED' })

    const withPasskey = await personIn('admin')
    await addPasskeyDirectly(withPasskey.userId)
    const stolen = await signIn(withPasskey.email)
    const r = await call(
      'POST',
      '/api/auth/two-factor/enable',
      { password: PASSWORD },
      { cookie: stolen },
    )
    expect(r.status).toBe(403)
    expect(await errorOf(r)).toMatchObject({
      code: 'SECOND_FACTOR_REQUIRED',
      reason: 'use_existing_factor',
    })
    expect(
      (
        await call('GET', '/api/auth/passkey/generate-register-options', undefined, {
          cookie: stolen,
        })
      ).status,
    ).toBe(403)
    expect((await call('GET', '/api/v1/openapi.json', undefined, { cookie: stolen })).status).toBe(
      403,
    )
    expect((await call('GET', '/api/auth/get-session', undefined, { cookie: stolen })).status).toBe(
      200,
    )
    expect((await call('POST', '/api/auth/sign-out', {}, { cookie: stolen })).status).toBe(200)
  })

  test('closing an activation link stays open to a session that owes the second factor', async () => {
    const p = await personIn('admin')
    const cookie = await signIn(p.email)
    // the route answers on its own terms (no such link), not with the second factor barrier
    const r = await call('POST', '/api/v1/links/sconosciuto/complete', {}, { cookie })
    expect(r.status).toBe(410)
  })
})

describe('session per request', () => {
  test('session beyond 30 days is refused on better auth paths too', async () => {
    const p = await personIn('member')
    const cookie = await signIn(p.email)
    await admin.pool.query(
      `update sessions set created_at = now() - interval '31 days' where user_id = $1`,
      [p.userId],
    )
    expect(
      await (await call('GET', '/api/auth/get-session', undefined, { cookie })).json(),
    ).toBeNull()
    expect(await sessionCount(p.userId)).toBe(0)
  })

  test('a disabled person is signed out on better auth paths too', async () => {
    const p = await personIn('member')
    const cookie = await signIn(p.email)
    await admin.pool.query(
      `update users set status = 'disabled', disabled_at = now() where id = $1`,
      [p.userId],
    )
    expect(
      await (await call('GET', '/api/auth/get-session', undefined, { cookie })).json(),
    ).toBeNull()
    expect(await sessionCount(p.userId)).toBe(0)
  })

  test('a session the request renews comes back with its cookie', async () => {
    const p = await personIn('member')
    const cookie = await signIn(p.email)
    await makeRenewable(p.userId)
    const r = await call('GET', '/api/v1/openapi.json', undefined, { cookie })
    expect(r.status).toBe(200)
    const [renewed] = sessionSetCookies(r)
    expect(renewed?.split(';')[0]).toBe(cookie)
    expect(renewed).toMatch(/Max-Age=43200/i)
  })

  test('signing in over an older session ends with the new session cookie', async () => {
    const p = await personIn('member')
    const old = await signIn(p.email)
    await makeRenewable(p.userId)
    const r = await call(
      'POST',
      '/api/auth/sign-in/email',
      { email: p.email, password: PASSWORD },
      { cookie: old },
    )
    expect(r.status).toBe(200)
    // the browser keeps the last one: the new session
    const last = sessionSetCookies(r).at(-1)?.split(';')[0] ?? ''
    expect(last).not.toBe(old)
    const session = (await (
      await call('GET', '/api/auth/get-session', undefined, { cookie: last })
    ).json()) as {
      user?: { email?: string }
    } | null
    expect(session?.user?.email).toBe(p.email)
  })

  test('a session route answers 401 without a session and 200 with one', async () => {
    expect(await errorOf(await call('GET', '/api/v1/openapi.json'))).toMatchObject({
      code: 'UNAUTHENTICATED',
    })
    const p = await personIn('member')
    expect(
      (await call('GET', '/api/v1/openapi.json', undefined, { cookie: await signIn(p.email) }))
        .status,
    ).toBe(200)
  })
})

describe('agency context', () => {
  test('a member reaches their agency, anyone else gets 404, anonymous 401', async () => {
    const a = await personIn('member')
    const b = await personIn('member')
    const cookie = await signIn(a.email)
    const own = await call('GET', `/api/__test/orgs/${a.slug}/actor`, undefined, { cookie })
    expect(own.status).toBe(200)
    expect(await own.json()).toEqual({ organizationId: a.organizationId, orgRole: 'member' })
    const other = await errorOf(
      await call('GET', `/api/__test/orgs/${b.slug}/actor`, undefined, { cookie }),
    )
    const unknown = await errorOf(
      await call('GET', `/api/__test/orgs/nessuna-agenzia/actor`, undefined, { cookie }),
    )
    expect(other.code).toBe('NOT_FOUND')
    // an agency that exists and one that does not look the same
    expect({ ...other, requestId: '' }).toEqual({ ...unknown, requestId: '' })
    expect((await call('GET', `/api/__test/orgs/${a.slug}/actor`)).status).toBe(401)
  })

  test('a suspended agency answers 403 ORGANIZATION_SUSPENDED', async () => {
    const p = await personIn('member', { status: 'suspended' })
    const r = await call('GET', `/api/__test/orgs/${p.slug}/actor`, undefined, {
      cookie: await signIn(p.email),
    })
    expect(r.status).toBe(403)
    expect((await errorOf(r)).code).toBe('ORGANIZATION_SUSPENDED')
  })
})

describe('request validation', () => {
  test('validation errors are 422 with italian issues', async () => {
    const token = await inviteToken(`valida-${randomUUID().slice(0, 8)}@esempio.it`)
    const r = await call('POST', `/api/v1/links/${token}/activate`, { name: '' })
    expect(r.status).toBe(422)
    expect((await errorOf(r)).issues?.[0]).toMatchObject({ path: ['name'] })
  })

  test('unknown keys are refused and what was sent is never echoed', async () => {
    const r = await call('POST', '/api/v1/security/lock', {
      token: LONG_SECRET,
      extra: 'altro-segreto',
    })
    expect(r.status).toBe(422)
    const text = await r.text()
    expect(text).not.toMatch(/segreto/)
    const issues = (JSON.parse(text) as ErrorJson).error.issues ?? []
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining([['token'], ['extra']]))
  })

  test('a body that is not json is refused: 415 for another type, 400 when malformed', async () => {
    expect(
      (
        await call('POST', '/api/v1/security/lock', 'token=x', {
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        })
      ).status,
    ).toBe(415)
    const malformed = await call('POST', '/api/v1/security/lock', '{"token": ', {})
    expect(malformed.status).toBe(400)
    expect((await errorOf(malformed)).code).toBe('BAD_REQUEST')
  })

  test('a body over the route limit answers 413', async () => {
    const r = await call('POST', '/api/v1/security/lock', { token: 'x'.repeat(64 * 1024) })
    expect(r.status).toBe(413)
    expect((await errorOf(r)).code).toBe('REQUEST_TOO_LARGE')
  })

  test('a chunked body over the server limit is refused before it is all read', async () => {
    for (const path of ['/api/v1/security/lock', '/']) {
      const r = await chunkedUpload(path, 'application/json', OVER_BODY_LIMIT)
      expect(r.status, path).toBe(413)
    }
  })

  test('the larger upload limit needs a multipart media type, not the word anywhere', async () => {
    for (const path of ['/api/v1/security/lock', '/api/auth/sign-in/email', '/']) {
      const r = await chunkedUpload(
        path,
        'application/json; x=multipart/form-data',
        OVER_BODY_LIMIT,
      )
      expect(r.status, path).toBe(413)
    }
  })

  test('an upload the client abandons halfway is not logged as a failure', async () => {
    const { hostname, port } = new URL(web.url('/'))
    const lines = await logLinesDuring(
      () =>
        new Promise<void>((resolve) => {
          const socket = connect(Number(port), hostname, () => {
            socket.write(
              'POST /api/v1/security/lock HTTP/1.1\r\n' +
                `host: ${hostname}:${port}\r\n` +
                `origin: ${PANEL}\r\nx-app-request: 1\r\n` +
                'content-type: application/json\r\ntransfer-encoding: chunked\r\n\r\n' +
                '5\r\n{"tok\r\n',
            )
            setTimeout(() => {
              socket.destroy()
              resolve()
            }, 200)
          })
        }),
    )
    expect(lines.filter((line) => /unhandled error|"level":50/.test(line))).toEqual([])
  })
})

describe('responses', () => {
  test('api answers are never cached, never framed and never shared cross-origin', async () => {
    for (const path of [
      '/api/v1/links/sconosciuto',
      '/api/auth/get-session',
      '/api/v1/nessuna-rotta',
    ]) {
      const r = await fetch(web.url(path), { headers: { origin: 'https://evil.example' } })
      expect(r.headers.get('cache-control'), path).toBe('no-store')
      expect(r.headers.get('x-content-type-options'), path).toBe('nosniff')
      expect(r.headers.get('content-security-policy'), path).toContain("frame-ancestors 'none'")
      expect(r.headers.get('access-control-allow-origin'), path).toBeNull()
    }
  })

  test('an unknown api path is a json 404 with the request id', async () => {
    const r = await fetch(web.url('/api/v1/nessuna-rotta'), { headers: { accept: 'text/html' } })
    expect(r.status).toBe(404)
    // the standard phrase, not one that repeats the path
    expect(r.statusText).toBe('Not Found')
    const body = await errorOf(r)
    expect(body.code).toBe('NOT_FOUND')
    expect(body.requestId).toMatch(uuidRe)
    expect(body.requestId).toBe(r.headers.get('x-request-id'))
  })

  test('a request id sent by the client is never used', async () => {
    const r = await fetch(web.url('/api/v1/links/sconosciuto'), {
      headers: {
        'x-request-id': 'forged',
        'x-app-request-id': '01a17295-79bc-75e9-a3fb-d577e68e5dfd',
      },
    })
    const id = r.headers.get('x-request-id')
    expect(id).toMatch(uuidRe)
    expect(id).not.toBe('01a17295-79bc-75e9-a3fb-d577e68e5dfd')
    expect((await errorOf(r)).requestId).toBe(id)
  })

  test('pages are never stored, so a renewed session cookie never sits in a cache', async () => {
    const p = await personIn('member')
    const cookie = await signIn(p.email)
    await makeRenewable(p.userId)
    const page = await fetch(web.url('/'), { headers: { accept: 'text/html', cookie } })
    expect(page.status).toBe(200)
    expect(sessionSetCookies(page)[0]?.split(';')[0]).toBe(cookie)
    expect(page.headers.get('cache-control')).toBe('private, no-store')
    const anonymous = await fetch(web.url('/'), { headers: { accept: 'text/html' } })
    expect(anonymous.headers.get('cache-control')).toBe('private, no-store')
  })

  test('an error page is one request in the log, not two', async () => {
    const lines = await logLinesDuring(() =>
      fetch(web.url('/pagina-che-non-esiste'), { headers: { accept: 'text/html' } }),
    )
    const requests = lines.filter((line) => line.includes('"msg":"request"'))
    expect(requests.filter((line) => line.includes('/__nuxt_error'))).toEqual([])
    expect(requests.filter((line) => line.includes('/pagina-che-non-esiste'))).toHaveLength(1)
  })
})

test('text that looks like HTML reaches the route as it is (no input filter, ADR 018)', async () => {
  // a sender written as "Name <address>" and a password with angle brackets are valid input
  const p = await personIn('member')
  const cookie = await signIn(p.email)
  const r = await call(
    'POST',
    '/api/v1/auth/reauth',
    { password: '<script>alert(1)</script>' },
    {
      cookie,
    },
  )
  expect(r.status).toBe(403)
  expect((await errorOf(r)).code).toBe('REAUTH_FAILED')
  const named = await call('PATCH', '/api/v1/me', { nickname: 'Anna <a@b.test>' }, { cookie })
  expect(named.status).not.toBe(400)
})
