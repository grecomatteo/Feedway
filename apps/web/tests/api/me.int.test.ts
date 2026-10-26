import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { PASSWORD, errorCodeOf, startApiEnv } from './identity-env.js'
import type { ApiEnv } from './identity-env.js'

let env: ApiEnv

beforeAll(async () => {
  env = await startApiEnv('me')
}, 300_000)

afterAll(async () => {
  await env.stop()
})

const get = (path: string, cookie?: string) => env.call('GET', path, undefined, { cookie })

test('me answers the person and the session state, with nothing else', async () => {
  const agency = await env.agency()
  const person = await env.person(agency.id, 'member', { name: 'Giulia Verdi' })
  const cookie = await env.signIn(person)

  const r = await get('/api/v1/me', cookie)
  expect(r.status).toBe(200)
  const me = (await r.json()) as Record<string, unknown>
  expect(Object.keys(me).sort()).toEqual(
    [
      'avatarUrl',
      'displayName',
      'email',
      'id',
      'lastOrganizationSlug',
      'locale',
      'name',
      'nickname',
      'organizations',
      'platformRole',
      'secondFactor',
      'sessionState',
      'theme',
      'timezone',
    ].sort(),
  )
  expect(me).toMatchObject({
    id: person.userId,
    email: person.email,
    displayName: 'Giulia Verdi',
    sessionState: 'active',
    organizations: [{ id: agency.id, slug: agency.slug, role: 'member', status: 'active' }],
    secondFactor: { required: false, totpEnabled: false, passkeys: 0 },
  })

  expect((await get('/api/v1/me')).status).toBe(401)
})

test('second factor required session reaches only enrollment', async () => {
  const agency = await env.agency()
  const orgAdminWithoutSecondFactor = await env.person(agency.id, 'admin')
  const c = await env.signIn(orgAdminWithoutSecondFactor)
  expect((await get(`/api/v1/orgs/${agency.slug}/workspaces`, c)).status).toBe(403)
  const me = await get('/api/v1/me', c)
  expect(me.status).toBe(200)
  expect(await me.json()).toMatchObject({ sessionState: 'second_factor_required' })
  expect((await get('/api/v1/me/sessions', c)).status).toBe(403)
  expect(
    (await env.call('POST', '/api/auth/two-factor/enable', { password: PASSWORD }, { cookie: c }))
      .status,
  ).toBe(200)
})

test('my agencies list only the active memberships', async () => {
  const kept = await env.agency()
  const dropped = await env.agency()
  const person = await env.person(kept.id, 'member')
  await env.admin.pool.query(
    `insert into organization_members (organization_id, user_id, role, status) values ($1, $2, 'member', 'disabled')`,
    [dropped.id, person.userId],
  )
  const cookie = await env.signIn(person)
  const r = await get('/api/v1/me/organizations', cookie)
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({
    items: [
      {
        id: kept.id,
        slug: kept.slug,
        name: expect.any(String) as unknown,
        role: 'member',
        status: 'active',
      },
    ],
  })
})

test('the second factor overview lists passkeys without their keys', async () => {
  const agency = await env.agency()
  const person = await env.person(agency.id, 'member')
  await env.addPasskey(person.userId)
  const cookie = await env.strongSignIn(person)
  const r = await get('/api/v1/me/second-factor', cookie)
  expect(r.status).toBe(200)
  const body = (await r.json()) as { passkeys: Record<string, unknown>[] }
  expect(body).toMatchObject({ required: false, totpEnabled: false })
  expect(body.passkeys).toHaveLength(1)
  expect(Object.keys(body.passkeys[0] ?? {}).sort()).toEqual(
    ['backedUp', 'createdAt', 'deviceType', 'id', 'name'].sort(),
  )
})

