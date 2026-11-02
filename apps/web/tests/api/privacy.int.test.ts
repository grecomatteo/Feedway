import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { errorCodeOf, startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

let env: ApiEnv
let person: Person, colleague: Person
const cookies: Record<string, string> = {}

beforeAll(async () => {
  env = await startApiEnv('privacy')
  const org = (await env.agency()).id
  person = await env.person(org, 'member')
  colleague = await env.person(org, 'member')
  cookies['person'] = await env.signIn(person)
  cookies['colleague'] = await env.signIn(colleague)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

/** A finished archive of `userId`, as the worker leaves it. */
async function readyExport(userId: string, expiresIn: string) {
  const id = randomUUID()
  const key = `users/${userId}/exports/${id}.zip`
  await mkdir(join(env.web.mediaRoot, 'users', userId, 'exports'), { recursive: true })
  // the storage's own format: a header line with the content type, then the bytes
  await writeFile(
    join(env.web.mediaRoot, key),
    `${JSON.stringify({ contentType: 'application/zip' })}\nPK zip bytes`,
  )
  await env.admin.pool.query(
    `insert into data_exports (id, user_id, status, storage_key, expires_at, created_at)
     values ($1, $2, 'ready', $3, now() + $4::interval, '2026-10-30T23:30:00Z')`,
    [id, userId, key, expiresIn],
  )
  return id
}

const download = (id: string, cookie: string) =>
  env.call('GET', `/api/v1/me/exports/${id}/download`, undefined, { cookie })

test('a request is prepared once and shown with its status', async () => {
  const first = await env.call('POST', '/api/v1/me/exports', undefined, {
    cookie: cookies['person'],
  })
  expect(first.status).toBe(200)
  const created = (await first.json()) as { id: string; status: string; expiresAt: null }
  expect(created).toMatchObject({ status: 'pending', expiresAt: null })
  const again = await env.call('POST', '/api/v1/me/exports', undefined, {
    cookie: cookies['person'],
  })
  expect(((await again.json()) as { id: string }).id).toBe(created.id)
  const list = await env.call('GET', '/api/v1/me/exports', undefined, {
    cookie: cookies['person'],
  })
  expect(((await list.json()) as { items: { id: string }[] }).items[0]?.id).toBe(created.id)
  // still being prepared: nothing to download yet
  const early = await download(created.id, cookies['person'] ?? '')
  expect(early.status).toBe(409)
  // a colleague sees none of it
  const other = await env.call('GET', '/api/v1/me/exports', undefined, {
    cookie: cookies['colleague'],
  })
  expect(await other.json()).toEqual({ items: [] })
})

test('the archive downloads as an attachment, only for its owner, until it expires', async () => {
  const id = await readyExport(person.userId, '1 day')
  const own = await download(id, cookies['person'] ?? '')
  expect(own.status).toBe(200)
  expect(own.headers.get('content-type')).toBe('application/zip')
  expect(own.headers.get('content-disposition')).toBe(
    'attachment; filename="dati-personali-2026-10-30.zip"',
  )
  expect(own.headers.get('cache-control')).toBe('private, no-store')
  expect(await own.text()).toBe('PK zip bytes')

  const foreign = await download(id, cookies['colleague'] ?? '')
  expect(foreign.status).toBe(404)
  expect(await errorCodeOf(foreign)).toBe('NOT_FOUND')

  const expired = await readyExport(person.userId, '-1 minute')
  const late = await download(expired, cookies['person'] ?? '')
  expect(late.status).toBe(410)
  expect(await errorCodeOf(late)).toBe('LINK_INVALID')
})

test('without a session nothing is answered', async () => {
  const id = await readyExport(person.userId, '1 day')
  expect((await env.call('GET', `/api/v1/me/exports/${id}/download`)).status).toBe(401)
  expect((await env.call('POST', '/api/v1/me/exports')).status).toBe(401)
})
