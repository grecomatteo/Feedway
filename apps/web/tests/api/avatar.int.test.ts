import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { imageFixture, imageInfo, pngOfSize } from '@app/infrastructure/testing'
import type { ImageFixture } from '@app/infrastructure/testing'
import { errorCodeOf, startApiEnv } from './identity-env.js'
import type { ApiEnv, Person } from './identity-env.js'

let env: ApiEnv
let orgA: string, orgB: string
let ownerOfA: Person, memberOfA: Person, memberOfB: Person, userInAandB: Person
const cookies: Record<string, string> = {}

beforeAll(async () => {
  env = await startApiEnv('avatar')
  orgA = (await env.agency()).id
  orgB = (await env.agency()).id
  ownerOfA = await env.person(orgA, 'owner')
  await env.addPasskey(ownerOfA.userId)
  memberOfA = await env.person(orgA, 'member')
  memberOfB = await env.person(orgB, 'member')
  userInAandB = await env.person(orgA, 'member')
  await env.admin.pool.query(
    `insert into organization_members (organization_id, user_id, role, status)
     values ($1, $2, 'member', 'active')`,
    [orgB, userInAandB.userId],
  )
  cookies['ownerOfA'] = await env.strongSignIn(ownerOfA)
  cookies['memberOfA'] = await env.signIn(memberOfA)
  cookies['memberOfB'] = await env.signIn(memberOfB)
  cookies['userInAandB'] = await env.signIn(userInAandB)
}, 300_000)

afterAll(async () => {
  await env.stop()
})

function form(bytes: Buffer, type = 'image/jpeg', name = 'foto.jpg'): FormData {
  const data = new FormData()
  data.append('file', new Blob([new Uint8Array(bytes)], { type }), name)
  return data
}

const upload = (cookie: string, bytes: Buffer, type?: string) =>
  env.call('POST', '/api/v1/me/avatar', form(bytes, type), { cookie })

interface Source {
  stagingId: string
  width: number
  height: number
  previewUrl: string
}

async function setAvatar(cookie: string, file: ImageFixture) {
  const r = await upload(cookie, await imageFixture(file))
  expect(r.status, await r.clone().text()).toBe(200)
  const source = (await r.json()) as Source
  const size = Math.min(source.width, source.height)
  const crop = await env.call(
    'POST',
    '/api/v1/me/avatar/crop',
    { stagingId: source.stagingId, x: 0, y: 0, size },
    { cookie },
  )
  expect(crop.status, await crop.clone().text()).toBe(200)
  const me = (await crop.json()) as { avatarUrl: string }
  return { url: me.avatarUrl, hash: new URL(me.avatarUrl, 'http://x').searchParams.get('v') ?? '' }
}

const get = (path: string, cookie?: string, headers: Record<string, string> = {}) =>
  env.call('GET', path, undefined, { cookie, headers })

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

test('over 5 MB is 413, a gif renamed .jpg is 415, a huge png is 422', async () => {
  const cookie = cookies['memberOfA'] ?? ''
  const tooLarge = await upload(cookie, Buffer.alloc(5 * 1024 * 1024 + 1, 1))
  expect(tooLarge.status).toBe(413)
  expect(await errorCodeOf(tooLarge)).toBe('FILE_TOO_LARGE')
  // exactly 5 MB passes the size check: refused only for what it is
  const limit = await upload(cookie, Buffer.alloc(5 * 1024 * 1024, 1))
  expect(limit.status).toBe(415)
  const gif = await upload(cookie, await imageFixture('anim.gif'), 'image/jpeg')
  expect(gif.status).toBe(415)
  expect(await errorCodeOf(gif)).toBe('UNSUPPORTED_FILE_TYPE')
  const svg = await upload(cookie, await imageFixture('image.svg'), 'image/png')
  expect(svg.status).toBe(415)
  const huge = await upload(cookie, await pngOfSize(8000, 6000))
  expect(huge.status).toBe(422)
  expect(await errorCodeOf(huge)).toBe('VALIDATION')
})

test('a declared body far over the limit is refused before it is read', async () => {
  const r = await env
    .call('POST', '/api/v1/me/avatar', 'x', {
      cookie: cookies['memberOfA'],
      headers: {
        'content-type': 'multipart/form-data; boundary=x',
        'content-length': String(6 * 1024 * 1024),
      },
    })
    .catch((e: unknown) => e)
  // the server answers 413 and closes; fetch may see the answer or the closed socket
  if (r instanceof Response) expect(r.status).toBe(413)
})

test('the upload takes only multipart with one file, and needs a session', async () => {
  const cookie = cookies['memberOfA'] ?? ''
  const json = await env.call('POST', '/api/v1/me/avatar', { file: 'x' }, { cookie })
  expect(json.status).toBe(415)
  const empty = new FormData()
  empty.append('nome', 'valore')
  expect((await env.call('POST', '/api/v1/me/avatar', empty, { cookie })).status).toBe(422)
  const two = form(await imageFixture('photo.jpg'))
  two.append('file', new Blob([new Uint8Array(await imageFixture('photo.png'))]), 'b.png')
  expect((await env.call('POST', '/api/v1/me/avatar', two, { cookie })).status).toBe(422)
  expect((await upload('', await imageFixture('photo.jpg'))).status).toBe(401)
})

