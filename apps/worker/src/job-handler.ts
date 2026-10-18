import type {
  Clock,
  IdGenerator,
  JobPayloads,
  Logger,
  QueueName,
  UnitOfWork,
} from '@app/application'

/** What a handler may use; built by the composition root (createRuntime). */
export interface JobHandlerDeps {
  logger: Logger
  /** organization and user jobs open uow.run with the ids in their data */
  uow: UnitOfWork
  clock: Clock
  ids: IdGenerator
}

export type JobHandler<N extends QueueName> = (
  job: { id: string; data: JobPayloads[N] },
  deps: JobHandlerDeps,
) => Promise<void>

export type JobHandlers = { [N in QueueName]: JobHandler<N> }
