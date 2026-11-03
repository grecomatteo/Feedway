import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { RETENTION } from '@app/domain'
import { createLocalDiskStorage } from '@app/infrastructure'
import { errorCodeOf, startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

// Rules of the export and of the deletion (owner only, 24 hours, limits, reauth, Owner) are tested
// in the use cases and in the isolation battery; here only what HTTP adds: headers, cookies, and
// the session reaching the use case.

let env: ApiEnv
let person: Person
let agencySlug: string

beforeAll(async () => {
  env = await startApiEnv('privacy')
  const agency = await env.agency()
  agencySlug = agency.slug
  person = await env.person(agency.id, 'member')
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

test('deleting the account clears the session cookie and the session stops working', async () => {
  const leaving = await env.person((await env.agency()).id, 'member')
  const cookie = await env.signIn(leaving)
  await env.reauth(cookie)
  const r = await env.call('DELETE', '/api/v1/me', undefined, { cookie })
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ deleted: true })
  expect(r.headers.getSetCookie().join('\n')).toMatch(/__Host-session=;.*Max-Age=0/i)
  expect((await env.call('GET', '/api/v1/me', undefined, { cookie })).status).toBe(401)
})

test('the public notice needs no session and names the first agency, with the code’s values', async () => {
  const before = await env.call('GET', '/api/v1/privacy')
  expect(before.status).toBe(200)
  // a platform not activated yet: nobody to name
  expect(await before.json()).toMatchObject({ organizationName: null, controllerName: null })

  const first = (await env.agency()).id
  await env.admin.pool.query(
    `update organizations set name = 'La mia agenzia',
       settings = settings || '{"privacy":{"controllerName":"Rossi S.r.l.","contactEmail":"privacy@rossi.it"}}'
     where id = $1`,
    [first],
  )
  await env.admin.pool.query(
    `insert into settings (key, value) values ('platform.first_organization_id', to_jsonb($1::text))`,
    [first],
  )
  const r = await env.call('GET', '/api/v1/privacy')
  expect(r.status).toBe(200)
  const notice = (await r.json()) as Record<string, unknown>
  expect(notice).toMatchObject({
    organizationName: 'La mia agenzia',
    controllerName: 'Rossi S.r.l.',
    contactEmail: 'privacy@rossi.it',
    extraText: null,
    retention: RETENTION,
  })
  expect(notice.cookies).toContainEqual({
    name: '__Host-device',
    purpose: 'device',
    maxAgeSeconds: 400 * 86_400,
  })
})

test('an agency’s notice reaches its members', async () => {
  const cookie = await env.signIn(person)
  const r = await env.call('GET', `/api/v1/orgs/${agencySlug}/privacy`, undefined, { cookie })
  expect(r.status).toBe(200)
  expect(await r.json()).toMatchObject({ controllerName: null, retention: RETENTION })
})
