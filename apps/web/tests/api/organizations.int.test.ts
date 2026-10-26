import { afterAll, beforeAll, expect, test } from 'vitest'
import { errorCodeOf, startApiEnv } from './identity-env.js'
import type { ApiEnv } from './identity-env.js'

let env: ApiEnv

beforeAll(async () => {
  env = await startApiEnv('orgs')
}, 300_000)

afterAll(async () => {
  await env.stop()
})

const settingsOf = (slug: string) => `/api/v1/orgs/${slug}/settings`

test('Owner and Admin read the settings; a Member and a stranger do not', async () => {
  const agency = await env.agency()
  const owner = await env.person(agency.id, 'owner')
  const member = await env.person(agency.id, 'member')
  const ownerCookie = await env.strongSignIn(owner)
  const r = await env.call('GET', settingsOf(agency.slug), undefined, { cookie: ownerCookie })
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({
    id: agency.id,
    name: expect.any(String) as unknown,
    slug: agency.slug,
    require2fa: null,
    platformRequire2fa: 'admins',
  })
  const memberCookie = await env.signIn(member)
  expect(
    (await env.call('GET', settingsOf(agency.slug), undefined, { cookie: memberCookie })).status,
  ).toBe(403)
  const other = await env.agency()
  expect(
    (await env.call('GET', settingsOf(other.slug), undefined, { cookie: ownerCookie })).status,
  ).toBe(404)
  expect((await env.call('GET', settingsOf(agency.slug))).status).toBe(401)
})

test('only the Owner changes the settings, after a reauth, and only name and 2FA rule', async () => {
  const agency = await env.agency()
  const owner = await env.person(agency.id, 'owner')
  const adminP = await env.person(agency.id, 'admin')
  const ownerCookie = await env.strongSignIn(owner)
  const adminCookie = await env.strongSignIn(adminP)
  const patch = (body: unknown, cookie: string) =>
    env.call('PATCH', settingsOf(agency.slug), body, { cookie })

  const stale = await patch({ name: 'Agenzia Nuova' }, ownerCookie)
  expect(stale.status).toBe(403)
  expect(await errorCodeOf(stale)).toBe('REAUTH_REQUIRED')
  await env.reauth(adminCookie)
  expect((await patch({ name: 'Agenzia Nuova' }, adminCookie)).status).toBe(403)

  await env.reauth(ownerCookie)
  // mass assignment: slug, status and limits are not fields of this route
  for (const extra of [{ slug: 'altra' }, { status: 'suspended' }, { limits: { users: 999 } }])
    expect((await patch({ name: 'Agenzia Nuova', ...extra }, ownerCookie)).status).toBe(422)
  expect((await patch({ require2fa: 'nessuno' }, ownerCookie)).status).toBe(422)
  const short = await patch({ name: 'A' }, ownerCookie)
  expect(short.status).toBe(422)

  const ok = await patch({ name: 'Agenzia Nuova', require2fa: 'all' }, ownerCookie)
  expect(ok.status).toBe(200)
  expect(await ok.json()).toMatchObject({
    name: 'Agenzia Nuova',
    slug: agency.slug,
    require2fa: 'all',
  })
})
