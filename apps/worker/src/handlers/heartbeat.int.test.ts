import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import {
  callExternalWatch,
  dispatchNotifications,
  recordWorkerBeat,
  watchWorker,
  MailSendError,
  type Logger,
  type MailMessage,
  type Mailer,
  type WorkerWatchDeps,
} from '@app/application'
import { createAdvisoryLock, createExternalWatchPinger, type Runtime } from '@app/infrastructure'
import { seed, startTestDatabase, type TestDatabase } from '@app/infrastructure/testing'
import { startMetaMock, type MetaMock } from '@app/meta-mock'
import { accountsRuntime, handlerDeps, recordingQueue } from '../../tests/accounts-jobs.js'
import { testClock } from '../../tests/publishing.js'
import { heartbeatExternal } from './heartbeat-external.js'
import { notifyDeps } from './notify.js'

// The worker's beat and the watches over it (§16.7, plan 08 Task 9): the web that tells the
// platform administrator the worker stopped and came back, once each, without the dispatcher
// sending them again; the instances taken away; two webs; the call to healthchecks.io.

let tdb: TestDatabase
let mock: MetaMock
let runtime: Runtime
let admin: pg.Client
let platformAdmin: string
let server: Server
let watchUrl: string
const calls: string[] = []

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

beforeAll(async () => {
  tdb = await startTestDatabase()
  mock = await startMetaMock()
  runtime = await accountsRuntime(tdb, mock)
  admin = new pg.Client({ connectionString: tdb.adminUrl })
  await admin.connect()
  platformAdmin = await seed(tdb.runtimeUrl, (s) =>
    s.user({ name: 'Eva Piattaforma', email: 'eva@example.org' }),
  )
  await admin.query("update users set platform_role = 'admin' where id = $1", [platformAdmin])
  server = createServer((req, res) => {
    calls.push(req.url ?? '')
    if (req.url?.includes('lento') === true) return // never answers
    res.end('OK')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  watchUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}, 120_000)

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await runtime.queue.stop({ graceful: false, timeoutMs: 1000 }).catch(() => undefined)
  await runtime.close()
  await admin.end()
  await mock.stop()
  await tdb.stop()
})

beforeEach(async () => {
  await admin.query('delete from system_heartbeats')
  await admin.query('delete from notification_deliveries')
  await admin.query('delete from notifications')
  await admin.query('delete from outbox_events')
  await admin.query("delete from integrations where kind = 'heartbeat'")
})

function mailbox(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = []
  return {
    sent,
    isConfigured: () => Promise.resolve(true),
    send(message) {
      sent.push(message)
      return Promise.resolve('sent')
    },
  }
}

function watch(at: Date) {
  const clock = testClock(at)
  const mail = mailbox()
  const queue = recordingQueue()
  const dispatch = notifyDeps({ ...handlerDeps(runtime, queue), mailer: mail, clock })
  const deps: WorkerWatchDeps = { ...dispatch, lock: createAdvisoryLock(runtime.pool) }
  return { deps, dispatch, mail, clock, queue }
}

const beat = (instance: string, at: Date) =>
  recordWorkerBeat(
    { uow: runtime.uow, clock: { now: () => at } },
    { instance, details: { version: '0.14.0', queues: 30 } },
  )

async function events(): Promise<{ type: string; dispatched: boolean }[]> {
  const { rows } = await admin.query<{ type: string; dispatched: boolean }>(
    `select type, dispatched_at is not null as dispatched from outbox_events order by created_at`,
  )
  return rows
}

test('the worker beats into its row, one per instance', async () => {
  const at = new Date()
  await beat('worker-a', new Date(at.getTime() - MINUTE))
  await beat('worker-a', at)
  const { rows } = await admin.query<{ instance: string; last_beat_at: Date; details: object }>(
    'select instance, last_beat_at, details from system_heartbeats',
  )
  expect(rows).toEqual([
    { instance: 'worker-a', last_beat_at: at, details: { version: '0.14.0', queues: 30 } },
  ])
})

