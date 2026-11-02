import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  cropAvatar,
  readAvatar,
  readAvatarStaging,
  removeAvatar,
  uploadAvatarSource,
  type AvatarDeps,
  type Logger,
  type SessionUser,
  type Storage,
} from '@app/application'
import { createDb, type DbHandle } from '../db/client.js'
import { createUnitOfWork } from '../db/unit-of-work.js'
import { createLocalDiskStorage } from '../storage/local-disk-storage.js'
import { uuidV7Generator } from '../system/id-generator.js'
import { seed, startTestDatabase, withScope, type TestDatabase } from '../testing/index.js'
import { createAvatarProcessor } from './avatar-processor.js'
import { imageFixture } from './test-images.js'

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
}
const PANEL = new URL('https://app.feedway.test')

let tdb: TestDatabase
let handle: DbHandle
let root: string
let storage: Storage
let deps: AvatarDeps
let orgA: string, orgB: string
let memberA: string, ownerA: string, userInAandB: string, memberB: string, stranger: string

beforeAll(async () => {
  tdb = await startTestDatabase()
  handle = createDb(tdb.runtimeUrl, { max: 4, applicationName: 'avatar-test' })
  root = await mkdtemp(join(tmpdir(), 'avatar-test-'))
  storage = createLocalDiskStorage({ root })
  deps = {
    uow: createUnitOfWork({ db: handle.db, ids: uuidV7Generator, logger: silent }),
    storage,
    avatars: createAvatarProcessor(),
    ids: uuidV7Generator,
    panelUrl: PANEL,
  }
  await seed(tdb.runtimeUrl, async (s) => {
    orgA = await s.organization()
    orgB = await s.organization()
    ownerA = await s.user()
    memberA = await s.user()
    userInAandB = await s.user()
    memberB = await s.user()
    stranger = await s.user()
    await s.member(orgA, ownerA, 'owner')
    await s.member(orgA, memberA, 'member')
    await s.member(orgA, userInAandB, 'member')
    await s.member(orgB, userInAandB, 'member')
    await s.member(orgB, memberB, 'member')
  })
})

afterAll(async () => {
  await handle.close()
  await tdb.stop()
  await rm(root, { recursive: true, force: true })
})

const userOf = (id: string) => ({ id, avatarUrl: null }) as SessionUser

async function setAvatar(userId: string, file: Parameters<typeof imageFixture>[0]) {
  const staged = await uploadAvatarSource(deps, userOf(userId), { bytes: await imageFixture(file) })
  const size = Math.min(staged.width, staged.height)
  const user = await cropAvatar(
    deps,
    userOf(userId),
    { stagingId: staged.stagingId, x: 0, y: 0, size },
    { ip: null },
  )
  const hash = new URL(user.avatarUrl ?? '', PANEL).searchParams.get('v') ?? ''
  return { user, hash }
}

async function bytesOf(object: { body: AsyncIterable<Uint8Array> }) {
  const chunks: Uint8Array[] = []
  for await (const c of object.body) chunks.push(c)
  return Buffer.concat(chunks)
}

const keys = async (prefix: string) => (await storage.list(prefix)).map((o) => o.key).sort()

test('crop stores two sizes under the user prefix and removes the previous photo', async () => {
  const first = await setAvatar(memberA, 'photo.jpg')
  expect(first.hash).toMatch(/^[0-9a-f]{64}$/)
  const second = await setAvatar(memberA, 'photo.png')
  expect(second.hash).not.toBe(first.hash)
  expect(await keys(`users/${memberA}/avatar/`)).toEqual([
    `users/${memberA}/avatar/${second.hash}-64.webp`,
    `users/${memberA}/avatar/${second.hash}.webp`,
  ])
  expect(second.user.avatarUrl).toBe(`/api/v1/users/${memberA}/avatar/256?v=${second.hash}`)
  const { rows } = await handle.pool.query<{ avatar_key: string; image: string }>(
    'select avatar_key, image from users where id = $1',
    [memberA],
  )
  expect(rows[0]).toEqual({
    avatar_key: `users/${memberA}/avatar/${second.hash}`,
    image: `https://app.feedway.test/api/v1/users/${memberA}/avatar/256?v=${second.hash}`,
  })
  const own = await readAvatar(deps, memberA, { userId: memberA, size: 64 })
  if (!own) throw new Error('no photo')
  expect(own.hash).toBe(second.hash)
  expect((await sharp(await bytesOf(own.object)).metadata()).width).toBe(64)
})

test('each change is in the personal activity, with no file names or hashes', async () => {
  const { rows } = await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query<{ data: unknown; organization_id: string | null }>(
      `select data, organization_id from audit_log
        where actor_id = $1 and action = 'user.avatar_changed' order by created_at`,
      [memberA],
    ),
  )
  expect(rows.length).toBeGreaterThanOrEqual(2)
  expect(rows.every((r) => r.organization_id === null)).toBe(true)
  expect(rows[0]?.data).toEqual({ removed: false })
})

