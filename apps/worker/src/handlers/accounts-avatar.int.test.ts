import pg from 'pg'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import type { Runtime } from '@app/infrastructure'
import { startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { META_MOCK, startMetaMock, type MetaMock } from '@app/meta-mock'
import { accountsAvatar } from './accounts-avatar.js'
import { accountsSync } from './accounts-sync.js'
import {
  FORNO_LUCE,
  accountsRuntime,
  agency,
  connection,
  handlerDeps,
  recordingQueue,
  type Agency,
} from '../../tests/accounts-jobs.js'

// The pictures of the accounts (plan 04 Task 4) against the fake Graph API, which serves them
// as Meta's CDN would. Other agencies are the isolation battery's (isolation.int.test.ts).

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client

const { pages, instagram } = META_MOCK

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  runtime = await accountsRuntime(tdb, mock)
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
}, 120_000)

afterEach(() => {
  mock.scenario('default')
})

afterAll(async () => {
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 }).catch(() => undefined)
  await runtime.close()
  await admin.end()
  await mock.stop()
  await tdb.stop()
})

const picture = (name: string) => `${mock.url}/pictures/${name}.jpg?oh=cc33&oe=6A00`

const avatar = async (of: Agency, accountId: string) =>
  accountsAvatar(
    { id: 'lavoro', data: { organizationId: of.organizationId, accountId } },
    handlerDeps(runtime, recordingQueue()),
  )

const keyOf = async (accountId: string) =>
  (
    await admin.query<{ avatar_key: string | null }>(
      'select avatar_key from social_accounts where id = $1',
      [accountId],
    )
  ).rows[0]?.avatar_key ?? null

const stored = async (key: string) => ({
  large: (await runtime.storage.get(`${key}.webp`)) !== null,
  small: (await runtime.storage.get(`${key}-64.webp`)) !== null,
})

const pictureCalls = () => mock.calls().filter((c) => c.path.startsWith('/pictures/'))

/** An agency whose Forno Luce has its picture stored already. */
async function withPicture() {
  const of = await agency(tdb, runtime)
  const conn = await connection(runtime, of, {
    accounts: FORNO_LUCE.map((a) => ({ ...a, avatarUrl: picture('fornoluce') })),
  })
  const ig = conn.accounts[instagram.ofPage] ?? ''
  await avatar(of, ig)
  const key = await keyOf(ig)
  if (key === null) throw new Error('the picture was not stored')
  return { of, conn, ig, key }
}

test('the sync queues the picture of each account, and the job stores it as two WebP files', async () => {
  const of = await agency(tdb, runtime)
  const conn = await connection(runtime, of, { accounts: FORNO_LUCE })
  const queue = recordingQueue()
  await accountsSync(
    { id: 'lavoro', data: { organizationId: of.organizationId, connectionId: conn.id } },
    handlerDeps(runtime, queue),
  )
  const queued = queue.sent.filter((j) => j.name === 'accounts.avatar')
  expect(queued.map((j) => j.data)).toEqual(
    expect.arrayContaining(
      Object.values(conn.accounts).map((accountId) => ({
        organizationId: of.organizationId,
        accountId,
      })),
    ),
  )
  expect(queued).toHaveLength(2)

  const ig = conn.accounts[instagram.ofPage] ?? ''
  await avatar(of, ig)
  const key = await keyOf(ig)
  expect(key).toMatch(new RegExp(`^org/${of.organizationId}/accounts/${ig}/avatar/[0-9a-f]{64}$`))
  expect(await stored(key ?? '')).toEqual({ large: true, small: true })
  const file = await runtime.storage.get(`${key ?? ''}.webp`)
  const chunks: Uint8Array[] = []
  for await (const chunk of file?.body ?? []) chunks.push(chunk)
  // RIFF....WEBP: never the JPEG as Meta sent it
  expect(Buffer.concat(chunks).subarray(8, 12).toString()).toBe('WEBP')

  // a sync with the same address and the picture stored queues nothing
  const again = recordingQueue()
  await accountsSync(
    { id: 'lavoro', data: { organizationId: of.organizationId, connectionId: conn.id } },
    handlerDeps(runtime, again),
  )
  const page = conn.accounts[pages.withInstagram] ?? ''
  expect(again.sent.filter((j) => j.name === 'accounts.avatar').map((j) => j.data)).toEqual([
    { organizationId: of.organizationId, accountId: page },
  ])
})

