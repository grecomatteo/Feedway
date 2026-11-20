import type { Clock } from '../ports/clock.js'
import type { Logger } from '../ports/logger.js'
import type { Storage } from '../ports/storage.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

// `media.publish_copies_cleanup` (plan 07 Task 7, Scelta 5), every night: the copies to publish
// (those with a recipe) that no post needs any more go, rows and bytes. The
// files of the library stay: only a person deletes them. Which copies the posts still need is
// the posts module's to say (`copiesInUse`), so the media module never reads the posts. The
// system scope only lists the agencies; each one is cleaned in its own scope.

/**
 * A copy younger than this is left alone: it may be of a post being scheduled while the
 * clean-up reads. One taken by mistake is asked for again by the preparation anyway.
 */
export const PUBLISH_COPY_MIN_AGE_MS = 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** What the posts module says the agency's posts still need. */
export interface CopiesStillNeeded {
  /** `<mediaId>/<purpose>/<recipe>` of each copy needed */
  keys: ReadonlySet<string>
  /** files whose every copy stays */
  mediaIds: ReadonlySet<string>
}

export interface PublishCopiesCleanupDeps {
  uow: UnitOfWork
  clock: Clock
  storage: Pick<Storage, 'delete'>
  logger: Logger
  /** MEDIA_RETENTION_DAYS: how long the copies of an ended post stay, for «Riprova». */
  retentionDays: number
  copiesInUse: (tx: Tx, organizationId: string, endedAfter: Date) => Promise<CopiesStillNeeded>
}

export interface PublishCopiesCleanupReport {
  organizations: number
  /** copies removed, rows and bytes */
  removed: number
  /** agencies whose step failed: logged, and the job fails at the end to be retried */
  failed: number
}

export async function cleanupPublishCopies(
  deps: PublishCopiesCleanupDeps,
): Promise<PublishCopiesCleanupReport> {
  const now = deps.clock.now()
  const endedAfter = new Date(now.getTime() - deps.retentionDays * DAY_MS)
  const createdBefore = new Date(now.getTime() - PUBLISH_COPY_MIN_AGE_MS)
  const organizations = await deps.uow.runAsSystem('media.publish_copies_cleanup: agencies', (tx) =>
    tx.organizations.listAll(),
  )
  const report: PublishCopiesCleanupReport = {
    organizations: organizations.length,
    removed: 0,
    failed: 0,
  }
  for (const { id: organizationId } of organizations) {
    try {
      const keys = await deps.uow.run({ organizationId, userId: null }, async (tx) => {
        const copies = await tx.media.recipeCopiesBefore(organizationId, createdBefore)
        if (copies.length === 0) return []
        const needed = await deps.copiesInUse(tx, organizationId, endedAfter)
        const unused = copies.filter(
          (c) =>
            !needed.mediaIds.has(c.mediaId) &&
            !needed.keys.has(`${c.mediaId}/${c.purpose}/${c.recipe}`),
        )
        const dropped = await tx.media.dropCopies(
          organizationId,
          unused.map((c) => c.id),
        )
        // the bytes go before the commit: the deleted rows stay locked until then, so a copy
        // asked for again meanwhile (its key is the same) waits, and its new bytes come after
        for (const key of dropped)
          await deps.storage.delete(key).catch((error: unknown) => {
            deps.logger.warn({ err: error, organizationId }, 'publish copy bytes not deleted')
          })
        return dropped
      })
      report.removed += keys.length
    } catch (error) {
      report.failed += 1
      deps.logger.error({ err: error, organizationId }, 'publish copies clean-up failed')
    }
  }
  if (report.failed > 0)
    throw new Error(`publish copies clean-up failed for ${String(report.failed)} agencies`)
  return report
}
