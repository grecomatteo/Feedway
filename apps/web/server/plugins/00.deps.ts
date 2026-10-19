import { createAuthEventSink } from '@app/application'
import { ConfigError, PRODUCT_NAME, loadConfig } from '@app/config'
import {
  createAuthAdapter,
  createBetterAuth,
  createPasswordHasher,
  createRuntime,
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

    const runtime = await createRuntime(config, 'web')
    const betterAuth = createBetterAuth({
      db: runtime.db,
      config: {
        panelUrl: config.panelUrl.toString(),
        productName: PRODUCT_NAME,
        secret: config.betterAuth.secret,
        secrets: config.betterAuth.secrets,
      },
      ids: runtime.ids,
      clock: runtime.clock,
      hasher: createPasswordHasher(),
      rateLimiter: runtime.rateLimiter,
      logger: runtime.logger,
      events: createAuthEventSink({
        uow: runtime.uow,
        queue: runtime.queue,
        tokens: runtime.signedTokens,
        clock: runtime.clock,
        logger: runtime.logger,
      }),
    })
    const auth = createAuthAdapter(betterAuth, { db: runtime.db, clock: runtime.clock })
    runtime.logger.info({}, 'web started')
    return { ...runtime, config, auth }
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
        path: loggablePath(event.path),
        status: event.node.res.statusCode,
        durationMs: started === undefined ? undefined : Date.now() - started,
      },
      'request',
    )
  })
})
