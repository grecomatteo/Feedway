import type { JobQueue, Logger, QueueName } from '@app/application'
import { systemSelftest } from './handlers/system-selftest.js'
import type { JobHandler, JobHandlerDeps, JobHandlers } from './job-handler.js'
import { startHeartbeat } from './heartbeat.js'

export type { JobHandler, JobHandlerDeps, JobHandlers } from './job-handler.js'

export interface WorkerDeps {
  queue: JobQueue
  logger: Logger
  heartbeatPath: string
  heartbeatEveryMs: number
  /** Only these queues are consumed (WORKER_QUEUES, spec §6.4). */
  queues: readonly QueueName[]
  /** Overrides for tests; the real handlers are the default. */
  handlers?: Partial<JobHandlers>
}

const STOP_TIMEOUT_MS = 30_000

export async function startWorker(deps: WorkerDeps): Promise<{ stop(): Promise<void> }> {
  const { queue, logger, queues } = deps
  const handlers: JobHandlers = { 'system.selftest': systemSelftest, ...deps.handlers }
  const handlerDeps: JobHandlerDeps = { logger }

  const consume = async <N extends QueueName>(name: N, handler: JobHandler<N>) => {
    await queue.work(name, (job) => handler(job, handlerDeps))
    logger.info({ queue: name }, 'consuming queue')
  }
  for (const name of queues) await consume(name, handlers[name])
  const stopHeartbeat = startHeartbeat(deps.heartbeatPath, deps.heartbeatEveryMs)

  return {
    async stop() {
      stopHeartbeat()
      // lets running jobs finish; whatever is still active afterwards is retried after expiry
      await queue.stop({ graceful: true, timeoutMs: STOP_TIMEOUT_MS })
    },
  }
}
