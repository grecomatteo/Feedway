import { digestSections, sendDigest, startDigests, type DigestDeps } from '@app/application'
import type { JobHandler, JobHandlerDeps } from '../job-handler.js'
import { notifyDeps } from './notify.js'

// The morning digest (plan 08 Task 8): `report.daily` starts the digests due, every minute;
// `report.digest` computes and sends one person's, through the notifications' channels.

const SECTIONS = digestSections()

export function digestDeps(deps: JobHandlerDeps): DigestDeps {
  const notify = notifyDeps(deps)
  return {
    uow: deps.uow,
    clock: deps.clock,
    logger: deps.logger,
    t: notify.t,
    panelUrl: notify.panelUrl,
    defaultTimezone: notify.defaultTimezone,
    sections: SECTIONS,
    channels: notify.channels,
    metaReminders: { ...deps.metaReminders, timeZone: deps.panel.defaultTimezone },
  }
}

export const reportDaily: JobHandler<'report.daily'> = async (job, deps) => {
  const report = await startDigests({
    uow: deps.uow,
    clock: deps.clock,
    logger: deps.logger,
    queue: deps.queue,
    // the installation's advisory lock (ADR 021), shared with the media's
    lock: deps.media.lock,
    defaultTimezone: deps.panel.defaultTimezone,
  })
  if (report.sent > 0) deps.logger.info({ jobId: job.id, ...report }, 'digests started')
}

export const reportDigest: JobHandler<'report.digest'> = async (job, deps) => {
  const report = await sendDigest(digestDeps(deps), job.data, job.signal)
  deps.logger.info({ jobId: job.id, ...report }, 'digest done')
}