test('sessions are listed without tokens and revoked only for their owner', async () => {
  const agency = await env.agency()
  const person = await env.person(agency.id, 'member')
  const stranger = await env.person(agency.id, 'member')
  const first = await env.signIn(person)
  const second = await env.signIn(person)
  const strangerCookie = await env.signIn(stranger)

  const listed = await get('/api/v1/me/sessions', first)
  expect(listed.status).toBe(200)
  const { items } = (await listed.json()) as { items: Record<string, unknown>[] }
  expect(items).toHaveLength(2)
  for (const s of items)
    expect(Object.keys(s).sort()).toEqual(
      ['createdAt', 'current', 'device', 'id', 'ipApprox', 'lastActiveAt'].sort(),
    )
  expect(items.filter((s) => s.current)).toHaveLength(1)
  const other = items.find((s) => !s.current)
  const token = decodeURIComponent(first.split('=')[1] ?? '').split('.')[0] ?? ''
  expect(token.length).toBeGreaterThan(10)
  expect(JSON.stringify(items)).not.toContain(token)

  // someone else's session answers like a missing one, and stays
  const theirs = await get('/api/v1/me/sessions', strangerCookie)
  const theirId = ((await theirs.json()) as { items: { id: string }[] }).items[0]?.id
  const foreign = await env.call('DELETE', `/api/v1/me/sessions/${String(theirId)}`, undefined, {
    cookie: first,
  })
  expect(foreign.status).toBe(404)
  expect((await get('/api/v1/me', strangerCookie)).status).toBe(200)
  expect(
    (await env.call('DELETE', `/api/v1/me/sessions/${randomUUID()}`, undefined, { cookie: first }))
      .status,
  ).toBe(404)
  expect(
    (await env.call('DELETE', '/api/v1/me/sessions/non-un-id', undefined, { cookie: first }))
      .status,
  ).toBe(422)

  const revoked = await env.call('DELETE', `/api/v1/me/sessions/${String(other?.id)}`, undefined, {
    cookie: first,
  })
  expect(revoked.status).toBe(200)
  expect((await get('/api/v1/me', second)).status).toBe(401)
  expect((await get('/api/v1/me', first)).status).toBe(200)

  // a mutation without the panel's header never reaches the use case
  const forged = await env.call('DELETE', '/api/v1/me/sessions', undefined, {
    cookie: first,
    omitAppHeader: true,
  })
  expect(forged.status).toBe(403)
  const all = await env.call('DELETE', '/api/v1/me/sessions', undefined, { cookie: first })
  expect(all.status).toBe(200)
  expect(await all.json()).toEqual({ revoked: 1 })
  expect((await get('/api/v1/me', first)).status).toBe(401)
})

test('reauth checks the password and marks the session', async () => {
  const agency = await env.agency()
  const person = await env.person(agency.id, 'member')
  const cookie = await env.signIn(person)
  const reauth = (body: unknown) => env.call('POST', '/api/v1/auth/reauth', body, { cookie })

  const wrong = await reauth({ password: 'password-sbagliata-davvero' })
  expect(wrong.status).toBe(401)
  expect(await errorCodeOf(wrong)).toBe('UNAUTHENTICATED')
  expect((await reauth({ password: PASSWORD, userId: randomUUID() })).status).toBe(422)
  expect((await reauth({})).status).toBe(422)
  expect((await env.call('POST', '/api/v1/auth/reauth', { password: PASSWORD })).status).toBe(401)

  const ok = await reauth({ password: PASSWORD })
  expect(ok.status).toBe(200)
  expect(await ok.json()).toEqual({ reauthenticated: true })
  const { rows } = await env.admin.pool.query<{ reauthenticated_at: Date | null }>(
    'select reauthenticated_at from sessions where user_id = $1',
    [person.userId],
  )
  expect(rows[0]?.reauthenticated_at).toBeInstanceOf(Date)
})

test('reauth allows few attempts per address', async () => {
  const headers = { 'x-forwarded-for': '10.99.0.1' }
  for (let n = 0; n < 10; n++)
    expect(
      (await env.call('POST', '/api/v1/auth/reauth', { password: 'x' }, { headers })).status,
    ).toBe(401)
  const blocked = await env.call('POST', '/api/v1/auth/reauth', { password: 'x' }, { headers })
  expect(blocked.status).toBe(429)
})
