import { ConfigError, PRODUCT_NAME, loadConfig } from '@app/config'
import { photoMaxBytesOf } from '@app/domain'
import { join } from 'node:path'
import {
  createAdvisoryLock,
  createAvatarProcessor,
  createMediaScratch,
  createMediaTools,
  newPublicToken,
  createCredentialEraser,
  createRuntime,
  createZipWriter,
  QUEUE_NAMES,
} from '@app/infrastructure'
import { createTranslate, loadItalianMessages } from './i18n.js'
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

  const runtime = await createRuntime(config, 'worker')
  const { logger, queue, uow, clock, ids, storage, mailer, signedTokens } = runtime
  const worker = await startWorker({
    queue,
    logger,
    services: {
      uow,
      clock,
      ids,
      storage,
      uploadParts: runtime.uploadParts,
      credentials: { deleteAllCredentials: createCredentialEraser({ db: runtime.db }) },
      rateLimiter: runtime.rateLimiter,
      zip: createZipWriter(),
      mailer,
      signedTokens,
      translate: createTranslate(loadItalianMessages()),
      panel: {
        url: config.panelUrl,
        productName: PRODUCT_NAME,
        defaultTimezone: config.defaultTimezone,
      },
      connectors: runtime.connectors,
      connectionTokens: runtime.connectionTokens,
      metaReminders: {
        integrations: runtime.integrations,
        graph: { version: config.metaGraphVersion, sunset: config.metaGraphVersionSunset },
      },
      telegram: {
        api: runtime.telegram,
        integrations: runtime.integrations,
        tokens: runtime.tokens,
        lock: createAdvisoryLock(runtime.pool),
      },
      images: createAvatarProcessor(),
      publishing: {
        publishers: runtime.publishers,
        platformRules: runtime.platformRules,
        publishingHistory: runtime.publishingHistory,
        publicUrl: config.publicUrl,
        copiesKeptDays: config.mediaRetentionDays,
      },
      media: {
        ...createMediaTools({ maxVideoPixels: config.media.maxVideoPixels }),
        lock: createAdvisoryLock(runtime.pool),
        // on the media volume, outside the storage keys: /tmp is memory in the container
        scratch: createMediaScratch({ dir: join(config.mediaRoot, 'work') }),
        newPublicToken,
        limits: { ...config.media, photoMaxBytes: photoMaxBytesOf(runtime.platformRules) },
      },
    },
    heartbeatPath: process.env['WORKER_HEARTBEAT_FILE'] ?? '/tmp/worker-heartbeat',
    heartbeatEveryMs: 10_000,
    queues:
      config.workerQueues === 'all'
        ? QUEUE_NAMES
        : QUEUE_NAMES.filter((name) => config.workerQueues.includes(name)),
  })
  logger.info({}, 'worker started')
  // R9: without a public address Meta cannot fetch the files, and every destination fails
  if (config.publicUrl === null)
    logger.warn({}, 'PUBLIC_URL is empty: posts cannot be published until it is set')

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'stopping worker')
    worker
      .stop()
      .then(() => runtime.close())
      .then(
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
