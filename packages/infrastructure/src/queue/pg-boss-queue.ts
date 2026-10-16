import { PgBoss } from 'pg-boss'
import type { JobQueue, Logger } from '@app/application'

export interface PgBossQueueOptions {
  url: string
  logger: Logger
  /** `producer` (web) never runs maintenance or schedules; `consumer` (worker) does. */
  role: 'producer' | 'consumer'
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
