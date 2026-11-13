import type {
  Auth,
  AvatarProcessor,
  Clock,
  ConnectionTokens,
  IdGenerator,
  JobQueue,
  JobPayloads,
  Logger,
  Mailer,
  PlatformConnectors,
  QueueName,
  SignedTokens,
  Storage,
  Translate,
  UnitOfWork,
  ZipWriter,
} from '@app/application'

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
  /** Removes every credential of a person the retention anonymizes. */
  credentials: Pick<Auth, 'deleteAllCredentials'>
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
  /** sharp, for the pictures of the social accounts (plan 04 Task 4). */
  images: AvatarProcessor
}

export type JobHandler<N extends QueueName> = (
  job: { id: string; data: JobPayloads[N] },
  deps: JobHandlerDeps,
) => Promise<void>

export type JobHandlers = { [N in QueueName]: JobHandler<N> }
