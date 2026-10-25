import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { startWeb } from './helpers.js'
import type { RunningWeb } from './helpers.js'

let tdb: TestDatabase
let web: RunningWeb

beforeAll(async () => {
  tdb = await startTestDatabase()
  web = await startWeb({
    DATABASE_URL: tdb.runtimeUrl,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    PANEL_URL: 'https://pannello.example.ts.net',
  })
}, 300_000)

afterAll(async () => {
  await web.stop()
  await tdb.stop()
})

test('security headers are present', async () => {
  const r = await fetch(web.url('/'))
  const csp = r.headers.get('content-security-policy') ?? ''
  expect(csp).toMatch(/script-src[^;]*'nonce-/)
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain("object-src 'none'")
  expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  expect(r.headers.get('referrer-policy')).toBe('same-origin')
  expect(r.headers.get('permissions-policy')).toContain('camera=()')
})

test('hsts is sent when the panel url is https, once and with our value', async () => {
  for (const path of ['/api/health', '/']) {
    const r = await fetch(web.url(path))
    expect(r.headers.get('strict-transport-security'), path).toBe(
      'max-age=31536000; includeSubDomains',
    )
  }
})

test('pages cannot be framed and no origin may read them', async () => {
  const r = await fetch(web.url('/'), { headers: { origin: 'http://localhost:3000' } })
  expect(r.headers.get('x-frame-options')).toBe('DENY')
  expect(r.headers.get('access-control-allow-origin')).toBeNull()
  const preflight = await fetch(web.url('/api/v1/security/lock'), {
    method: 'OPTIONS',
    headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST' },
  })
  expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
  expect(preflight.headers.get('access-control-allow-methods')).toBeNull()
})
