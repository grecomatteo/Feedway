import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { startWeb } from './helpers.js'
import type { RunningWeb } from './helpers.js'

const PANEL = 'https://pannello.example.ts.net'

let tdb: TestDatabase
let web: RunningWeb

beforeAll(async () => {
  tdb = await startTestDatabase()
  web = await startWeb({
    DATABASE_URL: tdb.runtimeUrl,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    PANEL_URL: PANEL,
  })
}, 300_000)

afterAll(async () => {
  await web.stop()
  await tdb.stop()
})

interface PostOptions {
  headers?: Record<string, string>
  origin?: string
  omitAppHeader?: boolean
  xff?: string
  cookie?: string
}

/** A sign-in attempt for an account that does not exist: each call gets its own email. */
const unknownAccount = () => ({
  email: `nessuno-${randomUUID()}@example.invalid`,
  password: 'una password sbagliata',
})

function post(path: string, body: unknown, opts: PostOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: opts.origin ?? PANEL,
    ...opts.headers,
  }
  if (opts.omitAppHeader !== true) headers['x-app-request'] = '1'
  if (opts.xff !== undefined) headers['x-forwarded-for'] = opts.xff
  if (opts.cookie !== undefined) headers['cookie'] = opts.cookie
  return fetch(web.url(path), { method: 'POST', headers, body: JSON.stringify(body) })
}

interface ParsedCookie {
  name: string
  value: string
  attributes: Map<string, string>
}

function cookieNamed(response: Response, name: string): ParsedCookie | undefined {
  for (const raw of response.headers.getSetCookie()) {
    const [pair = '', ...rest] = raw.split(';').map((part) => part.trim())
    const at = pair.indexOf('=')
    if (pair.slice(0, at) !== name) continue
    const attributes = new Map(
      rest.map((attribute) => {
        const eq = attribute.indexOf('=')
        return eq === -1
          ? [attribute.toLowerCase(), '']
          : [attribute.slice(0, eq).toLowerCase(), attribute.slice(eq + 1)]
      }),
    )
    return { name, value: pair.slice(at + 1), attributes }
  }
  return undefined
}

test('better auth answers under /api/auth', async () => {
  const r = await fetch(web.url('/api/auth/get-session'))
  expect(r.status).toBe(200)
})

test('a device cookie is set once, host-only, and a forged device header is ignored', async () => {
  const first = await post('/api/auth/sign-in/email', unknownAccount(), {
    headers: { 'x-app-device-id': 'forged' },
    xff: '10.0.0.1',
  })
  const cookie = cookieNamed(first, '__Host-device')
  expect(cookie).toBeDefined()
  if (cookie === undefined) return
  expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(cookie.attributes.has('httponly')).toBe(true)
  expect(cookie.attributes.has('secure')).toBe(true)
  expect(cookie.attributes.get('samesite')).toBe('Lax')
  expect(cookie.attributes.get('path')).toBe('/')
  expect(cookie.attributes.get('max-age')).toBe(String(400 * 86_400))
  expect(cookie.attributes.has('domain')).toBe(false)

  const second = await post('/api/auth/sign-in/email', unknownAccount(), {
    cookie: `__Host-device=${cookie.value}`,
    xff: '10.0.0.1',
  })
  expect(cookieNamed(second, '__Host-device')).toBeUndefined()

  const invalid = await post('/api/auth/sign-in/email', unknownAccount(), {
    cookie: '__Host-device=troppo-corto',
    xff: '10.0.0.1',
  })
  expect(cookieNamed(invalid, '__Host-device')?.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
})

test('the device cookie is only set on the sign-in routes', async () => {
  const r = await fetch(web.url('/api/health'))
  expect(cookieNamed(r, '__Host-device')).toBeUndefined()
})

test('mutation without app header or from a foreign origin is rejected', async () => {
  const noHeader = await post('/api/auth/sign-in/email', unknownAccount(), {
    omitAppHeader: true,
  })
  expect(noHeader.status).toBe(403)
  expect(await noHeader.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })

  const foreign = await post('/api/auth/sign-in/email', unknownAccount(), {
    origin: 'https://evil.example',
  })
  expect(foreign.status).toBe(403)

  const noOrigin = await fetch(web.url('/api/auth/sign-in/email'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-app-request': '1' },
    body: JSON.stringify(unknownAccount()),
  })
  expect(noOrigin.status).toBe(403)

  const v1 = await post('/api/v1/anything', {}, { origin: 'https://evil.example' })
  expect(v1.status).toBe(403)
})

test('spoofed forwarded-for is ignored: the proxy-appended address counts', async () => {
  for (let n = 0; n < 10; n++) {
    const r = await post('/api/auth/sign-in/email', unknownAccount(), {
      xff: `1.1.1.${String(n)}, 9.9.9.9`,
    })
    expect(r.status).toBe(401)
  }
  const blocked = await post('/api/auth/sign-in/email', unknownAccount(), {
    xff: '1.1.1.99, 9.9.9.9',
  })
  expect(blocked.status).toBe(429)

  // the same spoofed first entry from another address is counted separately
  const other = await post('/api/auth/sign-in/email', unknownAccount(), {
    xff: '9.9.9.9, 8.8.8.8',
  })
  expect(other.status).toBe(401)
})

test('a client cannot pick its own address through the internal header', async () => {
  for (let n = 0; n < 10; n++) {
    await post('/api/auth/sign-in/email', unknownAccount(), { xff: '7.7.7.7' })
  }
  const forged = await post('/api/auth/sign-in/email', unknownAccount(), {
    headers: { 'x-app-client-ip': '7.7.7.7' },
    xff: '6.6.6.6',
  })
  expect(forged.status).toBe(401)
})
