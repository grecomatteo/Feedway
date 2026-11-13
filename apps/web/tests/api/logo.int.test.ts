import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  alphaAt,
  imageFixture,
  imageInfo,
  pngOfSize,
  transparentLogoPng,
} from '@app/infrastructure/testing'
import { errorCodeOf, startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

let env: ApiEnv
let a: { id: string; slug: string }, b: { id: string; slug: string }
let owner: Person, admin: Person, member: Person, ownerOfB: Person
const cookies: Record<'owner' | 'admin' | 'member' | 'ownerOfB', string> = {
  owner: '',
  admin: '',
  member: '',
  ownerOfB: '',
}

beforeAll(async () => {
  env = await startApiEnv('logo')
  a = await env.agency()
  b = await env.agency()
  owner = await env.person(a.id, 'owner')
  admin = await env.person(a.id, 'admin')
  member = await env.person(a.id, 'member')
  ownerOfB = await env.person(b.id, 'owner')
  for (const p of [owner, admin, ownerOfB]) await env.addPasskey(p.userId)
  cookies.owner = await env.strongSignIn(owner)
  cookies.admin = await env.strongSignIn(admin)
  cookies.member = await env.signIn(member)
  cookies.ownerOfB = await env.strongSignIn(ownerOfB)
  for (const c of [cookies.owner, cookies.admin, cookies.ownerOfB]) await env.reauth(c)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

function form(bytes: Buffer, type = 'image/png', name = 'logo.png'): FormData {
  const data = new FormData()
  data.append('file', new Blob([new Uint8Array(bytes)], { type }), name)
  return data
}

const logoPath = (slug: string, rest = '') => `/api/v1/orgs/${slug}/logo${rest}`
const upload = (cookie: string, bytes: Buffer, slug = a.slug) =>
  env.call('POST', logoPath(slug), form(bytes), { cookie })
const get = (path: string, cookie: string) => env.call('GET', path, undefined, { cookie })

interface Source {
  stagingId: string
  width: number
  height: number
  previewUrl: string
}

async function setLogo(bytes: Buffer): Promise<string> {
  const r = await upload(cookies.owner, bytes)
  expect(r.status, await r.clone().text()).toBe(200)
  const source = (await r.json()) as Source
  const confirmed = await env.call(
    'POST',
    logoPath(a.slug, '/confirm'),
    { stagingId: source.stagingId },
    { cookie: cookies.owner },
  )
  expect(confirmed.status, await confirmed.clone().text()).toBe(200)
  return ((await confirmed.json()) as { logoUrl: string }).logoUrl
}

/** Every file under the folder, relative to the media root, sorted. */
async function storageKeys(prefix: string): Promise<string[]> {
  const entries = await readdir(join(env.web.mediaRoot, prefix), {
    recursive: true,
    withFileTypes: true,
  }).catch(() => [])
  return entries
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(env.web.mediaRoot.length + 1))
    .sort()
}

const myOrganization = async (cookie: string, slug: string) => {
  const me = (await (await get('/api/v1/me', cookie)).json()) as {
    organizations: { slug: string; logoUrl: string | null }[]
  }
  return me.organizations.find((o) => o.slug === slug)
}

test('an Admin or a Member does not change the logo', async () => {
  const logo = await transparentLogoPng()
  for (const cookie of [cookies.admin, cookies.member]) {
    const r = await upload(cookie, logo)
    expect(r.status).toBe(403)
    expect(await errorCodeOf(r)).toBe('FORBIDDEN')
    const confirm = await env.call(
      'POST',
      logoPath(a.slug, '/confirm'),
      { stagingId: crypto.randomUUID() },
      { cookie },
    )
    expect(confirm.status).toBe(403)
    const remove = await env.call('DELETE', logoPath(a.slug), undefined, { cookie })
    expect(remove.status).toBe(403)
  }
  expect(await storageKeys(`org/${a.id}/logo`)).toEqual([])
})

test('the Owner needs a recent reauth to change the logo', async () => {
  const fresh = await env.strongSignIn(owner)
  const r = await upload(fresh, await transparentLogoPng())
  expect(r.status).toBe(403)
  expect(await errorCodeOf(r)).toBe('REAUTH_REQUIRED')
})

test('wrong type is 415, a huge png is 422, a thin logo passes', async () => {
  const gif = await upload(cookies.owner, await imageFixture('anim.gif'))
  expect(gif.status).toBe(415)
  const huge = await upload(cookies.owner, await pngOfSize(8000, 6000))
  expect(huge.status).toBe(422)
  const thin = await upload(cookies.owner, await transparentLogoPng(600, 40))
  expect(thin.status, await thin.clone().text()).toBe(200)
  expect(await thin.json()).toMatchObject({ width: 600, height: 40 })
})

test('a transparent PNG stays transparent, fitted whole in the square', async () => {
  const url = await setLogo(await transparentLogoPng(600, 200))
  expect(url).toMatch(new RegExp(`^/api/v1/orgs/${a.slug}/logo/256\\?v=[0-9a-f]{64}$`))
  const large = await get(url, cookies.member)
  expect(large.status).toBe(200)
  expect(large.headers.get('content-type')).toBe('image/webp')
  expect(large.headers.get('cache-control')).toBe('private, max-age=86400')
  const bytes = Buffer.from(await large.arrayBuffer())
  expect(await imageInfo(bytes)).toMatchObject({ width: 256, height: 256, hasAlpha: true })
  // above the logo, transparent; in its middle, opaque
  expect(await alphaAt(bytes, 128, 5)).toBe(0)
  expect(await alphaAt(bytes, 128, 128)).toBe(255)
  const small = await get(url.replace('/256', '/64'), cookies.admin)
  expect((await imageInfo(Buffer.from(await small.arrayBuffer()))).width).toBe(64)
  // every member sees it in the switcher; the preview is gone
  expect((await myOrganization(cookies.member, a.slug))?.logoUrl).toBe(url)
  expect((await storageKeys(`org/${a.id}/logo`)).filter((k) => k.includes('staging'))).toEqual([])
})

test('the preview is for the Owner only, and another agency never sees the logo', async () => {
  const r = await upload(cookies.owner, await transparentLogoPng())
  const source = (await r.json()) as Source
  expect((await get(source.previewUrl, cookies.owner)).status).toBe(200)
  expect((await get(source.previewUrl, cookies.admin)).status).toBe(403)
  // the same staging id under B's path is B's folder: nothing there
  const inB = source.previewUrl.replace(a.slug, b.slug)
  expect((await get(inB, cookies.ownerOfB)).status).toBe(404)
  expect((await get(logoPath(a.slug, '/256'), cookies.ownerOfB)).status).toBe(404)
  expect((await myOrganization(cookies.ownerOfB, b.slug))?.logoUrl).toBeNull()
})

test('a new logo removes the previous files; removing the logo removes them all', async () => {
  const first = await setLogo(await transparentLogoPng(600, 200))
  const second = await setLogo(await transparentLogoPng(300, 300))
  expect(second).not.toBe(first)
  const hash = new URL(second, 'http://x').searchParams.get('v') ?? ''
  expect(await storageKeys(`org/${a.id}/logo`)).toEqual([
    `org/${a.id}/logo/${hash}-64.webp`,
    `org/${a.id}/logo/${hash}.webp`,
  ])
  const removed = await env.call('DELETE', logoPath(a.slug), undefined, { cookie: cookies.owner })
  expect(removed.status).toBe(200)
  expect(await removed.json()).toEqual({ logoUrl: null })
  expect(await storageKeys(`org/${a.id}/logo`)).toEqual([])
  expect((await get(logoPath(a.slug, '/256'), cookies.member)).status).toBe(404)
  expect((await myOrganization(cookies.owner, a.slug))?.logoUrl).toBeNull()
  const { rows } = await env.admin.pool.query<{ data: { removed: boolean } }>(
    `select data from audit_log where action = 'organization.logo_changed'
       and organization_id = $1 order by created_at`,
    [a.id],
  )
  expect(rows.map((r) => r.data.removed)).toEqual([false, false, false, true])
})

test('confirming a preview that is not there is 404', async () => {
  const r = await env.call(
    'POST',
    logoPath(a.slug, '/confirm'),
    { stagingId: crypto.randomUUID() },
    { cookie: cookies.owner },
  )
  expect(r.status).toBe(404)
})
