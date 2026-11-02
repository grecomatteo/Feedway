import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createLocalDiskStorage } from '@app/infrastructure'
import { errorCodeOf, startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

// Rules of the export (owner only, 24 hours, limits, reauth) are tested in the use case and in
// the isolation battery; here only what HTTP adds: headers, and the session reaching the use case.

let env: ApiEnv
let person: Person

beforeAll(async () => {
  env = await startApiEnv('privacy')
  const org = (await env.agency()).id
  person = await env.person(org, 'member')
}, 300_000)

afterAll(async () => {
  await env.stop()
})

/** A finished archive, as the worker leaves it. */
async function readyExport(userId: string) {
  const id = randomUUID()
  const key = `users/${userId}/exports/${id}.zip`
  await createLocalDiskStorage({ root: env.web.mediaRoot }).put(key, Buffer.from('PK zip bytes'), {
    contentType: 'application/zip',
  })
  await env.admin.pool.query(
    `insert into data_exports (id, user_id, status, storage_key, expires_at, created_at)
     values ($1, $2, 'ready', $3, now() + interval '1 day', '2026-10-30T10:30:00Z')`,
    [id, userId, key],
  )
  return id
}

test('the archive is sent as a private attachment', async () => {
  const id = await readyExport(person.userId)
  const cookie = await env.signIn(person)
  await env.reauth(cookie)
  const r = await env.call('GET', `/api/v1/me/exports/${id}/download`, undefined, { cookie })
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toBe('application/zip')
  expect(r.headers.get('content-disposition')).toBe(
    'attachment; filename="dati-personali-2026-10-30.zip"',
  )
  expect(r.headers.get('cache-control')).toBe('private, no-store')
  expect(await r.text()).toBe('PK zip bytes')
})

test('the routes hand the session to the use case: without a recent confirmation, 403', async () => {
  const cookie = await env.signIn(person)
  const r = await env.call('POST', '/api/v1/me/exports', undefined, { cookie })
  expect(r.status).toBe(403)
  expect(await errorCodeOf(r)).toBe('REAUTH_REQUIRED')
})
