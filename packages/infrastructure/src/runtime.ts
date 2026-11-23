import { createMailSettings } from '@app/application'
import type {
  Clock,
  IdGenerator,
  JobQueue,
  JobScheduler,
  KeyRing,
  Logger,
  IntegrationStore,
  MailSettingsSource,
  Mailer,
  ConnectionTokens,
  MetaAppCredentials,
  PlatformConnector,
  PlatformConnectors,
  PlatformPublishers,
  PublishingHistory,
  RateLimiter,
  SignedTokens,
  TokenService,
  TelegramBotApi,
  Storage,
  UnitOfWork,
  UploadParts,
} from '@app/application'
import type { StorageConfig, WebConfig } from '@app/config'
import { platformRulesMap, type Platform, type PlatformRules } from '@app/domain'
import { META_RULES } from '@app/domain/platforms/meta'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKeyRing } from './crypto/key-ring.js'
import { createSignedTokens } from './crypto/signed-tokens.js'
import { createTokenService } from './crypto/tokens.js'
import { createFileMailer } from './mail/file-mailer.js'
import { createSmtpMailer } from './mail/smtp-mailer.js'
import { createSmtpSender } from './mail/smtp/smtp-sender.js'
import { createIntegrationStore } from './db/integrations/integration-store.js'
import { createConnectionTokens } from './db/accounts/connection-tokens.js'
import { createTelegramBotApi, TELEGRAM_API_URL } from './notifications/telegram-bot-api.js'
import { createMetaGraphClient } from './platforms/meta/graph-client.js'
import { createMetaPictureDownloader } from './platforms/meta/picture-download.js'
import { createMetaPublishers } from './platforms/meta/publisher.js'
import { createMetaSystemUserConnector } from './platforms/meta/system-user-connector.js'
import { createDb } from './db/client.js'
import type { Db, DbHandle } from './db/client.js'
import { createPgRateLimiter } from './db/rate-limiter.js'
import { createUnitOfWork } from './db/unit-of-work.js'
import { createDiskUploadParts } from './storage/disk-upload-parts.js'
import { createLocalDiskStorage } from './storage/local-disk-storage.js'
import { createS3Storage } from './storage/s3-storage.js'
import { createLogger } from './logging/logger.js'
import { newPublicToken } from './media/public-token.js'
import { createPgBossQueue } from './queue/pg-boss-queue.js'
import { systemClock } from './system/clock.js'
import { postgresPublishingHistory } from './system/publishing-history.js'
import { uuidV7Generator } from './system/id-generator.js'

export type RuntimeRole = 'web' | 'worker'

/** The settings the runtime reads; web and worker configs both carry them. */
export type RuntimeConfig = Pick<
  WebConfig,
  'nodeEnv' | 'databaseUrl' | 'encryptionKey' | 'logLevel'
> &
  // left out by the tests of modules that never call Meta
  Partial<
    Pick<
      WebConfig,
      'metaMode' | 'metaGraphVersion' | 'metaMockUrl' | 'metaRecordDir' | 'telegramApiUrl'
    >
  > & {
    /** Folder for stored files (MEDIA_ROOT); the `media` volume is mounted at the default. */
    mediaRoot?: string
    /** MEDIA_UPLOAD_DIR; MEDIA_ROOT/uploads without it. */
    media?: Pick<WebConfig['media'], 'uploadDir'>
    /** STORAGE_DRIVER and S3_*; the disk without it. */
    storage?: StorageConfig
    /** The panel's address (EHLO name of the mailer); `feedway.invalid` without it. */
    panelUrl?: URL
  }

export const DEFAULT_MEDIA_ROOT = '/media'

/** Shared by the web and the worker in tests, so end-to-end tests can read the emails. */
export const TEST_MAIL_DIR = join(tmpdir(), 'app-test-mail')

