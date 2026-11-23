import { unusedMediaTools } from '../tests/media-tools.js'
import { createAvatarProcessor } from '@app/infrastructure'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { JobQueue, JobScheduler, Logger, QueueName } from '@app/application'
import { startWorker } from './start-worker.js'
import type { WorkerDeps } from './start-worker.js'
import { NO_PUBLISHING } from '../tests/no-publishing.js'

// Handlers under test here never open a transaction.
const services: WorkerDeps['services'] = {
  uow: {
    run: () => Promise.reject(new Error('not used in this test')),
    runAsSystem: () => Promise.reject(new Error('not used in this test')),
  },
  clock: { now: () => new Date('2026-10-18T10:00:00Z') },
  ids: { newId: () => '00000000-0000-7000-8000-000000000000' },
  storage: {
    put: () => Promise.reject(new Error('not used in this test')),
    get: () => Promise.reject(new Error('not used in this test')),
    getRange: () => Promise.reject(new Error('not used in this test')),
    delete: () => Promise.reject(new Error('not used in this test')),
    deletePrefix: () => Promise.reject(new Error('not used in this test')),
    list: () => Promise.reject(new Error('not used in this test')),
  },
  uploadParts: {
    receive: () => Promise.reject(new Error('not used in this test')),
    keep: () => Promise.reject(new Error('not used in this test')),
    discard: () => Promise.reject(new Error('not used in this test')),
    head: () => Promise.reject(new Error('not used in this test')),
    assemble: () => {
      throw new Error('not used in this test')
    },
    remove: () => Promise.reject(new Error('not used in this test')),
    list: () => Promise.reject(new Error('not used in this test')),
  },
  credentials: { deleteAllCredentials: () => Promise.reject(new Error('not used in this test')) },
  rateLimiter: { deleteIdleBefore: () => Promise.reject(new Error('not used in this test')) },
  zip: {
    create: () => {
      throw new Error('not used in this test')
    },
  },
  mailer: {
    isConfigured: () => Promise.reject(new Error('not used in this test')),
    send: () => Promise.reject(new Error('not used in this test')),
  },
  signedTokens: {
    sign: () => {
      throw new Error('not used in this test')
    },
    verify: () => {
      throw new Error('not used in this test')
    },
    deviceHash: () => {
      throw new Error('not used in this test')
    },
    addressHash: () => {
      throw new Error('not used in this test')
    },
  },
  translate: () => {
    throw new Error('not used in this test')
  },
  panel: {
    url: new URL('https://pannello.example.test'),
    productName: 'Feedway',
    defaultTimezone: 'Europe/Rome',
  },
  // the account jobs are not these tests'
  connectors: {},
  publishing: NO_PUBLISHING,
  connectionTokens: {
    seal: () => Promise.reject(new Error('not used')),
    open: () => Promise.reject(new Error('not used')),
  },
  metaReminders: {
    integrations: { get: () => Promise.reject(new Error('not used')) },
    graph: { version: 'v24.0', sunset: '2099-12-31' },
  },
  images: createAvatarProcessor(),
  media: unusedMediaTools,
}

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
  const schedules: { name: string; cron: string; tz: string }[] = []
  const queue: JobQueue & JobScheduler = {
    schedule(name, cron, _data, opts) {
      schedules.push({ name, cron, tz: opts.tz })
      return Promise.resolve()
    },
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
  return { queue, workedQueues, stops, schedules }
}

const heartbeatPath = () => join(mkdtempSync(join(tmpdir(), 'w-')), 'heartbeat')

