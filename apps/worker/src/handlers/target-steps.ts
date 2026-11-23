import {
  prepareTarget,
  publishTarget,
  reconcilePublishing,
  searchTarget,
  verifyTarget,
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
    storage: deps.storage,
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

export const targetReconcile: JobHandler<'target.reconcile'> = async (job, deps) => {
  const log = await searchTarget(publishingDeps(deps), {
    ...job.data,
    jobId: job.id,
    ...(job.signal ? { signal: job.signal } : {}),
  })
  deps.logger.info({ jobId: job.id, targetId: job.data.targetId, ...log }, 'search step done')
}

export const targetVerify: JobHandler<'target.verify'> = async (job, deps) => {
  const log = await verifyTarget(publishingDeps(deps), {
    ...job.data,
    jobId: job.id,
    ...(job.signal ? { signal: job.signal } : {}),
  })
  deps.logger.info({ jobId: job.id, targetId: job.data.targetId, ...log }, 'verify step done')
}

export const schedulerReconcile: JobHandler<'scheduler.reconcile'> = async (job, deps) => {
  const report = await reconcilePublishing(publishingDeps(deps))
  if (report.sent > 0 || report.uncertain > 0 || report.rechecked > 0)
    deps.logger.info({ jobId: job.id, ...report }, 'publishing reconciled')
  // plan 08 P2: the notifications' dispatcher runs every minute too, for what no commit woke
  await deps.queue.send('notify.dispatch', {})
}
