import type { CopyTurn, MediaTurn } from '../ports/media.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

// The one read of `media.process` across the agencies (ADR 021, approved by Matteo): which file
// comes next, at its agency's turn. Ids only; the file is then processed in its own agency's
// scope. Listed in the ESLint rule on `runAsSystem`.

export function nextMediaTurn(uow: UnitOfWork): Promise<MediaTurn | null> {
  return uow.runAsSystem('media.process: next file at its turn', (tx) => tx.media.nextToProcess())
}

/** The same for the copies to publish (plan 07 Task 6): which copy comes next, at its turn. */
export function nextCopyTurn(uow: UnitOfWork): Promise<CopyTurn | null> {
  return uow.runAsSystem('media.publish_copies: next copy at its turn', (tx) =>
    tx.media.nextCopyToMake(),
  )
}

/**
 * After a conversion, or at the worker's start: the next copy and the next file waiting each get
 * a wake-up, so neither waits for the other kind's queue to drain.
 */
export async function wakeMediaWork(
  deps: { uow: UnitOfWork; queue: Pick<JobQueue, 'send'>; logger: Logger },
  dedupe?: string,
): Promise<void> {
  try {
    const copy = await nextCopyTurn(deps.uow)
    if (copy)
      await deps.queue.send(
        'media.publish_copies',
        { organizationId: copy.organizationId, postId: null },
        dedupe ? { dedupeKey: `copies-${dedupe}` } : {},
      )
    const file = await nextMediaTurn(deps.uow)
    if (file) await deps.queue.send('media.process', file, dedupe ? { dedupeKey: dedupe } : {})
  } catch (error) {
    // the clean-up, every ten minutes, wakes what is left waiting
    deps.logger.error({ err: error }, 'next media wake-up not queued')
  }
}
