import { ConfigError, loadConfig } from '@app/config'
import { createLogger, createPgBossQueue, QUEUE_NAMES } from '@app/infrastructure'
import { startWorker } from './start-worker.js'

const EXIT_CONFIG = 78

async function main(): Promise<void> {
  let config
  try {
    config = loadConfig('worker', process.env)
  } catch (error) {
    if (error instanceof ConfigError) {
      // the message lists variables and problems, never values
      console.error(error.message)
      process.exit(EXIT_CONFIG)
    }
    throw error
  }

  const logger = createLogger({ service: 'worker', level: config.logLevel })
  const queue = await createPgBossQueue({ url: config.databaseUrl, logger, role: 'consumer' })
  const worker = await startWorker({
    queue,
    logger,
    heartbeatPath: process.env['WORKER_HEARTBEAT_FILE'] ?? '/tmp/worker-heartbeat',
    heartbeatEveryMs: 10_000,
    queues:
      config.workerQueues === 'all'
        ? QUEUE_NAMES
        : QUEUE_NAMES.filter((name) => config.workerQueues.includes(name)),
  })
  logger.info({}, 'worker started')

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'stopping worker')
    worker.stop().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, 'worker did not stop cleanly')
        process.exit(1)
      },
    )
  }
  process.once('SIGTERM', () => {
    shutdown('SIGTERM')
  })
  process.once('SIGINT', () => {
    shutdown('SIGINT')
  })
}

await main()
