import type {
  Clock,
  IdGenerator,
  JobPayloads,
  Logger,
  Mailer,
  QueueName,
  SignedTokens,
  Storage,
  Translate,
  UnitOfWork,
} from '@app/application'

/** What a handler may use; built by the composition root (createRuntime). */
export interface JobHandlerDeps {
  logger: Logger
  /** organization and user jobs open uow.run with the ids in their data */
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
  storage: Storage
  mailer: Mailer
  signedTokens: SignedTokens
  /** Texts of the emails, from the panel's it.json. */
  translate: Translate
  panel: { url: URL; productName: string; defaultTimezone: string }
}

export type JobHandler<N extends QueueName> = (
  job: { id: string; data: JobPayloads[N] },
  deps: JobHandlerDeps,
) => Promise<void>

export type JobHandlers = { [N in QueueName]: JobHandler<N> }
