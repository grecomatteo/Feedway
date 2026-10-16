import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { JobQueue, QueueName } from '@app/application'
import { createLogger, createPgBossQueue } from '@app/infrastructure'
import { startTestDatabase } from '@app/infrastructure/testing'
import type { TestDatabase } from '@app/infrastructure/testing'
import { startWorker } from './start-worker.js'

const logger = createLogger({ service: 'worker', level: 'error' })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor(check: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition')
    await sleep(100)
  }
}

let tdb: TestDatabase
let producer: JobQueue

beforeAll(async () => {
  tdb = await startTestDatabase()
  producer = await createPgBossQueue({ url: tdb.runtimeUrl, logger, role: 'producer' })
  // short expiry so a job lost to a crash is retried within the test
  const admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  await admin.query(`update pgboss.queue set expire_seconds = 5 where name = 'system.selftest'`)
  await admin.end()
}, 120_000)

afterAll(async () => {
  await producer.stop({ graceful: false, timeoutMs: 1000 })
  await tdb.stop()
})

async function worker(onSelftest: (job: { id: string }) => Promise<void>) {
  const queue = await createPgBossQueue({ url: tdb.runtimeUrl, logger, role: 'consumer' })
  const started = await startWorker({
    queue,
    logger,
    heartbeatPath: join(mkdtempSync(join(tmpdir(), 'w-')), 'heartbeat'),
    heartbeatEveryMs: 1000,
    queues: ['system.selftest' satisfies QueueName],
    handlers: { 'system.selftest': onSelftest },
  })
  // simulates a crash: no waiting for running handlers
  const kill = () => queue.stop({ graceful: false, timeoutMs: 0 })
  return { ...started, kill }
}

test('stop waits for the running job to finish', async () => {
  let started = false
  let finished = false
  const w = await worker(async () => {
    started = true
    await sleep(1500)
    finished = true
  })
  await producer.send('system.selftest', { requestedAt: 't' })
  await waitFor(() => started, 20_000)
  await w.stop()
  expect(finished).toBe(true)
}, 60_000)

test('job interrupted by a hard stop is picked up again', async () => {
  const done: string[] = []
  let started = false
  const a = await worker(() => {
    started = true
    return new Promise<void>(() => undefined) // never finishes
  })
  const id = await producer.send('system.selftest', { requestedAt: 't' })
  await waitFor(() => started, 20_000)
  await a.kill()
  const b = await worker((job) => {
    done.push(job.id)
    return Promise.resolve()
  })
  await waitFor(() => id !== null && done.includes(id), 90_000)
  await b.stop()
}, 120_000)
