import type { Clock } from '../ports/clock.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import type { UploadParts } from '../ports/uploads.js'

// `media.uploads_cleanup` (plan 04 Task 9), every hour: the system job of the media module. The
// system scope only lists the agencies; each agency's clean-up runs in its own scope, so a
// mistake here cannot touch another agency's rows.

export interface UploadsCleanupDeps {
  uow: UnitOfWork
  clock: Clock
  queue: Pick<JobQueue, 'send'>
  uploadParts: UploadParts
  logger: Logger
}

export interface UploadsCleanupReport {
  organizations: number
  /** sessions removed, completed or not, after their 24 hours */
  expired: number
  /** folders of pieces no session knows any more */
  orphans: number
  /** deleted files whose bytes were still there, queued again to `media.delete_files` */
  requeued: number
  /** files still `processing` long after their last change, whose worker is woken again */
  woken: number
  /** agencies whose step failed: logged, and the job fails at the end to be retried */
  failed: number
}

/**
 * Pieces with no session younger than this are left alone: they may be of an upload created
 * while the clean-up was reading.
 */
export const ORPHAN_PARTS_MIN_AGE_MS = 60 * 60 * 1000

/**
 * A file `processing` with no change for this long may have lost its `media.process` (the queue
 * was down at completion): the worker is woken for it again.
 */
export const PROCESSING_STALE_MS = 15 * 60 * 1000

/**
 * For every agency: removes the uploads past their expiry with their pieces (their space is
 * free again) and the pieces no upload knows; then queues `media.delete_files` again for every
 * deleted file that still has bytes stored, which covers a queueing that failed after
 * `deleteMedia` committed, and `media.process` for every file `processing` for too long.
 */
export async function runMediaUploadsCleanup(
  deps: UploadsCleanupDeps,
): Promise<UploadsCleanupReport> {
  const now = deps.clock.now()
  const hour = now.toISOString().slice(0, 13)
  // suspended agencies too: their expired uploads hold space, their deleted files bytes
  const organizations = await deps.uow.runAsSystem('media.uploads_cleanup: agencies', (tx) =>
    tx.organizations.listAll(),
  )
  const report: UploadsCleanupReport = {
    organizations: organizations.length,
    expired: 0,
    orphans: 0,
    requeued: 0,
    woken: 0,
    failed: 0,
  }
  for (const { id: organizationId } of organizations) {
    try {
      const found = await deps.uow.run({ organizationId, userId: null }, async (tx) => ({
        expired: await tx.uploads.deleteExpired(organizationId, now),
        known: new Set(await tx.uploads.listIds(organizationId)),
        deleted: await tx.media.deletedWithFiles(organizationId),
        stale: await tx.media.processingSince(
          organizationId,
          new Date(now.getTime() - PROCESSING_STALE_MS),
        ),
      }))
      for (const uploadId of found.expired) await deps.uploadParts.remove(organizationId, uploadId)
      report.expired += found.expired.length
      for (const folder of await deps.uploadParts.list(organizationId))
        if (
          !found.known.has(folder.uploadId) &&
          now.getTime() - folder.modifiedAt.getTime() >= ORPHAN_PARTS_MIN_AGE_MS
        ) {
          await deps.uploadParts.remove(organizationId, folder.uploadId)
          report.orphans += 1
        }
      for (const mediaId of found.deleted) {
        // once an hour at most: a job still waiting is not doubled every run
        const id = await deps.queue.send(
          'media.delete_files',
          { organizationId, mediaId },
          { dedupeKey: `cleanup:${hour}:${mediaId}` },
        )
        if (id !== null) report.requeued += 1
      }
      for (const mediaId of found.stale) {
        const id = await deps.queue.send(
          'media.process',
          { organizationId, mediaId },
          { dedupeKey: `cleanup:${hour}:${mediaId}` },
        )
        if (id !== null) report.woken += 1
      }
    } catch (err) {
      report.failed += 1
      deps.logger.error({ organizationId, err }, 'media uploads clean-up step failed')
    }
  }
  deps.logger.info({ report }, 'media uploads clean-up done')
  if (report.failed > 0)
    throw new Error(`media uploads clean-up failed for ${String(report.failed)} agencies`)
  return report
}
