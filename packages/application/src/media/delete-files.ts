import { mediaPrefix } from '@app/domain'
import { isUuid } from '../identity/index.js'
import type { Storage } from '../ports/storage.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'

export interface MediaDeleteFilesJob {
  organizationId: string
  mediaId: string
}

/**
 * `media.delete_files`: every file of a deleted media goes, the original and each copy, then
 * their rows. Repeatable: the folder of the media is removed whole, so a run that stopped
 * halfway is finished by the next one. A media not deleted (or of another agency) is left alone.
 */
export async function deleteMediaFiles(
  deps: { uow: UnitOfWork; storage: Storage },
  job: MediaDeleteFilesJob,
): Promise<{ outcome: 'skipped' } | { outcome: 'deleted'; files: number }> {
  if (!isUuid(job.organizationId)) throw new Error('media files job without organizationId')
  if (!isUuid(job.mediaId)) throw new Error('media files job without mediaId')
  const { organizationId, mediaId } = job
  const scope = { organizationId, userId: null }
  const found = await deps.uow.run(scope, (tx) => tx.media.findById(organizationId, mediaId))
  if (found?.status !== 'deleted') return { outcome: 'skipped' }
  // every key of a media is under its folder (plan 04, storage keys): removing the folder
  // removes them all, also a copy whose row a crashed job never wrote
  const files = await deps.storage.deletePrefix(mediaPrefix(organizationId, mediaId))
  await deps.uow.run(scope, (tx) => tx.media.forgetFiles(organizationId, mediaId))
  return { outcome: 'deleted', files }
}