test('the preview is a webp without metadata, for its owner only', async () => {
  const r = await upload(cookies['memberOfA'] ?? '', await imageFixture('photo.jpg'))
  const source = (await r.json()) as Source
  expect(source.previewUrl).toBe(`/api/v1/me/avatar/staging/${source.stagingId}`)
  const own = await get(source.previewUrl, cookies['memberOfA'])
  expect(own.status).toBe(200)
  expect(own.headers.get('content-type')).toBe('image/webp')
  expect(own.headers.get('x-content-type-options')).toBe('nosniff')
  expect(await imageInfo(Buffer.from(await own.arrayBuffer()))).toMatchObject({
    format: 'webp',
    exif: false,
  })
  // staging preview of another user is not found
  const other = await get(source.previewUrl, cookies['ownerOfA'])
  expect(other.status).toBe(404)
  expect(await errorCodeOf(other)).toBe('NOT_FOUND')
  expect((await get(source.previewUrl)).status).toBe(401)
})

test('crop stores two sizes under the user prefix and removes the previous photo', async () => {
  const cookie = cookies['userInAandB'] ?? ''
  // an iPhone photo too: decoded by the WebAssembly build inside the server bundle
  await setAvatar(cookie, 'photo.heic')
  const second = await setAvatar(cookie, 'photo.png')
  const prefix = `users/${userInAandB.userId}/avatar/`
  expect(await storageKeys(prefix)).toEqual([
    `${prefix}${second.hash}-64.webp`,
    `${prefix}${second.hash}.webp`,
  ])
  const me = (await (await get('/api/v1/me', cookie)).json()) as { avatarUrl: string }
  expect(me.avatarUrl).toBe(second.url)
})

test('avatar is visible to colleagues and to nobody else', async () => {
  const { url } = await setAvatar(cookies['memberOfA'] ?? '', 'photo.webp')
  const path = `/api/v1/users/${memberOfA.userId}/avatar/256`
  const ok = await get(path, cookies['ownerOfA'])
  expect(ok.status).toBe(200)
  expect(ok.headers.get('content-type')).toBe('image/webp')
  expect(ok.headers.get('cache-control')).toBe('private, max-age=86400')
  expect(ok.headers.get('x-content-type-options')).toBe('nosniff')
  const etag = ok.headers.get('etag')
  expect(etag).toBe(`"${new URL(url, 'http://x').searchParams.get('v') ?? ''}"`)
  expect((await imageInfo(Buffer.from(await ok.arrayBuffer()))).width).toBe(256)
  const small = await get(`/api/v1/users/${memberOfA.userId}/avatar/64`, cookies['ownerOfA'])
  expect((await imageInfo(Buffer.from(await small.arrayBuffer()))).width).toBe(64)
  // the browser asks again with the tag: nothing to send
  const again = await get(path, cookies['ownerOfA'], { 'if-none-match': etag ?? '' })
  expect(again.status).toBe(304)
  expect(await again.text()).toBe('')
  const foreign = await get(path, cookies['memberOfB'])
  expect(foreign.status).toBe(404)
  expect(await errorCodeOf(foreign)).toBe('NOT_FOUND')
  expect((await get(path)).status).toBe(401)
  expect(
    (await get(`/api/v1/users/${memberOfA.userId}/avatar/128`, cookies['ownerOfA'])).status,
  ).toBe(422)
  // the address in the profile works as it is (with its version)
  expect((await get(url, cookies['ownerOfA'])).status).toBe(200)
})

test('a colleague met in another agency sees the photo, a disabled colleague does not', async () => {
  const path = `/api/v1/users/${userInAandB.userId}/avatar/256`
  expect((await get(path, cookies['memberOfB'])).status).toBe(200)
  await env.admin.pool.query(
    "update organization_members set status = 'disabled' where user_id = $1 and organization_id = $2",
    [memberOfB.userId, orgB],
  )
  // the disabled person's session no longer works either; the check holds on its own too
  const r = await get(path, cookies['memberOfB'])
  expect([401, 403, 404]).toContain(r.status)
  await env.admin.pool.query(
    "update organization_members set status = 'active' where user_id = $1 and organization_id = $2",
    [memberOfB.userId, orgB],
  )
})

test('remove goes back to the initials and the photo is gone', async () => {
  const cookie = cookies['userInAandB'] ?? ''
  const r = await env.call('DELETE', '/api/v1/me/avatar', undefined, { cookie })
  expect(r.status).toBe(200)
  expect(((await r.json()) as { avatarUrl: string | null }).avatarUrl).toBeNull()
  expect(await storageKeys(`users/${userInAandB.userId}/avatar/`)).toEqual([])
  expect((await get(`/api/v1/users/${userInAandB.userId}/avatar/256`, cookie)).status).toBe(404)
})

test('a crop outside the photo is 422', async () => {
  const cookie = cookies['memberOfA'] ?? ''
  const source = (await (await upload(cookie, await imageFixture('photo.webp'))).json()) as Source
  const r = await env.call(
    'POST',
    '/api/v1/me/avatar/crop',
    { stagingId: source.stagingId, x: 200, y: 0, size: 300 },
    { cookie },
  )
  expect(r.status).toBe(422)
})