test('a new picture replaces the old one, whose files are removed', async () => {
  const { of, conn, ig, key } = await withPicture()
  mock.scenario('picture_changed', { id: instagram.ofPage })
  const queue = recordingQueue()
  await accountsSync(
    { id: 'lavoro', data: { organizationId: of.organizationId, connectionId: conn.id } },
    handlerDeps(runtime, queue),
  )
  expect(queue.sent.map((j) => j.data)).toContainEqual({
    organizationId: of.organizationId,
    accountId: ig,
  })
  await avatar(of, ig)
  const next = await keyOf(ig)
  expect(next).not.toBe(key)
  expect(await stored(next ?? '')).toEqual({ large: true, small: true })
  expect(await stored(key)).toEqual({ large: false, small: false })
})

test('a picture that does not download leaves the previous one', async () => {
  const { of, ig, key } = await withPicture()
  // an address that expired: nothing to retry
  await admin.query('update social_accounts set avatar_url = $2 where id = $1', [
    ig,
    picture('expired'),
  ])
  await avatar(of, ig)
  expect(await keyOf(ig)).toBe(key)

  // Meta's CDN down: the job fails, so the queue retries it, and the picture stays
  await admin.query('update social_accounts set avatar_url = $2 where id = $1', [
    ig,
    picture('fornoluce'),
  ])
  mock.scenario('html_5xx', { path: '/pictures/fornoluce.jpg' })
  await expect(avatar(of, ig)).rejects.toThrow(/unavailable/)
  expect(await keyOf(ig)).toBe(key)
  expect(await stored(key)).toEqual({ large: true, small: true })
})

test('bytes that are no image are dropped: the previous picture stays, or the initials', async () => {
  const { of, conn, ig, key } = await withPicture()
  mock.scenario('picture_not_image')
  await avatar(of, ig)
  expect(await keyOf(ig)).toBe(key)
  const page = conn.accounts[pages.withInstagram] ?? ''
  await avatar(of, page)
  expect(await keyOf(page)).toBeNull()
})

test('a host that is not allowed, or a redirect to one, is refused without downloading', async () => {
  const { of, ig, key } = await withPicture()
  const before = pictureCalls().length
  for (const url of [
    'https://scontent.xx.fbcdn.net/v/p.jpg',
    'http://169.254.169.254/latest/meta-data',
    'file:///etc/passwd',
  ]) {
    await admin.query('update social_accounts set avatar_url = $2 where id = $1', [ig, url])
    await avatar(of, ig)
    expect(await keyOf(ig)).toBe(key)
  }
  // nothing reached the mock, and in mock mode never the real Meta
  expect(pictureCalls()).toHaveLength(before)

  await admin.query('update social_accounts set avatar_url = $2 where id = $1', [
    ig,
    picture('fornoluce'),
  ])
  mock.scenario('picture_redirect', { to: 'https://elsewhere.example.test/x.jpg' })
  await avatar(of, ig)
  expect(await keyOf(ig)).toBe(key)
  expect(pictureCalls()).toHaveLength(before + 1)
})

test('an inactive account, or one without an address, is not downloaded', async () => {
  const of = await agency(tdb, runtime)
  const conn = await connection(runtime, of, { accounts: FORNO_LUCE })
  const ig = conn.accounts[instagram.ofPage] ?? ''
  const before = pictureCalls().length
  await avatar(of, ig)
  await admin.query('update social_accounts set active = false, avatar_url = $2 where id = $1', [
    ig,
    picture('fornoluce'),
  ])
  await avatar(of, ig)
  expect(pictureCalls()).toHaveLength(before)
  expect(await keyOf(ig)).toBeNull()
})

test('a picture Meta no longer gives is removed, and the initials come back', async () => {
  const { of, ig, key } = await withPicture()
  await admin.query('update social_accounts set avatar_url = null where id = $1', [ig])
  await avatar(of, ig)
  expect(await keyOf(ig)).toBeNull()
  expect(await stored(key)).toEqual({ large: false, small: false })
})

test('files a failed removal left behind go with the next picture', async () => {
  const { of, ig, key } = await withPicture()
  // a stray copy, as a removal that failed after the commit would leave it
  const stray = `${key.slice(0, key.lastIndexOf('/') + 1)}${'0'.repeat(64)}`
  await runtime.storage.put(`${stray}.webp`, Buffer.from('x'), { contentType: 'image/webp' })
  mock.scenario('picture_changed', { id: instagram.ofPage })
  await admin.query('update social_accounts set avatar_url = $2 where id = $1', [
    ig,
    picture('forno-nuova'),
  ])
  await avatar(of, ig)
  const next = await keyOf(ig)
  expect(next).not.toBe(key)
  expect(
    (await runtime.storage.list(`org/${of.organizationId}/accounts/${ig}/avatar/`))
      .map((o) => o.key)
      .sort(),
  ).toEqual([`${next ?? ''}-64.webp`, `${next ?? ''}.webp`].sort())
})
