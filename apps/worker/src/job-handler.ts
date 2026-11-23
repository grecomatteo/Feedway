import type {
  Auth,
  AvatarProcessor,
  Clock,
  ConnectionTokens,
  MediaProcessDeps,
  IdGenerator,
  IntegrationStore,
  JobQueue,
  JobPayloads,
  Logger,
  Mailer,
  PlatformConnectors,
  PlatformPublishers,
  PublishingHistory,
  QueueName,
  RateLimiter,
  SignedTokens,
  Storage,
  Translate,
  UnitOfWork,
  UploadParts,
  ZipWriter,
} from '@app/application'
import type { Platform, PlatformRules } from '@app/domain'

/** What a handler may use; built by the composition root (createRuntime). */
export interface JobHandlerDeps {
  logger: Logger
  /** A handler that fans work out queues the next jobs (lock notices, one per recipient). */
  queue: Pick<JobQueue, 'send'>
  /** organization and user jobs open uow.run with the ids in their data */
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  storage: Storage
  /** The pieces of the uploads (MEDIA_UPLOAD_DIR, on the media volume), for their clean-up. */
  uploadParts: UploadParts
  /** Removes every credential of a person the retention anonymizes. */
  credentials: Pick<Auth, 'deleteAllCredentials'>
  /** The retention deletes the idle counters of the rate limits. */
  rateLimiter: Pick<RateLimiter, 'deleteIdleBefore'>
  /** Builds the "Scarica i miei dati" archive. */
  zip: ZipWriter
  mailer: Mailer
  signedTokens: SignedTokens
  /** Texts of the emails, from the panel's it.json. */
  translate: Translate
  panel: { url: URL; productName: string; defaultTimezone: string }
  /** The platforms (ADR 019) and the sealed tokens of the connections, for the account jobs. */
  connectors: PlatformConnectors
  connectionTokens: ConnectionTokens
  /**
   * What `accounts.daily` computes the Meta reminders from (plan 08 Task 4): the agency's `meta`
   * integration and the Graph API version of the config; the days on the panel's calendar.
   */
  metaReminders: {
    integrations: Pick<IntegrationStore, 'get'>
    graph: { version: string; sunset: string }
  }
  /** sharp, for the pictures of the social accounts (plan 04 Task 4). */
  images: AvatarProcessor
  /** The publishing of the posts (plan 07 Task 7): the platforms and what the checks read. */
  publishing: {
    publishers: PlatformPublishers
    platformRules: ReadonlyMap<Platform, PlatformRules>
    publishingHistory: PublishingHistory
    /** PUBLIC_URL: where Meta downloads the copies; null: the public host is off. */
    publicUrl: URL | null
    /** MEDIA_RETENTION_DAYS: the copies of an ended post stay this long (Scelta 5). */
    copiesKeptDays: number
  }
  /** ffmpeg, ffprobe and sharp for the files of the library, one at a time (plan 04 Task 10). */
  media: Pick<
    MediaProcessDeps,
    'lock' | 'scratch' | 'probe' | 'transformer' | 'newPublicToken' | 'limits'
  >
}

export type JobHandler<N extends QueueName> = (
  /** `signal`: aborted when the job expires (ADR 021); absent in tests */
  job: { id: string; data: JobPayloads[N]; signal?: AbortSignal },
  deps: JobHandlerDeps,
) => Promise<void>

export type JobHandlers = { [N in QueueName]: JobHandler<N> }