test('a new upload replaces the previous preview, and only its owner reads it', async () => {
  const one = await uploadAvatarSource(deps, userOf(ownerA), {
    bytes: await imageFixture('photo.webp'),
  })
  const two = await uploadAvatarSource(deps, userOf(ownerA), {
    bytes: await imageFixture('photo.heic'),
  })
  expect(await keys(`users/${ownerA}/avatar/staging/`)).toEqual([
    `users/${ownerA}/avatar/staging/${two.stagingId}.webp`,
  ])
  expect(await readAvatarStaging(deps, userOf(ownerA), one.stagingId)).toBeNull()
  const preview = await readAvatarStaging(deps, userOf(ownerA), two.stagingId)
  if (!preview) throw new Error('no preview')
  await bytesOf(preview)
  // another person, with the same id, reads in their own folder only
  expect(await readAvatarStaging(deps, userOf(memberA), two.stagingId)).toBeNull()
  expect(await readAvatarStaging(deps, userOf(ownerA), '../../x')).toBeNull()
  await expect(
    cropAvatar(
      deps,
      userOf(memberA),
      { stagingId: two.stagingId, x: 0, y: 0, size: 100 },
      { ip: null },
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' })
})

test('a crop outside the image is VALIDATION and changes nothing', async () => {
  const staged = await uploadAvatarSource(deps, userOf(ownerA), {
    bytes: await imageFixture('photo.webp'),
  })
  for (const crop of [
    { x: 0, y: 0, size: 301 },
    { x: 101, y: 0, size: 300 },
    { x: -1, y: 0, size: 100 },
    { x: 0, y: 0, size: 63 },
    { x: 0.5, y: 0, size: 100 },
  ])
    await expect(
      cropAvatar(deps, userOf(ownerA), { stagingId: staged.stagingId, ...crop }, { ip: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION' })
  expect(await keys(`users/${ownerA}/avatar/`)).toEqual([
    `users/${ownerA}/avatar/staging/${staged.stagingId}.webp`,
  ])
})

test('over 5 MB is FILE_TOO_LARGE before anything is decoded', async () => {
  await expect(
    uploadAvatarSource(deps, userOf(ownerA), { bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }),
  ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
})

test('avatar is visible to colleagues and to nobody else', async () => {
  await setAvatar(userInAandB, 'photo.jpg')
  const read = (viewer: string) => readAvatar(deps, viewer, { userId: userInAandB, size: 256 })
  expect(await read(userInAandB)).not.toBeNull()
  expect(await read(ownerA)).not.toBeNull()
  // met in the other agency
  expect(await read(memberB)).not.toBeNull()
  expect(await read(stranger)).toBeNull()
  // memberA has a photo, memberB shares no agency with them
  expect(await readAvatar(deps, memberB, { userId: memberA, size: 256 })).toBeNull()
  expect(await readAvatar(deps, memberB, { userId: 'not-an-id', size: 256 })).toBeNull()
})

test('a disabled colleague no longer sees the photo', async () => {
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query(
      "update organization_members set status = 'disabled' where user_id = $1 and organization_id = $2",
      [memberB, orgB],
    ),
  )
  expect(await readAvatar(deps, memberB, { userId: userInAandB, size: 256 })).toBeNull()
})

test('a disabled or anonymized account shows no photo, even to itself', async () => {
  await setAvatar(ownerA, 'photo.jpg')
  expect(await readAvatar(deps, memberA, { userId: ownerA, size: 256 })).not.toBeNull()
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query("update users set status = 'disabled' where id = $1", [ownerA]),
  )
  expect(await readAvatar(deps, memberA, { userId: ownerA, size: 256 })).toBeNull()
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query("update users set status = 'active', anonymized_at = now() where id = $1", [ownerA]),
  )
  expect(await readAvatar(deps, memberA, { userId: ownerA, size: 256 })).toBeNull()
  await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query('update users set anonymized_at = null where id = $1', [ownerA]),
  )
})

test('a remove while a crop runs keeps the new photo whole', async () => {
  await setAvatar(memberB, 'photo.jpg')
  const staged = await uploadAvatarSource(deps, userOf(memberB), {
    bytes: await imageFixture('photo.png'),
  })
  const [cropped] = await Promise.all([
    cropAvatar(
      deps,
      userOf(memberB),
      { stagingId: staged.stagingId, x: 0, y: 0, size: 500 },
      { ip: null },
    ),
    removeAvatar(deps, userOf(memberB), { ip: null }),
  ])
  const { rows } = await handle.pool.query<{ avatar_key: string | null }>(
    'select avatar_key from users where id = $1',
    [memberB],
  )
  const key = rows[0]?.avatar_key ?? null
  // whichever came last, the stored key has its files
  if (key !== null) {
    expect(cropped.avatarUrl).toContain(key.slice(key.lastIndexOf('/') + 1))
    expect(await keys(`users/${memberB}/avatar/`)).toEqual(
      expect.arrayContaining([`${key}.webp`, `${key}-64.webp`]),
    )
  }
})

test('remove goes back to the initials and deletes every file', async () => {
  const removed = await removeAvatar(deps, userOf(userInAandB), { ip: null })
  expect(removed.avatarUrl).toBeNull()
  expect(await keys(`users/${userInAandB}/avatar/`)).toEqual([])
  expect(await readAvatar(deps, userInAandB, { userId: userInAandB, size: 256 })).toBeNull()
  // nothing to remove: no new activity entry
  await removeAvatar(deps, userOf(userInAandB), { ip: null })
  const { rows } = await withScope(tdb.runtimeUrl, { kind: 'system' }, (c) =>
    c.query(
      `select 1 from audit_log where actor_id = $1 and action = 'user.avatar_changed'
         and data->>'removed' = 'true'`,
      [userInAandB],
    ),
  )
  expect(rows).toHaveLength(1)
})