test('a worker silent for 3 minutes is told once, sent by the web, and never again by the dispatcher', async () => {
  const now = new Date()
  await beat('worker-a', new Date(now.getTime() - 3 * MINUTE))
  const w = watch(now)

  expect(await watchWorker(w.deps)).toMatchObject({ outcome: 'down', sent: 1 })
  expect(w.mail.sent.map((m) => [m.to, m.subject])).toEqual([
    ['eva@example.org', expect.stringContaining('Il worker è fermo')],
  ])
  expect(await events()).toEqual([{ type: 'system.worker_down', dispatched: true }])

  // the next minutes: still down, nothing more
  w.clock.set(new Date(now.getTime() + MINUTE))
  expect(await watchWorker(w.deps)).toMatchObject({ outcome: 'same', sent: 0 })
  expect(w.mail.sent).toHaveLength(1)

  // the worker comes back: its dispatcher finds nothing to send
  const report = await dispatchNotifications(w.dispatch)
  expect(report).toMatchObject({ events: 0, notifications: 0, jobs: 0 })

  // its beat is fresh again: «ripartito», once
  const back = new Date(now.getTime() + 2 * MINUTE)
  await beat('worker-a', back)
  w.clock.set(back)
  expect(await watchWorker(w.deps)).toMatchObject({ outcome: 'up', sent: 1 })
  expect(w.mail.sent.map((m) => m.subject)).toEqual([
    expect.stringContaining('Il worker è fermo'),
    expect.stringContaining('Il worker è ripartito'),
  ])
  w.clock.set(new Date(back.getTime() + MINUTE))
  expect(await watchWorker(w.deps)).toMatchObject({ outcome: 'same' })
  expect(await events()).toEqual([
    { type: 'system.worker_down', dispatched: true },
    { type: 'system.worker_up', dispatched: true },
  ])
  const { rows } = await admin.query<{ channel: string; status: string }>(
    'select channel, status from notification_deliveries order by created_at, channel',
  )
  // the platform's bot is not there yet: Telegram is skipped with its reason
  expect(rows).toEqual([
    { channel: 'email', status: 'sent' },
    { channel: 'telegram', status: 'skipped' },
    { channel: 'email', status: 'sent' },
    { channel: 'telegram', status: 'skipped' },
  ])
})

test('one instance beating is enough: a second one stopped says nothing', async () => {
  const now = new Date()
  await beat('worker-a', new Date(now.getTime() - 10 * MINUTE))
  await beat('worker-b', new Date(now.getTime() - 20_000))
  expect(await watchWorker(watch(now).deps)).toMatchObject({ outcome: 'same' })
  expect(await events()).toEqual([])
})

test('an instance silent for 8 days is removed, one of 6 days stays', async () => {
  const now = new Date()
  await beat('dismesso', new Date(now.getTime() - 8 * DAY))
  await beat('fermo', new Date(now.getTime() - 6 * DAY))
  await beat('vivo', new Date(now.getTime() - 10_000))
  expect(await watchWorker(watch(now).deps)).toMatchObject({ outcome: 'same', retired: 1 })
  const { rows } = await admin.query<{ instance: string }>(
    'select instance from system_heartbeats order by instance',
  )
  expect(rows.map((r) => r.instance)).toEqual(['fermo', 'vivo'])
})

test('a fresh install whose worker never beat raises no alarm', async () => {
  expect(await watchWorker(watch(new Date()).deps)).toMatchObject({ outcome: 'same' })
  expect(await events()).toEqual([])
})

test('two webs at once: one watches, the alarm is written and sent once', async () => {
  const now = new Date()
  await beat('worker-a', new Date(now.getTime() - 3 * MINUTE))
  const a = watch(now)
  const b = watch(now)
  const reports = await Promise.all([watchWorker(a.deps), watchWorker(b.deps)])
  const outcomes = reports.map((r) => r.outcome)
  // the other either found the lock held or ran after the first had written the alarm
  expect(outcomes.filter((o) => o === 'down')).toHaveLength(1)
  expect(outcomes.filter((o) => o === 'busy' || o === 'same')).toHaveLength(1)
  expect(await events()).toEqual([{ type: 'system.worker_down', dispatched: true }])
  expect(a.mail.sent.length + b.mail.sent.length).toBe(1)
})

