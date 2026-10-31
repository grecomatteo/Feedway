import { createAuthEventSink, resolveSessionUser, startEmailChange } from '@app/application'
import { ConfigError, PRODUCT_NAME, loadConfig } from '@app/config'
import {
  createAuthAdapter,
  createAvatarProcessor,
  createBetterAuth,
  createPasswordHasher,
  createRuntime,
  createTranslate,
} from '@app/infrastructure'
import it from '../../i18n/locales/it.json' with { type: 'json' }

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
      queue: runtime.queue,
      signedTokens: runtime.signedTokens,
      events: createAuthEventSink({
        uow: runtime.uow,
        queue: runtime.queue,
        tokens: runtime.signedTokens,
        clock: runtime.clock,
        logger: runtime.logger,
      }),
      resolveSessionUser: (session) =>
        resolveSessionUser(
          { uow: runtime.uow, config: { require2fa: config.require2fa } },
          session,
        ),
      emailChange: {
        mailer: runtime.mailer,
        start: (input) =>
          startEmailChange(
            {
              uow: runtime.uow,
              queue: runtime.queue,
              tokens: runtime.tokens,
              clock: runtime.clock,
              panelUrl: config.panelUrl,
            },
            input,
          ),
      },
    })
    const auth = createAuthAdapter(betterAuth, { db: runtime.db, clock: runtime.clock })
    runtime.logger.info({}, 'web started')
    return {
      ...runtime,
      config,
      auth,
      translate: createTranslate(it),
      avatars: createAvatarProcessor(),
    }
  }).catch((error: unknown) => {
    // the container restarts; the cause is in the log
    console.error('web failed to start', error instanceof Error ? error.message : error)
    process.exit(1)
  })

  // one line per request when its answer is done, errors and abandoned requests included
  // (h3's afterResponse skips answers written by the error handler)
  nitroApp.hooks.hook('request', (event) => {
    // the inner render of the error page (server/error.ts) belongs to the request already logged
    const internal = (event.node.req as { __unenv__?: unknown }).__unenv__ !== undefined
    if (internal && event.path.startsWith('/__nuxt_error')) return
    event.node.res.once('close', () => {
      const started = event.context['startedAt'] as number | undefined
      // a request answered before startup finished has no logger yet
      if (event.context.requestId === undefined) return
      useDeps().logger.info(
        {
          requestId: event.context.requestId,
          method: event.method,
          path: event.path.split('?')[0],
          status: event.node.res.statusCode,
          durationMs: started === undefined ? undefined : Date.now() - started,
        },
        'request',
      )
    })
  })
})
