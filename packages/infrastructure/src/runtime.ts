import { createMailSettings } from '@app/application'
import type {
  Clock,
  IdGenerator,
  JobQueue,
  KeyRing,
  Logger,
  IntegrationStore,
  MailSettingsSource,
  Mailer,
  RateLimiter,
  SignedTokens,
  TokenService,
  Storage,
  UnitOfWork,
} from '@app/application'
import type { WebConfig } from '@app/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKeyRing } from './crypto/key-ring.js'
import { createSignedTokens } from './crypto/signed-tokens.js'
import { createTokenService } from './crypto/tokens.js'
import { createFileMailer } from './mail/file-mailer.js'
import { createSmtpMailer } from './mail/smtp-mailer.js'
import { createSmtpSender } from './mail/smtp/smtp-sender.js'
import { createIntegrationStore } from './db/integrations/integration-store.js'
import { createDb } from './db/client.js'
import type { Db, DbHandle } from './db/client.js'
import { createPgRateLimiter } from './db/rate-limiter.js'
import { createUnitOfWork } from './db/unit-of-work.js'
import { createLocalDiskStorage } from './storage/local-disk-storage.js'
import { createLogger } from './logging/logger.js'
import { createPgBossQueue } from './queue/pg-boss-queue.js'
import { systemClock } from './system/clock.js'
import { uuidV7Generator } from './system/id-generator.js'

export type RuntimeRole = 'web' | 'worker'

/** The settings the runtime reads; web and worker configs both carry them. */
export type RuntimeConfig = Pick<
  WebConfig,
  'nodeEnv' | 'databaseUrl' | 'encryptionKey' | 'logLevel'
> & {
  /** Folder for stored files; the `media` volume is mounted at the default. */
  mediaRoot?: string
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
  /** The web only sends jobs; the worker also consumes them. */
  queue: JobQueue
  clock: Clock
  ids: IdGenerator
  uow: UnitOfWork
  keyRing: KeyRing
  rateLimiter: RateLimiter
  storage: Storage
  /** Security-lock links and device hashes, keyed from APP_ENCRYPTION_KEY. */
  signedTokens: SignedTokens
  /** Random single-use tokens of our links (invites, activation). */
  tokens: TokenService
  /** The platform integrations (SMTP), secrets sealed; used inside `runAsSystem`. */
  integrations: IntegrationStore
  /** A file mailbox in tests; elsewhere SMTP with the settings read at every send. */
  mailer: Mailer
  /** Closes the database pool. The caller stops the queue first, gracefully if it consumes. */
  close(): Promise<void>
}

const POOL_SIZE: Record<RuntimeRole, number> = { web: 10, worker: 5 }

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

export async function createRuntime(config: RuntimeConfig, role: RuntimeRole): Promise<Runtime> {
  const logger = createLogger({ service: role, level: config.logLevel })
  const clock = systemClock
  const ids = uuidV7Generator
  const handle = createDb(config.databaseUrl, { max: POOL_SIZE[role], applicationName: role })
  try {
    // Synchronous services first: the queue is started last so a failure above never leaves it running.
    const uow = createUnitOfWork({ db: handle.db, ids, logger })
    const keyRing = createKeyRing({ platformKey: config.encryptionKey, clock })
    const rateLimiter = createPgRateLimiter({ db: handle.db, clock })
    const storage = createLocalDiskStorage({ root: config.mediaRoot ?? DEFAULT_MEDIA_ROOT })
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
      signedTokens,
      tokens: createTokenService(),
      integrations,
      mailer,
      close: () => handle.close(),
    }
  } catch (error) {
    // Keep the original start-up error even if closing the pool fails too.
    await handle.close().catch(() => undefined)
    throw error
  }
}