test('worker only consumes the configured queues', async () => {
  const q = fakeQueue()
  const w = await startWorker({
    queue: q.queue,
    logger: silentLogger,
    services,
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
    services,
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
    services,
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
  const queue: JobQueue & JobScheduler = {
    ...fakeQueue().queue,
    work(_name, handler) {
      // only system.selftest is consumed in this test
      registered = handler as typeof registered
      return Promise.resolve()
    },
  }
  const seen: unknown[] = []
  const w = await startWorker({
    queue,
    logger: silentLogger,
    services,
    heartbeatPath: heartbeatPath(),
    heartbeatEveryMs: 1000,
    queues: ['system.selftest'],
    handlers: {
      'system.selftest': (job, deps) => {
        seen.push(job.data, deps.logger, deps.clock)
        return Promise.resolve()
      },
    },
  })
  await registered?.({ id: 'j1', data: { requestedAt: '2026-10-18T10:00:00Z' } })
  expect(seen).toEqual([{ requestedAt: '2026-10-18T10:00:00Z' }, silentLogger, services.clock])
  await w.stop()
})

test('the worker that consumes the retention schedules it every day at 03:30 Italian time', async () => {
  const q = fakeQueue()
  const w = await startWorker({
    queue: q.queue,
    logger: silentLogger,
    services,
    heartbeatPath: heartbeatPath(),
    heartbeatEveryMs: 1000,
    queues: ['identity.retention'],
  })
  expect(q.schedules).toEqual([
    { name: 'identity.retention', cron: '30 3 * * *', tz: 'Europe/Rome' },
  ])
  await w.stop()
})

test('the worker that consumes the accounts run schedules it every day at 04:00 Italian time', async () => {
  const q = fakeQueue()
  const w = await startWorker({
    queue: q.queue,
    logger: silentLogger,
    services,
    heartbeatPath: heartbeatPath(),
    heartbeatEveryMs: 1000,
    queues: ['accounts.daily'],
  })
  expect(q.schedules).toEqual([{ name: 'accounts.daily', cron: '0 4 * * *', tz: 'Europe/Rome' }])
  await w.stop()
})

test('the worker that consumes the media conversions wakes them at once when it starts', async () => {
  const sent: { name: string; data: unknown }[] = []
  const turn = {
    organizationId: '00000000-0000-7000-8000-000000000001',
    mediaId: '00000000-0000-7000-8000-000000000002',
  }
  const w = await startWorker({
    queue: {
      ...fakeQueue().queue,
      send(name, data) {
        sent.push({ name, data })
        return Promise.resolve('j')
      },
    },
    logger: silentLogger,
    // a file left `processing` by the worker that stopped: the next at its turn
    services: {
      ...services,
      // no copy to publish waiting (plan 07 Task 6): only the file is woken
      uow: {
        ...services.uow,
        runAsSystem: (reason: string) =>
          Promise.resolve(reason.startsWith('media.publish_copies') ? null : turn) as never,
      },
    },
    heartbeatPath: heartbeatPath(),
    heartbeatEveryMs: 1000,
    queues: ['media.process'],
  })
  expect(sent).toEqual([{ name: 'media.process', data: turn }])
  await w.stop()
})

test('stopping interrupts a running conversion first, so it gives its attempt back in time', async () => {
  let registered: ((job: { id: string; data: unknown }) => Promise<void>) | undefined
  const q = fakeQueue()
  let seen: AbortSignal | undefined
  let running: Promise<void> = Promise.resolve()
  const w = await startWorker({
    queue: {
      ...q.queue,
      work(_name, handler) {
        registered = handler as typeof registered
        return Promise.resolve()
      },
      stop(opts) {
        // the conversion was told before the queue waits for it
        expect(seen?.aborted).toBe(true)
        return q.queue.stop(opts)
      },
    },
    logger: silentLogger,
    services: {
      ...services,
      uow: { ...services.uow, runAsSystem: () => Promise.resolve(null) as never },
    },
    heartbeatPath: heartbeatPath(),
    heartbeatEveryMs: 1000,
    queues: ['media.process'],
    handlers: {
      'media.process': (job) => {
        seen = job.signal
        return new Promise<void>((resolve) => {
          job.signal?.addEventListener('abort', () => {
            resolve()
          })
        })
      },
    },
  })
  running = registered?.({ id: 'j1', data: {} }) ?? running
  await w.stop()
  await running
  expect(q.stops).toEqual([{ graceful: true, timeoutMs: 30_000 }])
})

test('the worker that consumes the uploads clean-up schedules it every ten minutes', async () => {
  const q = fakeQueue()
  const w = await startWorker({
    queue: q.queue,
    logger: silentLogger,
    services,
    heartbeatPath: heartbeatPath(),
    heartbeatEveryMs: 1000,
    queues: ['media.uploads_cleanup'],
  })
  expect(q.schedules).toEqual([
    { name: 'media.uploads_cleanup', cron: '7-59/10 * * * *', tz: 'Europe/Rome' },
  ])
  await w.stop()
})

test('the worker that consumes the digests starts them every minute (plan 08 P7)', async () => {
  const q = fakeQueue()
  const w = await startWorker({
    queue: q.queue,
    logger: silentLogger,
    services,
    heartbeatPath: heartbeatPath(),
    heartbeatEveryMs: 1000,
    queues: ['report.daily', 'report.digest'],
  })
  expect(q.schedules).toEqual([{ name: 'report.daily', cron: '* * * * *', tz: 'Europe/Rome' }])
  expect(q.workedQueues).toEqual(['report.daily', 'report.digest'])
  await w.stop()
})
