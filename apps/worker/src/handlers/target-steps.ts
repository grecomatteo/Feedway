import {
  prepareTarget,
  publishTarget,
  reconcilePublishing,
  type PublishingWorkerDeps,
} from '@app/application'
import type { JobHandler, JobHandlerDeps } from '../job-handler.js'

// The jobs of the publishing (plan 07 Task 7): one step of one destination at a time, and the
// reconciler every minute. The use cases are in the posts module; here only the wiring.

export function publishingDeps(deps: JobHandlerDeps): PublishingWorkerDeps {
  return {
    uow: deps.uow,
    clock: deps.clock,
    queue: deps.queue,
    logger: deps.logger,
    ids: deps.ids,
    connectors: deps.connectors,
    connectionTokens: deps.connectionTokens,
    newPublicToken: deps.media.newPublicToken,
    publishers: deps.publishing.publishers,
    platformRules: deps.publishing.platformRules,
    publishingHistory: deps.publishing.publishingHistory,
    publicUrl: deps.publishing.publicUrl,
  }
}

export const targetPrepare: JobHandler<'target.prepare'> = async (job, deps) => {
  const log = await prepareTarget(publishingDeps(deps), {
    ...job.data,
    jobId: job.id,
    ...(job.signal ? { signal: job.signal } : {}),
  })
  deps.logger.info({ jobId: job.id, targetId: job.data.targetId, ...log }, 'prepare step done')
}

export const targetPublish: JobHandler<'target.publish'> = async (job, deps) => {
  const log = await publishTarget(publishingDeps(deps), {
    ...job.data,
    jobId: job.id,
    ...(job.signal ? { signal: job.signal } : {}),
  })
  deps.logger.info({ jobId: job.id, targetId: job.data.targetId, ...log }, 'publish step done')
}

export const schedulerReconcile: JobHandler<'scheduler.reconcile'> = async (job, deps) => {
  const report = await reconcilePublishing(publishingDeps(deps))
  if (report.sent > 0 || report.uncertain > 0 || report.rechecked > 0)
    deps.logger.info({ jobId: job.id, ...report }, 'publishing reconciled')
}
