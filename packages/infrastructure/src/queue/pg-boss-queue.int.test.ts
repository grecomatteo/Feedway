import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import type { JobQueue } from '@app/application'
import { createLogger } from '../logging/logger.js'
import { startTestDatabase } from '../testing/index.js'
import type { TestDatabase } from '../testing/index.js'
import { createPgBossQueue } from './pg-boss-queue.js'
import pg from 'pg'

const logger = createLogger({ service: 'worker', level: 'error' })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition')
    await sleep(100)
  }
}

let tdb: TestDatabase
let producerQ: JobQueue
const opened: JobQueue[] = []

const open = async (role: 'producer' | 'consumer') => {
  const q = await createPgBossQueue({ url: tdb.runtimeUrl, logger, role })
  opened.push(q)
  return q
}

beforeAll(async () => {
  tdb = await startTestDatabase()
  producerQ = await open('producer')
}, 120_000)

afterEach(async () => {
  // stop consumers of the previous test and clear leftovers
  for (const q of opened.splice(1)) await q.stop({ graceful: false, timeoutMs: 1000 })
  const admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  await admin.query('delete from pgboss.job')
  await admin.end()
})

afterAll(async () => {
  for (const q of opened) await q.stop({ graceful: false, timeoutMs: 1000 })
  await tdb.stop()
})

test('runtime role can send a job without DDL rights', async () => {
  expect(await producerQ.send('system.selftest', { requestedAt: 'now' })).toEqual(
    expect.any(String),
  )
})

test('a job is handled exactly once by two consumers', async () => {
  const seen: string[] = []
  const [a, b] = await Promise.all([open('consumer'), open('consumer')])
  for (const q of [a, b]) {
    await q.work('system.selftest', (j) => {
      seen.push(j.id)
      return Promise.resolve()
    })
  }
  const id = await producerQ.send('system.selftest', { requestedAt: 't' })
  await waitFor(() => seen.length === 1)
  await sleep(2000)
  expect(seen).toEqual([id])
})

test('same singletonKey while pending is enqueued once', async () => {
  const inOneHour = () => new Date(Date.now() + 3_600_000)
  const first = await producerQ.send(
    'system.selftest',
    { requestedAt: 't' },
    { singletonKey: 'target-1:publish', startAfter: inOneHour() },
  )
  const second = await producerQ.send(
    'system.selftest',
    { requestedAt: 't' },
    { singletonKey: 'target-1:publish', startAfter: inOneHour() },
  )
  expect(first).toEqual(expect.any(String))
  expect(second).toBeNull()
})

test('failed handler is retried', async () => {
  let calls = 0
  const consumerQ = await open('consumer')
  await consumerQ.work('system.selftest', () => {
    calls++
    return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve()
  })
  await producerQ.send('system.selftest', { requestedAt: 't' })
  await waitFor(() => calls === 2, 60_000)
}, 90_000)

test('ping rejects while the database is down and recovers after', async () => {
  await tdb.stopContainerOnly()
  await expect(producerQ.ping()).rejects.toThrow()
  await tdb.startContainerOnly()
  await waitFor(
    () =>
      producerQ.ping().then(
        () => true,
        () => false,
      ),
    30_000,
  )
}, 90_000)
