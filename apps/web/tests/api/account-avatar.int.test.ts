import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createLocalDiskStorage } from '@app/infrastructure'
import { seed } from '@app/infrastructure/testing'
import { startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

// The pictures of the social accounts as Feedway keeps them (plan 04 Task 4): who sees them, and
// the panel's answers that point to them instead of Meta's addresses.

let env: ApiEnv
let a: { id: string; slug: string }, b: { id: string; slug: string }
let owner: Person, member: Person, outsider: Person, ownerOfB: Person
const cookies = { owner: '', member: '', outsider: '', ownerOfB: '' }
let w1: string, w2: string
let inW1: string, inW2: string, unassigned: string, noPicture: string, ofB: string

const META_CDN = 'https://scontent.xx.fbcdn.net/v/p.jpg?oh=1&oe=2'
const WEBP = Buffer.concat([Buffer.from('RIFF'), randomBytes(4), Buffer.from('WEBPVP8 ')])

async function connectionOf(organizationId: string, connectedBy: string): Promise<string> {
  const id = randomUUID()
  await env.admin.pool.query(
    `insert into account_connections (id, organization_id, kind, external_user_id, connected_by,
                                      token_enc, key_version, status)
     values ($1, $2, 'meta_system_user', $3, $4, 'v1.sealed', 1, 'active')`,
    [id, organizationId, randomUUID(), connectedBy],
  )
  return id
}

/** An imported account with Meta's address; with `picture`, Feedway's copy too. */
async function account(
  organizationId: string,
  connectionId: string,
  opts: { picture?: boolean; platform?: 'instagram' | 'facebook'; pageId?: string } = {},
): Promise<string> {
  const id = randomUUID()
  const platform = opts.platform ?? 'instagram'
  const externalId = opts.pageId ?? `17${String(Date.now()).slice(-9)}${randomUUID().slice(0, 4)}`
  const key = `org/${organizationId}/accounts/${id}/avatar/${randomBytes(32).toString('hex')}`
  await env.admin.pool.query(
    `insert into social_accounts (id, organization_id, platform, external_id, name, avatar_url,
                                  avatar_key, page_id, connection_id, health)
     values ($1, $2, $3, $4, 'Forno Luce', $5, $6, $7, $8, 'ok')`,
    [
      id,
      organizationId,
      platform,
      externalId,
      META_CDN,
      opts.picture === false ? null : key,
      opts.pageId ?? null,
      connectionId,
    ],
  )
  if (opts.picture !== false) {
    // as the worker writes them, into the panel's storage
    const storage = createLocalDiskStorage({ root: env.web.mediaRoot })
    for (const file of [`${key}.webp`, `${key}-64.webp`])
      await storage.put(file, WEBP, { contentType: 'image/webp' })
  }
  return id
}

async function assign(organizationId: string, workspaceId: string, accountId: string) {
  await env.admin.pool.query(
    'insert into workspace_accounts (organization_id, workspace_id, account_id) values ($1, $2, $3)',
    [organizationId, workspaceId, accountId],
  )
}

beforeAll(async () => {
  env = await startApiEnv('account-avatar')
  a = await env.agency()
  b = await env.agency()
  owner = await env.person(a.id, 'owner')
  member = await env.person(a.id, 'member')
  outsider = await env.person(a.id, 'member')
  ownerOfB = await env.person(b.id, 'owner')
  ;({ w1, w2 } = await seed(env.tdb.runtimeUrl, async (s) => {
    const first = await s.workspace(a.id)
    const second = await s.workspace(a.id)
    await s.workspaceMember(a.id, first, member.userId, 'viewer')
    return { w1: first, w2: second }
  }))
  const conn = await connectionOf(a.id, owner.userId)
  inW1 = await account(a.id, conn)
  inW2 = await account(a.id, conn)
  unassigned = await account(a.id, conn)
  noPicture = await account(a.id, conn, { picture: false })
  await assign(a.id, w1, inW1)
  await assign(a.id, w2, inW2)
  await assign(a.id, w1, noPicture)
  ofB = await account(b.id, await connectionOf(b.id, ownerOfB.userId))
  for (const p of [owner, ownerOfB]) await env.addPasskey(p.userId)
  cookies.owner = await env.strongSignIn(owner)
  cookies.member = await env.signIn(member)
  cookies.outsider = await env.signIn(outsider)
  cookies.ownerOfB = await env.strongSignIn(ownerOfB)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

const picturePath = (slug: string, accountId: string, size = '256') =>
  `/api/v1/orgs/${slug}/accounts/${accountId}/avatar/${size}`
const get = (path: string, cookie: string) => env.call('GET', path, undefined, { cookie })

test('the Owner sees every picture of the agency, in both sizes, never cached publicly', async () => {
  for (const id of [inW1, inW2, unassigned])
    for (const size of ['256', '64']) {
      const r = await get(picturePath(a.slug, id, size), cookies.owner)
      expect(r.status, `${id} ${size}`).toBe(200)
      expect(r.headers.get('content-type')).toBe('image/webp')
      expect(r.headers.get('cache-control')).toBe('private, max-age=86400')
      expect(r.headers.get('set-cookie')).toBeNull()
    }
})

test('a Member sees only the pictures of the accounts of their workspaces', async () => {
  expect((await get(picturePath(a.slug, inW1), cookies.member)).status).toBe(200)
  for (const id of [inW2, unassigned])
    expect((await get(picturePath(a.slug, id), cookies.member)).status, id).toBe(404)
  // in no workspace at all: none
  expect((await get(picturePath(a.slug, inW1), cookies.outsider)).status).toBe(404)
})

test('an account without a picture, of another agency or unknown answers 404', async () => {
  expect((await get(picturePath(a.slug, noPicture), cookies.owner)).status).toBe(404)
  expect((await get(picturePath(a.slug, ofB), cookies.owner)).status).toBe(404)
  expect((await get(picturePath(b.slug, inW1), cookies.ownerOfB)).status).toBe(404)
  expect((await get(picturePath(a.slug, randomUUID()), cookies.owner)).status).toBe(404)
  // the agency of the path is not the person's: not found, as every other agency route
  expect((await get(picturePath(a.slug, inW1), cookies.ownerOfB)).status).toBe(404)
})

test("the panel's answers point to Feedway's pictures, never to Meta's addresses", async () => {
  const accounts = await get(`/api/v1/orgs/${a.slug}/accounts`, cookies.owner)
  const text = await accounts.text()
  expect(accounts.status, text).toBe(200)
  expect(text).not.toContain('fbcdn')
  const items = (JSON.parse(text) as { items: { id: string; avatarUrl: string | null }[] }).items
  const urlOf = (id: string) => items.find((i) => i.id === id)?.avatarUrl
  expect(urlOf(inW1)).toMatch(
    new RegExp(`^/api/v1/orgs/${a.slug}/accounts/${inW1}/avatar/256\\?v=[0-9a-f]{64}$`),
  )
  expect(urlOf(noPicture)).toBeNull()
  // the address works as it is given
  expect((await get(urlOf(inW1) ?? '', cookies.owner)).status).toBe(200)

  const profiles = await get(`/api/v1/orgs/${a.slug}/workspaces/${w1}/profiles`, cookies.member)
  const profilesText = await profiles.text()
  expect(profiles.status, profilesText).toBe(200)
  expect(profilesText).not.toContain('fbcdn')
  expect(profilesText).toContain(`/accounts/${inW1}/avatar/256?v=`)
})

test("the list of workspaces gives each one its first profile's picture", async () => {
  const r = await get(`/api/v1/orgs/${a.slug}/workspaces`, cookies.owner)
  const items = ((await r.json()) as { items: { id: string; photoUrl: string | null }[] }).items
  const photoOf = (id: string) => items.find((w) => w.id === id)?.photoUrl
  expect(photoOf(w1)).toContain(`/accounts/${inW1}/avatar/256?v=`)
  expect(photoOf(w2)).toContain(`/accounts/${inW2}/avatar/256?v=`)

  // a Member: only their workspace, and only its picture
  const mine = await get(`/api/v1/orgs/${a.slug}/workspaces`, cookies.member)
  const text = await mine.text()
  expect((JSON.parse(text) as { items: { id: string }[] }).items.map((w) => w.id)).toEqual([w1])
  expect(text).not.toContain(inW2)
})
