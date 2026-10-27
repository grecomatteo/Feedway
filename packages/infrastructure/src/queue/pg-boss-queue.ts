import { createHash } from 'node:crypto'
import { PgBoss } from 'pg-boss'
import type { JobQueue, Logger } from '@app/application'

export interface PgBossQueueOptions {
  url: string
  logger: Logger
  /** `producer` (web) never runs maintenance or schedules; `consumer` (worker) does. */
  role: 'producer' | 'consumer'
}

/** A uuid fixed by queue and key: pg-boss inserts a job id only once (ON CONFLICT DO NOTHING). */
function dedupeId(name: string, key: string): string {
  const h = createHash('sha256').update(`${name}\u0000${key}`).digest('hex')
  // version 8 (custom) and the RFC 4122 variant bits
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`
}

export async function createPgBossQueue(opts: PgBossQueueOptions): Promise<JobQueue> {
  const { url, logger, role } = opts
  const consumer = role === 'consumer'
  const boss = new PgBoss({
    connectionString: url,
    schema: 'pgboss',
    migrate: false,
    supervise: consumer,
    schedule: consumer,
    application_name: consumer ? 'worker' : 'web',
    max: consumer ? 10 : 4,
    connectionTimeoutMillis: 3000,
  })
  // a database restart surfaces here; pg-boss reconnects on its own
  boss.on('error', (error) => {
    logger.error({ err: error }, 'pg-boss error')
  })
  await boss.start()

  return {
    async send(name, data, sendOpts) {
      return boss.send(name, data, {
        ...(sendOpts?.singletonKey !== undefined && { singletonKey: sendOpts.singletonKey }),
        ...(sendOpts?.startAfter !== undefined && { startAfter: sendOpts.startAfter }),
        ...(sendOpts?.dedupeKey !== undefined && { id: dedupeId(name, sendOpts.dedupeKey) }),
      })
    },
    async work(name, handler, workOpts) {
      await boss.work(name, { localConcurrency: workOpts?.concurrency ?? 1 }, async (jobs) => {
        for (const job of jobs) await handler({ id: job.id, data: job.data as never })
      })
    },
    async ping() {
      await boss.getDb().executeSql('select 1 from pgboss.queue limit 1', [])
    },
    async stop(stopOpts) {
      await boss.stop({ graceful: stopOpts.graceful, timeout: stopOpts.timeoutMs, close: true })
    },
  }
}
