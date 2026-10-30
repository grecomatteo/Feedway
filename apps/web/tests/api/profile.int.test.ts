import { afterAll, beforeAll, expect, test } from 'vitest'
import { errorCodeOf, startApiEnv } from './identity-env.js'
import type { ApiEnv } from './identity-env.js'

let env: ApiEnv

beforeAll(async () => {
  env = await startApiEnv('profile')
}, 300_000)

afterAll(async () => {
  await env.stop()
})

test('the profile changes through PATCH /api/v1/me and the answer is the new me', async () => {
  const agency = await env.agency()
  const person = await env.person(agency.id, 'member', { name: 'Matteo Greco' })
  const cookie = await env.signIn(person)
  const r = await env.call(
    'PATCH',
    '/api/v1/me',
    { nickname: 'Teo', theme: 'dark', timezone: 'Europe/Paris' },
    { cookie },
  )
  expect(r.status).toBe(200)
  expect(await r.json()).toMatchObject({
    id: person.userId,
    name: 'Matteo Greco',
    nickname: 'Teo',
    displayName: 'Teo',
    theme: 'dark',
    timezone: 'Europe/Paris',
    sessionState: 'active',
  })
  // what another device reads after signing in
  const elsewhere = await env.signIn(person)
  expect(
    await (await env.call('GET', '/api/v1/me', undefined, { cookie: elsewhere })).json(),
  ).toMatchObject({ theme: 'dark', displayName: 'Teo' })

  const wrong = await env.call('PATCH', '/api/v1/me', { timezone: 'Europe/Roma' }, { cookie })
  expect(wrong.status).toBe(422)
  expect(await errorCodeOf(wrong)).toBe('VALIDATION')
  // fields the contract does not know are refused, never written
  const extra = await env.call('PATCH', '/api/v1/me', { email: 'altro@example.test' }, { cookie })
  expect(extra.status).toBe(422)
  expect((await env.call('PATCH', '/api/v1/me', { theme: 'light' })).status).toBe(401)
})

/** The confirmation link queued for the worker (the web tests run no worker). */
async function queuedConfirmToken(userId: string): Promise<string> {
  const { rows } = await env.admin.pool.query<{ data: { url: string } }>(
    `select data from pgboss.job where name = 'identity.email_change' and data->>'userId' = $1
     order by created_on desc limit 1`,
    [userId],
  )
  const url = rows[0]?.data.url
  if (url === undefined) throw new Error('no email change job')
  const token = new URL(url).searchParams.get('t')
  if (token === null) throw new Error('no token in the link')
  return token
}

test('email change over HTTP: reauth, a link to the new address, confirmed without a session', async () => {
  const agency = await env.agency()
  const person = await env.person(agency.id, 'member')
  const cookie = await env.signIn(person)
  const newEmail = `nuovo-${person.userId.slice(0, 8)}@example.test`

  const stale = await env.call('POST', '/api/auth/change-email', { newEmail }, { cookie })
  expect(stale.status).toBe(403)

  await env.reauth(cookie)
  const asked = await env.call('POST', '/api/auth/change-email', { newEmail }, { cookie })
  expect(asked.status).toBe(200)
  const token = await queuedConfirmToken(person.userId)

  const confirmed = await env.call('POST', '/api/v1/email-change/confirm', { token })
  expect(confirmed.status).toBe(200)
  expect(await confirmed.json()).toEqual({ email: newEmail })
  // no session is opened by the link
  expect(confirmed.headers.getSetCookie().some((c) => c.startsWith('__Host-session='))).toBe(false)
  const again = await env.call('POST', '/api/v1/email-change/confirm', { token })
  expect(again.status).toBe(410)
  expect(await errorCodeOf(again)).toBe('LINK_INVALID')

  const me = await env.call('GET', '/api/v1/me', undefined, { cookie })
  expect(await me.json()).toMatchObject({ email: newEmail })
  expect((await env.call('GET', '/api/auth/verify-email?token=x')).status).toBe(404)
})
