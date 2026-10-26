import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { HealthResponse, ReadyResponse } from '@app/contracts'
import { startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { startWeb, uuidRe, waitFor } from './helpers.js'
import type { RunningWeb } from './helpers.js'

let tdb: TestDatabase
let web: RunningWeb
const url = (path: string) => web.url(path)

beforeAll(async () => {
  tdb = await startTestDatabase()
  web = await startWeb({
    DATABASE_URL: tdb.runtimeUrl,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    PANEL_URL: 'http://localhost:3000',
    APP_VERSION: '0.0.0-test',
  })
}, 300_000)

afterAll(async () => {
  await web.stop()
  await tdb.stop()
})

test('health is ok and carries request id', async () => {
  const r = await fetch(url('/api/health'))
  expect(r.status).toBe(200)
  expect(HealthResponse.parse(await r.json()).version).toBe('0.0.0-test')
  expect(r.headers.get('x-request-id')).toMatch(uuidRe)
})

test('the email logo is served to anyone, without a session', async () => {
  const r = await fetch(url('/email/feedway-logo@2x.png'), { redirect: 'manual' })
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toBe('image/png')
  expect(r.headers.get('set-cookie')).toBeNull()
  const png = Buffer.from(await r.arrayBuffer())
  expect(png.subarray(1, 4).toString()).toBe('PNG')
})

test('client supplied request id is ignored', async () => {
  const r = await fetch(url('/api/health'), { headers: { 'x-request-id': 'evil' } })
  expect(r.headers.get('x-request-id')).not.toBe('evil')
})

test('ready recovers after database restart', async () => {
  const up = await fetch(url('/api/ready'))
  expect(up.status).toBe(200)
  expect(ReadyResponse.parse(await up.json())).toEqual({ db: 'ok', queue: 'ok' })

  await tdb.stopContainerOnly()
  const down = await fetch(url('/api/ready'))
  expect(down.status).toBe(503)
  expect(await down.json()).toEqual({ db: 'error', queue: 'error' })
  expect((await fetch(url('/api/health'))).status).toBe(200)

  await tdb.startContainerOnly()
  await waitFor(async () => (await fetch(url('/api/ready'))).status === 200, 60_000)
}, 180_000)

test('internal errors are generic', async () => {
  const r = await fetch(url('/api/__test/throw'))
  const body = (await r.json()) as { error: { code: string; requestId: string } }
  expect(r.status).toBe(500)
  expect(body.error.code).toBe('INTERNAL')
  expect(body.error.requestId).toMatch(uuidRe)
  expect(JSON.stringify(body)).not.toContain('boom')
})
