import { isUuid } from '../identity/index.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

export interface MediaProcessJob {
  organizationId: string
  mediaId: string
}

/**
 * `media.process` until the worker processes the files (plan 04 Task 10, which replaces this):
 * the file just uploaded shows it is waiting in the queue. Nothing else changes, and a file not
 * `processing` (or of another agency) is left alone.
 */
export async function markMediaQueued(
  deps: { uow: UnitOfWork },
  job: MediaProcessJob,
): Promise<{ outcome: 'queued' | 'skipped' }> {
  if (!isUuid(job.organizationId)) throw new Error('media process job without organizationId')
  if (!isUuid(job.mediaId)) throw new Error('media process job without mediaId')
  const { organizationId, mediaId } = job
  const marked = await deps.uow.run({ organizationId, userId: null }, (tx) =>
    tx.media.setProgress(organizationId, mediaId, { step: 'queued', percent: 0 }),
  )
  return { outcome: marked ? 'queued' : 'skipped' }
}
