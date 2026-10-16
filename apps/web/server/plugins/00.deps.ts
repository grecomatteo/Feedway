import { ConfigError, loadConfig } from '@app/config'
import {
  createDb,
  createLogger,
  createPgBossQueue,
  systemClock,
  uuidV7Generator,
} from '@app/infrastructure'

const EXIT_CONFIG = 78

export default defineNitroPlugin((nitroApp) => {
  initDeps(async () => {
    let config
    try {
      config = loadConfig('web', process.env)
    } catch (error) {
      if (error instanceof ConfigError) {
        // lists variables and problems, never values
        console.error(error.message)
        process.exit(EXIT_CONFIG)
      }
      throw error
    }

    const logger = createLogger({ service: 'web', level: config.logLevel })
    const { db, pool } = createDb(config.databaseUrl, { max: 10, applicationName: 'web' })
    const queue = await createPgBossQueue({ url: config.databaseUrl, logger, role: 'producer' })
    logger.info({}, 'web started')
    return { config, logger, db, pool, queue, clock: systemClock, ids: uuidV7Generator }
  }).catch((error: unknown) => {
    // the container restarts; the cause is in the log
    console.error('web failed to start', error instanceof Error ? error.message : error)
    process.exit(1)
  })

  nitroApp.hooks.hook('afterResponse', (event) => {
    const { logger } = useDeps()
    const requestId = event.context['requestId'] as string | undefined
    const started = event.context['startedAt'] as number | undefined
    logger.info(
      {
        requestId,
        method: event.method,
        path: event.path.split('?')[0],
        status: event.node.res.statusCode,
        durationMs: started === undefined ? undefined : Date.now() - started,
      },
      'request',
    )
  })
})
