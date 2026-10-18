import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { JobQueue, Logger, QueueName } from '@app/application'
import { startWorker } from './start-worker.js'

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silentLogger,
}

function fakeQueue() {
  const workedQueues: QueueName[] = []
  const stops: { graceful: boolean; timeoutMs: number }[] = []
  const queue: JobQueue = {
    send: () => Promise.resolve(null),
    work(name) {
      workedQueues.push(name)
      return Promise.resolve()
    },
    ping: () => Promise.resolve(),
    stop(opts) {
      stops.push(opts)
      return Promise.resolve()
    },
  }
  return { queue, workedQueues, stops }
}

const heartbeatPath = () => join(mkdtempSync(join(tmpdir(), 'w-')), 'heartbeat')

test('worker only consumes the configured queues', async () => {
  const q = fakeQueue()
  const w = await startWorker({
    queue: q.queue,
    logger: silentLogger,
    heartbeatPath: heartbeatPath(),
    heartbeatEveryMs: 1000,
    queues: [],
  })
  expect(q.workedQueues).toEqual([])
  await w.stop()
})

test('worker registers a handler for each configured queue', async () => {
  const q = fakeQueue()
  const w = await startWorker({
    queue: q.queue,
    logger: silentLogger,
    heartbeatPath: heartbeatPath(),
    heartbeatEveryMs: 1000,
    queues: ['system.selftest'],
  })
  expect(q.workedQueues).toEqual(['system.selftest'])
  await w.stop()
})

test('stop asks the queue for a graceful stop with a 30 s timeout', async () => {
  const q = fakeQueue()
  const w = await startWorker({
    queue: q.queue,
    logger: silentLogger,
    heartbeatPath: heartbeatPath(),
    heartbeatEveryMs: 1000,
    queues: [],
  })
  await w.stop()
  expect(q.stops).toEqual([{ graceful: true, timeoutMs: 30_000 }])
})

test('a handler receives the job data and its dependencies', async () => {
  let registered:
    ((job: { id: string; data: { requestedAt: string } }) => Promise<void>) | undefined
  const queue: JobQueue = {
    ...fakeQueue().queue,
    work(_name, handler) {
      registered = handler
      return Promise.resolve()
    },
  }
  const seen: unknown[] = []
  const w = await startWorker({
    queue,
    logger: silentLogger,
    heartbeatPath: heartbeatPath(),
    heartbeatEveryMs: 1000,
    queues: ['system.selftest'],
    handlers: {
      'system.selftest': (job, deps) => {
        seen.push(job.data, deps.logger)
        return Promise.resolve()
      },
    },
  })
  await registered?.({ id: 'j1', data: { requestedAt: '2026-10-18T10:00:00Z' } })
  expect(seen).toEqual([{ requestedAt: '2026-10-18T10:00:00Z' }, silentLogger])
  await w.stop()
})
