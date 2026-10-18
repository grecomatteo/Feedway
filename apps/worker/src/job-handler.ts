import type { JobPayloads, Logger, QueueName } from '@app/application'

/** What a handler may use; the composition root adds the unit of work and the rest. */
export interface JobHandlerDeps {
  logger: Logger
}

export type JobHandler<N extends QueueName> = (
  job: { id: string; data: JobPayloads[N] },
  deps: JobHandlerDeps,
) => Promise<void>

export type JobHandlers = { [N in QueueName]: JobHandler<N> }