/** Everything a process needs, built once at start-up (composition root). */
export interface Runtime {
  logger: Logger
  db: Db
  pool: DbHandle['pool']
  /** The web only sends jobs; the worker also consumes them and keeps the schedules. */
  queue: JobQueue & JobScheduler
  clock: Clock
  ids: IdGenerator
  uow: UnitOfWork
  keyRing: KeyRing
  rateLimiter: RateLimiter
  storage: Storage
  /** The pieces of the uploads, on this machine's disk whatever the storage (ADR 021). */
  uploadParts: UploadParts
  /** Security-lock links and device hashes, keyed from APP_ENCRYPTION_KEY. */
  signedTokens: SignedTokens
  /** Random single-use tokens of our links (invites, activation). */
  tokens: TokenService
  /** The platform integrations (SMTP), secrets sealed; used inside `runAsSystem`. */
  integrations: IntegrationStore
  /** A file mailbox in tests; elsewhere SMTP with the settings read at every send. */
  mailer: Mailer
  /** The check of the agency's Meta app (plan 03 Task 4), shared by every Meta connector. */
  meta: Pick<PlatformConnector<MetaAppCredentials>, 'verifyApp'>
  /** Telegram's Bot API (plan 08 Task 7): api.telegram.org unless TELEGRAM_API_URL says otherwise. */
  telegram: TelegramBotApi
  /** The registry of the platforms (ADR 019): `connection kind → PlatformConnector`. */
  connectors: PlatformConnectors
  /** The publishers of the platforms (ADR 019, plan 07 Task 4): `platform → PlatformPublisher`. */
  publishers: PlatformPublishers
  /** The rules of the platforms (ADR 019, plan 05 R2): `platform → PlatformRules`. */
  platformRules: ReadonlyMap<Platform, PlatformRules>
  /** What is published or scheduled, for the checks (plan 05 R4): none until stages 6–7. */
  publishingHistory: PublishingHistory
  /** Seals and opens the tokens of the connections with the agency's data key. */
  connectionTokens: ConnectionTokens
  /** The public token of a new copy (`/m/*`): the copies a scheduled post asks for. */
  newPublicToken: () => string
  /** Closes the database pool. The caller stops the queue first, gracefully if it consumes. */
  close(): Promise<void>
}

/** Like the connectors, the platforms' rules are gathered here only (ADR 019). */
export const PLATFORM_RULES = platformRulesMap(META_RULES)

const POOL_SIZE: Record<RuntimeRole, number> = { web: 10, worker: 5 }

/** Without its settings the process has no way to Meta: a call is a bug, never a silent no. */
const META_NOT_CONFIGURED: Runtime['meta'] = {
  verifyApp: () => Promise.reject(new Error('Meta is not configured in this process')),
}

function createMeta(
  config: RuntimeConfig,
  deps: { clock: Clock; logger: Logger; integrations: IntegrationStore },
): Pick<Runtime, 'meta' | 'connectors' | 'publishers'> {
  const { metaMode: mode, metaGraphVersion: version } = config
  if (mode === undefined || version === undefined)
    return { meta: META_NOT_CONFIGURED, connectors: {}, publishers: {} }
  const client = createMetaGraphClient({
    mode,
    version,
    ...(mode === 'mock' &&
      typeof config.metaMockUrl === 'string' && { baseUrl: config.metaMockUrl }),
    clock: deps.clock,
    logger: deps.logger.child({ component: 'meta' }),
    recordDir: config.metaRecordDir ?? null,
  })
  const pictures = createMetaPictureDownloader({
    mode,
    ...(mode === 'mock' &&
      typeof config.metaMockUrl === 'string' && { mockUrl: config.metaMockUrl }),
  })
  const systemUser = createMetaSystemUserConnector({
    client,
    integrations: deps.integrations,
    pictures,
  })
  // the unified login (meta_business_login) joins with plan 03 Task 7
  return {
    meta: systemUser,
    connectors: { meta_system_user: systemUser },
    publishers: createMetaPublishers({ client, clock: deps.clock }),
  }
}

