import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { PANEL, errorCodeOf, startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

let env: ApiEnv

beforeAll(async () => {
  env = await startApiEnv('users')
}, 300_000)

afterAll(async () => {
  await env.stop()
})

const get = (path: string, cookie?: string) => env.call('GET', path, undefined, { cookie })
const post = (path: string, body: unknown, cookie?: string) =>
  env.call('POST', path, body, { cookie })
const put = (path: string, body: unknown, cookie?: string) =>
  env.call('PUT', path, body, { cookie })

/** An agency with an Owner, an Admin (with a passkey) and a Member, all signed in. */
async function agencyA() {
  const agency = await env.agency()
  const owner = await env.person(agency.id, 'owner')
  const adminA = await env.person(agency.id, 'admin')
  const member = await env.person(agency.id, 'member')
  await env.addPasskey(adminA.userId)
  return {
    agency,
    owner,
    adminA,
    member,
    ownerCookie: await env.strongSignIn(owner),
    adminCookie: await env.strongSignIn(adminA),
    memberCookie: await env.signIn(member),
  }
}

const memberPath = (slug: string, p: Person, action: string) =>
  `/api/v1/orgs/${slug}/members/${p.userId}/${action}`

test('the member list answers the DTO to Owner and Admin, 403 to a Member', async () => {
  const a = await agencyA()
  const r = await get(`/api/v1/orgs/${a.agency.slug}/members`, a.adminCookie)
  expect(r.status).toBe(200)
  const { items } = (await r.json()) as { items: Record<string, unknown>[] }
  expect(items).toHaveLength(3)
  for (const m of items)
    expect(Object.keys(m).sort()).toEqual(
      [
        'avatarUrl',
        'displayName',
        'email',
        'id',
        'lastLoginAt',
        'name',
        'nickname',
        'orgRole',
        'secondFactorConfigured',
        'status',
        'workspaces',
      ].sort(),
    )
  expect(items.find((m) => m.id === a.adminA.userId)).toMatchObject({
    orgRole: 'admin',
    secondFactorConfigured: true,
  })
  const forbidden = await get(`/api/v1/orgs/${a.agency.slug}/members`, a.memberCookie)
  expect(forbidden.status).toBe(403)

  // another agency answers like one that does not exist
  const other = await env.agency()
  expect((await get(`/api/v1/orgs/${other.slug}/members`, a.adminCookie)).status).toBe(404)
  expect((await get(`/api/v1/orgs/agenzia-inesistente/members`, a.adminCookie)).status).toBe(404)
})

test('an invite answers the link to copy; naming an Admin needs the Owner and a reauth', async () => {
  const a = await agencyA()
  const path = `/api/v1/orgs/${a.agency.slug}/invites`
  const ok = await post(path, { email: 'nuova@example.test', orgRole: 'member' }, a.adminCookie)
  expect(ok.status).toBe(200)
  const body = (await ok.json()) as { url: string; expiresAt: string }
  expect(Object.keys(body).sort()).toEqual(['expiresAt', 'url'])
  expect(body.url.startsWith(`${PANEL}/`)).toBe(true)

  const asAdmin = await post(path, { email: 'capo@example.test', orgRole: 'admin' }, a.adminCookie)
  expect(asAdmin.status).toBe(403)
  const stale = await post(path, { email: 'capo@example.test', orgRole: 'admin' }, a.ownerCookie)
  expect(stale.status).toBe(403)
  expect(await errorCodeOf(stale)).toBe('REAUTH_REQUIRED')
  await env.reauth(a.ownerCookie)
  expect(
    (await post(path, { email: 'capo@example.test', orgRole: 'admin' }, a.ownerCookie)).status,
  ).toBe(200)

  // no other field can be slipped in (the agency, who invited, the expiry)
  const extra = await post(
    path,
    { email: 'x@example.test', orgRole: 'member', organizationId: randomUUID() },
    a.adminCookie,
  )
  expect(extra.status).toBe(422)
  expect(
    (await post(path, { email: 'x@example.test', orgRole: 'owner' }, a.ownerCookie)).status,
  ).toBe(422)
})

test('invites and reset links are limited per address', async () => {
  const headers = { 'x-forwarded-for': '10.98.0.1' }
  for (let n = 0; n < 30; n++) {
    const r = await env.call('POST', '/api/v1/orgs/x/invites', {}, { headers })
    expect(r.status).toBe(401)
  }
  expect((await env.call('POST', '/api/v1/orgs/x/invites', {}, { headers })).status).toBe(429)
  const reset = `/api/v1/orgs/x/members/${randomUUID()}/password-reset-link`
  for (let n = 0; n < 10; n++)
    expect((await env.call('POST', reset, undefined, { headers })).status).toBe(401)
  expect((await env.call('POST', reset, undefined, { headers })).status).toBe(429)
})

test('a reset link needs a recent reauth and a person of this agency', async () => {
  const a = await agencyA()
  const stale = await post(
    memberPath(a.agency.slug, a.member, 'password-reset-link'),
    undefined,
    a.adminCookie,
  )
  expect(stale.status).toBe(403)
  expect(await errorCodeOf(stale)).toBe('REAUTH_REQUIRED')
  await env.reauth(a.adminCookie)
  const ok = await post(
    memberPath(a.agency.slug, a.member, 'password-reset-link'),
    undefined,
    a.adminCookie,
  )
  expect(ok.status).toBe(200)
  expect(Object.keys((await ok.json()) as object)).toEqual(['url'])

  // IDOR: a person of another agency, through this agency's path, is not found
  const b = await agencyA()
  const foreign = await post(
    memberPath(a.agency.slug, b.member, 'password-reset-link'),
    undefined,
    a.adminCookie,
  )
  expect(foreign.status).toBe(404)
  expect(
    (
      await post(
        `/api/v1/orgs/${a.agency.slug}/members/non-un-id/password-reset-link`,
        undefined,
        a.adminCookie,
      )
    ).status,
  ).toBe(422)
})

test('disabling signs the person out; enabling again needs a reauth', async () => {
  const a = await agencyA()
  const disabled = await post(
    memberPath(a.agency.slug, a.member, 'disable'),
    undefined,
    a.adminCookie,
  )
  expect(disabled.status).toBe(200)
  expect(await disabled.json()).toEqual({ status: 'disabled' })
  expect((await get('/api/v1/me', a.memberCookie)).status).toBe(401)

  const stale = await post(memberPath(a.agency.slug, a.member, 'enable'), undefined, a.adminCookie)
  expect(stale.status).toBe(403)
  expect(await errorCodeOf(stale)).toBe('REAUTH_REQUIRED')
  await env.reauth(a.adminCookie)
  const enabled = await post(
    memberPath(a.agency.slug, a.member, 'enable'),
    undefined,
    a.adminCookie,
  )
  expect(enabled.status).toBe(200)
  expect(await enabled.json()).toEqual({ status: 'active' })

  // an Admin never touches the Owner; a Member touches nobody
  expect(
    (await post(memberPath(a.agency.slug, a.owner, 'disable'), undefined, a.adminCookie)).status,
  ).toBe(403)
  const memberCookie = await env.signIn(a.member)
  expect(
    (await post(memberPath(a.agency.slug, a.adminA, 'disable'), undefined, memberCookie)).status,
  ).toBe(403)
  // IDOR: the Admin of another agency cannot reach these people through its own agency
  const b = await agencyA()
  expect(
    (await post(memberPath(b.agency.slug, a.member, 'disable'), undefined, b.adminCookie)).status,
  ).toBe(404)
  expect((await get('/api/v1/me', memberCookie)).status).toBe(200)
})

test('role change revokes sessions', async () => {
  const a = await agencyA()
  const memberId = a.member.userId
  const ownerACookie = a.ownerCookie
  const memberCookie = a.memberCookie
  const path = `/api/v1/orgs/${a.agency.slug}/members/${memberId}/role`
  const stale = await put(path, { role: 'admin' }, ownerACookie)
  expect(stale.status).toBe(403)
  expect(await errorCodeOf(stale)).toBe('REAUTH_REQUIRED')
  expect((await get('/api/v1/me', memberCookie)).status).toBe(200)

  await env.reauth(ownerACookie)
  const changed = await put(path, { role: 'admin' }, ownerACookie)
  expect(changed.status).toBe(200)
  expect(await changed.json()).toEqual({ role: 'admin' })
  expect((await get('/api/v1/me', memberCookie)).status).toBe(401)

  await env.reauth(a.adminCookie)
  expect((await put(path, { role: 'member' }, a.adminCookie)).status).toBe(403)
  expect((await put(path, { role: 'owner' }, ownerACookie)).status).toBe(422)
})

test('ownership transfer route needs the owner and a recent reauth', async () => {
  const a = await agencyA()
  const adminAId = a.adminA.userId
  const path = `/api/v1/orgs/${a.agency.slug}/ownership-transfer`
  const staleOwnerACookie = a.ownerCookie
  expect((await post(path, { userId: adminAId }, staleOwnerACookie)).status).toBe(403)

  const freshAdminACookie = a.adminCookie
  await env.reauth(freshAdminACookie)
  expect((await post(path, { userId: adminAId }, freshAdminACookie)).status).toBe(403)

  await env.reauth(a.ownerCookie)
  const freshOwnerACookie = a.ownerCookie
  expect((await post(path, { userId: a.member.userId }, freshOwnerACookie)).status).toBe(403)
  const transferred = await post(path, { userId: adminAId }, freshOwnerACookie)
  expect(transferred.status).toBe(200)
  expect(await transferred.json()).toEqual({ transferred: true })

  const { rows } = await env.admin.pool.query<{ user_id: string; role: string }>(
    'select user_id, role from organization_members where organization_id = $1',
    [a.agency.id],
  )
  expect(rows.find((r) => r.user_id === adminAId)?.role).toBe('owner')
  expect(rows.find((r) => r.user_id === a.owner.userId)?.role).toBe('admin')
  // both sign in again with their new role
  expect((await get('/api/v1/me', freshOwnerACookie)).status).toBe(401)
  expect((await get('/api/v1/me', freshAdminACookie)).status).toBe(401)
})
