import type {
  Clock,
  IdGenerator,
  JobQueue,
  KeyRing,
  Logger,
  Mailer,
  RateLimiter,
  SignedTokens,
  Storage,
  UnitOfWork,
} from '@app/application'
import type { WebConfig } from '@app/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKeyRing } from './crypto/key-ring.js'
import { createSignedTokens } from './crypto/signed-tokens.js'
import { createFileMailer } from './mail/file-mailer.js'
import { notConfiguredMailer } from './mail/not-configured-mailer.js'
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
  /** A file mailbox in tests; "not configured" elsewhere until stage 3 configures SMTP. */
  mailer: Mailer
  /** Closes the database pool. The caller stops the queue first, gracefully if it consumes. */
  close(): Promise<void>
}

const POOL_SIZE: Record<RuntimeRole, number> = { web: 10, worker: 5 }

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
    const mailer =
      config.nodeEnv === 'test'
        ? createFileMailer({ dir: TEST_MAIL_DIR, ids })
        : notConfiguredMailer
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
      mailer,
      close: () => handle.close(),
    }
  } catch (error) {
    // Keep the original start-up error even if closing the pool fails too.
    await handle.close().catch(() => undefined)
    throw error
  }
}