export interface MailerDeps {
  ids: IdGenerator
  logger: Logger
  settings: MailSettingsSource
  /** The panel's address: its host name is what the mailer says in EHLO. */
  panelUrl?: URL
}

/**
 * A file mailbox in tests; elsewhere SMTP, with the agency's settings or the platform default
 * read at every send (no message leaves while neither exists).
 */
export function createMailer(nodeEnv: RuntimeConfig['nodeEnv'], deps: MailerDeps): Mailer {
  return nodeEnv === 'test'
    ? createFileMailer({ dir: TEST_MAIL_DIR, ids: deps.ids })
    : createSmtpMailer({
        settings: deps.settings,
        smtp: createSmtpSender(
          deps.panelUrl === undefined ? {} : { clientName: deps.panelUrl.hostname },
        ),
        logger: deps.logger.child({ component: 'mailer' }),
      })
}

/** The disk under MEDIA_ROOT, or an S3 bucket with STORAGE_DRIVER=s3 (ADR 021). */
export function createStorage(config: Pick<RuntimeConfig, 'mediaRoot' | 'storage'>): Storage {
  const { storage } = config
  if (storage?.driver === 's3') return createS3Storage(storage)
  return createLocalDiskStorage({ root: config.mediaRoot ?? DEFAULT_MEDIA_ROOT })
}

export async function createRuntime(config: RuntimeConfig, role: RuntimeRole): Promise<Runtime> {
  const logger = createLogger({ service: role, level: config.logLevel })
  const clock = systemClock
  const ids = uuidV7Generator
  const handle = createDb(config.databaseUrl, { max: POOL_SIZE[role], applicationName: role })
  try {
    // Synchronous services first: the queue is started last so a failure above never leaves it running.
    // the queue starts last: until then a commit that wrote an event wakes nobody, and the
    // dispatcher's every-minute run takes it (plan 08 P2)
    let wakeDispatcher: (() => Promise<void>) | null = null
    const uow = createUnitOfWork({
      db: handle.db,
      ids,
      logger,
      afterEventsCommitted: () => wakeDispatcher?.() ?? Promise.resolve(),
    })
    const keyRing = createKeyRing({ platformKey: config.encryptionKey, clock })
    const rateLimiter = createPgRateLimiter({ db: handle.db, clock })
    const storage = createStorage(config)
    const signedTokens = createSignedTokens(config.encryptionKey)
    const integrations = createIntegrationStore({ keyRing })
    const mailer = createMailer(config.nodeEnv, {
      ids,
      logger,
      settings: createMailSettings({ uow, integrations }),
      ...(config.panelUrl !== undefined && { panelUrl: config.panelUrl }),
    })
    const queue = await createPgBossQueue({
      url: config.databaseUrl,
      logger,
      role: role === 'worker' ? 'consumer' : 'producer',
    })
    wakeDispatcher = async () => {
      await queue.send('notify.dispatch', {})
    }
    return {
      logger,
      db: handle.db,
      pool: handle.pool,
      queue,
      clock,
      ids,
      uow,
      keyRing,
      rateLimiter,
      storage,
      uploadParts: createDiskUploadParts({
        dir: config.media?.uploadDir ?? join(config.mediaRoot ?? DEFAULT_MEDIA_ROOT, 'uploads'),
      }),
      signedTokens,
      tokens: createTokenService(),
      integrations,
      mailer,
      ...createMeta(config, { clock, logger, integrations }),
      telegram: createTelegramBotApi({
        baseUrl: config.telegramApiUrl ?? new URL(TELEGRAM_API_URL),
      }),
      platformRules: PLATFORM_RULES,
      publishingHistory: postgresPublishingHistory,
      connectionTokens: createConnectionTokens({ keyRing }),
      newPublicToken,
      close: () => handle.close(),
    }
  } catch (error) {
    // Keep the original start-up error even if closing the pool fails too.
    await handle.close().catch(() => undefined)
    throw error
  }
}
