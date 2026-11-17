import { afterAll, beforeAll, expect, test } from 'vitest'
import { fixedClock, startTestDatabase, withScope } from '../testing/index.js'
import type { TestDatabase } from '../testing/index.js'
import { createDb } from './client.js'
import type { DbHandle } from './client.js'
import { createPgRateLimiter } from './rate-limiter.js'

let tdb: TestDatabase
let a: DbHandle
let b: DbHandle
const clock = fixedClock(new Date('2026-10-18T10:00:00Z'))
const limiterOn = (h: DbHandle) => createPgRateLimiter({ db: h.db, clock })
const DAY = 86_400_000

beforeAll(async () => {
  tdb = await startTestDatabase()
  // two pools stand for two processes (web and worker)
  a = createDb(tdb.runtimeUrl, { max: 1, applicationName: 'limiter-a' })
  b = createDb(tdb.runtimeUrl, { max: 1, applicationName: 'limiter-b' })
})
afterAll(async () => {
  await a.close()
  await b.close()
  await tdb.stop()
})

const rawKeys = (prefix: string) =>
  withScope(tdb.runtimeUrl, { kind: 'none' }, async (c) => {
    const { rows } = await c.query<{ key: string }>(
      `select key from rate_limit_counters where key like $1 order by key`,
      [`%${prefix}%`],
    )
    return rows.map((r) => r.key)
  })

test('rate limit is shared across connections and stays out of Better Auth table', async () => {
  const la = limiterOn(a)
  const lb = limiterOn(b)
  for (let i = 0; i < 5; i++) {
    expect((await la.hit('ip:1', 10, 60_000)).allowed).toBe(true)
    expect((await lb.hit('ip:1', 10, 60_000)).allowed).toBe(true)
  }
  expect(await la.hit('ip:1', 10, 60_000)).toEqual({ allowed: false, retryAfterMs: 60_000 })
  expect(await rawKeys('ip:1')).toEqual(['hits:ip:1'])
  const { rows } = await withScope(tdb.runtimeUrl, { kind: 'none' }, (c) =>
    c.query('select 1 from rate_limits'),
  )
  expect(rows).toEqual([])
})

test('the window is fixed: it restarts after windowMs from its first hit', async () => {
  const limiter = limiterOn(a)
  expect((await limiter.hit('ip:2', 2, 60_000)).allowed).toBe(true)
  clock.advance(20_000)
  expect((await limiter.hit('ip:2', 2, 60_000)).allowed).toBe(true)
  clock.advance(20_000)
  // blocked hits do not move the window
  expect(await limiter.hit('ip:2', 2, 60_000)).toEqual({ allowed: false, retryAfterMs: 20_000 })
  clock.advance(20_000)
  expect(await limiter.hit('ip:2', 2, 60_000)).toEqual({ allowed: true, retryAfterMs: 0 })
})

test('concurrent hits are all counted', async () => {
  const la = limiterOn(a)
  const lb = limiterOn(b)
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => (i % 2 ? la : lb).hit('ip:3', 100, 60_000)),
  )
  expect((await la.hit('ip:3', 11, 60_000)).allowed).toBe(true)
  expect((await la.hit('ip:3', 11, 60_000)).allowed).toBe(false)
})

test('failures are counted and reset', async () => {
  const limiter = limiterOn(a)
  expect(await limiter.failures('login:x', DAY)).toEqual({ count: 0, lastAt: null })
  for (let i = 0; i < 3; i++) await limiter.recordFailure('login:x', DAY)
  expect(await limiter.failures('login:x', DAY)).toEqual({ count: 3, lastAt: clock.now() })
  await limiter.hit('login:x', 5, 60_000)
  await limiter.reset('login:x')
  expect((await limiter.failures('login:x', DAY)).count).toBe(0)
  expect(await rawKeys('login:x')).toEqual([])
})

test('a hit key never meets a failure key', async () => {
  const limiter = limiterOn(a)
  await limiter.recordFailure('login:y', DAY)
  await limiter.hit('failures:login:y', 5, 60_000)
  expect((await limiter.failures('login:y', DAY)).count).toBe(1)
})

test('a limit of zero blocks the first hit for the whole window', async () => {
  expect(await limiterOn(a).hit('ip:4', 0, 60_000)).toEqual({
    allowed: false,
    retryAfterMs: 60_000,
  })
})

test('reset starts a fresh window', async () => {
  const limiter = limiterOn(a)
  await limiter.hit('ip:5', 1, 60_000)
  expect((await limiter.hit('ip:5', 1, 60_000)).allowed).toBe(false)
  await limiter.reset('ip:5')
  expect(await limiter.hit('ip:5', 1, 60_000)).toEqual({ allowed: true, retryAfterMs: 0 })
})

test('peek tells whether a hit would pass, without counting', async () => {
  const limiter = limiterOn(a)
  expect(await limiter.peek('peek:1', 2, 60_000)).toEqual({ allowed: true, retryAfterMs: 0 })
  await limiter.hit('peek:1', 2, 60_000)
  expect((await limiter.peek('peek:1', 2, 60_000)).allowed).toBe(true)
  expect((await limiter.peek('peek:1', 2, 60_000)).allowed).toBe(true)
  await limiter.hit('peek:1', 2, 60_000)
  expect(await limiter.peek('peek:1', 2, 60_000)).toEqual({ allowed: false, retryAfterMs: 60_000 })
  clock.advance(60_000)
  expect((await limiter.peek('peek:1', 2, 60_000)).allowed).toBe(true)
})

test('failures older than the memory are forgotten, and a new one starts again from one', async () => {
  const limiter = limiterOn(a)
  for (let i = 0; i < 6; i++) await limiter.recordFailure('login:old', DAY)
  clock.advance(DAY - 1)
  expect((await limiter.failures('login:old', DAY)).count).toBe(6)
  clock.advance(1)
  expect(await limiter.failures('login:old', DAY)).toEqual({ count: 0, lastAt: null })
  await limiter.recordFailure('login:old', DAY)
  expect(await limiter.failures('login:old', DAY)).toEqual({ count: 1, lastAt: clock.now() })
})

test('deleteIdleBefore removes the counters nobody touched since, and only those', async () => {
  const limiter = limiterOn(a)
  await limiter.hit('ip:idle', 5, 60_000)
  await limiter.recordFailure('login:idle', DAY)
  clock.advance(3 * DAY)
  await limiter.hit('ip:busy', 5, 60_000)
  const cutoff = new Date(clock.now().getTime() - 2 * DAY)
  expect(await limiter.deleteIdleBefore(cutoff)).toBeGreaterThanOrEqual(2)
  expect(await rawKeys(':idle')).toEqual([])
  expect(await rawKeys('ip:busy')).toEqual(['hits:ip:busy'])
  expect(await limiter.deleteIdleBefore(cutoff)).toBe(0)
})