test('an alarm whose email failed is sent again by the web the next minute', async () => {
  const now = new Date()
  await beat('worker-a', new Date(now.getTime() - 3 * MINUTE))
  const w = watch(now)
  let fail = true
  const flaky: Mailer = {
    isConfigured: () => Promise.resolve(true),
    send: (m) => {
      if (fail) {
        fail = false
        return Promise.reject(new MailSendError('connection'))
      }
      return w.mail.send(m)
    },
  }
  const deps: WorkerWatchDeps = {
    ...notifyDeps({ ...handlerDeps(runtime, w.queue), mailer: flaky, clock: w.clock }),
    lock: createAdvisoryLock(runtime.pool),
  }
  await watchWorker(deps)
  expect(w.mail.sent).toHaveLength(0)
  // the first retry is a minute later (`afterFailure`)
  w.clock.set(new Date(now.getTime() + 2 * MINUTE))
  expect(await watchWorker(deps)).toMatchObject({ outcome: 'same', sent: 1 })
  expect(w.mail.sent.map((m) => m.subject)).toEqual([expect.stringContaining('fermo')])
})

/** A logger that keeps every line, to look for the secret in it. */
function capturingLogger(): Logger & { lines: string[] } {
  const lines: string[] = []
  const log = (obj: object, msg?: string) => {
    lines.push(
      JSON.stringify({ ...obj, msg }, (_k, v: unknown) => (v instanceof Error ? String(v) : v)),
    )
  }
  const logger: Logger & { lines: string[] } = {
    lines,
    debug: log,
    info: log,
    warn: log,
    error: log,
    child: () => logger,
  }
  return logger
}

async function saveWatch(url: string): Promise<void> {
  await runtime.uow.runAsSystem('test: the external watch', (tx) =>
    runtime.integrations.replacePlatform(tx, 'heartbeat', {
      config: {},
      secret: url,
      updatedBy: null,
    }),
  )
}

async function stateOf(): Promise<unknown> {
  const { rows } = await admin.query<{ state: unknown }>(
    "select state from integrations where kind = 'heartbeat'",
  )
  return rows[0]?.state
}

test('heartbeat.external calls the address every run and keeps the outcome', async () => {
  await saveWatch(`${watchUrl}/ping/uuid-segreto`)
  const logger = capturingLogger()
  const deps = {
    ...handlerDeps(runtime, recordingQueue()),
    logger,
    externalWatch: { integrations: runtime.integrations, pinger: createExternalWatchPinger() },
  }
  await heartbeatExternal({ id: 'lavoro', data: {} }, deps)
  expect(calls.at(-1)).toBe('/ping/uuid-segreto')
  expect(await stateOf()).toMatchObject({ ok: true, status: 200, problem: null })
  expect(logger.lines.join('\n')).not.toContain('uuid-segreto')
})

test('an address that does not answer in time is a timeout, and the address stays out of the log', async () => {
  await saveWatch(`${watchUrl}/lento/uuid-segreto`)
  const logger = capturingLogger()
  const report = await callExternalWatch({
    uow: runtime.uow,
    clock: runtime.clock,
    logger,
    integrations: runtime.integrations,
    pinger: createExternalWatchPinger(),
    timeoutMs: 200,
  })
  expect(report).toEqual({
    outcome: 'called',
    result: { ok: false, problem: 'timeout', status: null },
    state: { lastAt: expect.any(String) as string, ok: false, status: null, problem: 'timeout' },
  })
  expect(await stateOf()).toMatchObject({ ok: false, problem: 'timeout' })
  expect(logger.lines.join('\n')).toContain('external watch failed')
  expect(logger.lines.join('\n')).not.toContain('uuid-segreto')
})

test('without an address nothing is called', async () => {
  const before = calls.length
  const report = await callExternalWatch({
    uow: runtime.uow,
    clock: runtime.clock,
    logger: runtime.logger,
    integrations: runtime.integrations,
    pinger: createExternalWatchPinger(),
  })
  expect(report).toEqual({ outcome: 'not_configured' })
  expect(calls.length).toBe(before)
})

test('an alarm left `sending` by a web that fell is sent again by the next watch', async () => {
  const now = new Date()
  await beat('worker-a', new Date(now.getTime() - 3 * MINUTE))
  const w = watch(now)
  await watchWorker(w.deps)
  // as if the web had claimed the email and fallen before saving the outcome
  await admin.query(
    `update notification_deliveries set status = 'sending', claimed_until = $1
      where channel = 'email'`,
    [new Date(now.getTime() + MINUTE)],
  )
  w.mail.sent.length = 0
  w.clock.set(new Date(now.getTime() + 2 * MINUTE))
  expect(await watchWorker(w.deps)).toMatchObject({ outcome: 'same', sent: 1 })
  expect(w.mail.sent.map((m) => m.subject)).toEqual([expect.stringContaining('fermo')])
})
