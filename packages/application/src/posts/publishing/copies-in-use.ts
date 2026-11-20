import { DomainError, distinctCopies, type CopyRequest } from '@app/domain'
import type { Tx } from '../../ports/tx.js'
import { checkPostInTx, publishFilesOfPost } from '../../rules/index.js'
import { toCheckInput } from '../to-check-input.js'
import { publisherOf, type PublishingWorkerDeps } from './context.js'

// The copies to publish the agency's posts still need (plan 07 Scelta 5), for the nightly
// clean-up of the media module, which never reads the posts itself: the posts scheduled or on
// their way, and those ended less than `MEDIA_RETENTION_DAYS` ago, so «Riprova» finds them. The
// copies are the ones the worker would publish now, so a copy of an old recipe (the post was
// changed) is not among them.

/** A copy as the clean-up compares it: its file, purpose and recipe. */
export const copyKey = (c: Pick<CopyRequest, 'mediaId' | 'purpose' | 'recipe'>) =>
  `${c.mediaId}/${c.purpose}/${c.recipe}`

export interface CopiesInUse {
  /** `copyKey` of each copy a post needs */
  keys: ReadonlySet<string>
  /**
   * Files whose every copy stays: a post whose copies cannot be told now (its author may no
   * longer publish, its client is archived). Better a copy kept a while than one missing.
   */
  mediaIds: ReadonlySet<string>
}

export async function publishCopiesInUse(
  tx: Tx,
  deps: Pick<PublishingWorkerDeps, 'clock' | 'logger' | 'platformRules' | 'publishingHistory'>,
  organizationId: string,
  endedAfter: Date,
): Promise<CopiesInUse> {
  const keys = new Set<string>()
  const mediaIds = new Set<string>()
  for (const { postId, workspaceId } of await tx.publishing.postsNeedingCopies(
    organizationId,
    endedAfter,
  )) {
    const post = await tx.posts.find({ organizationId, workspaceId }, postId)
    if (!post) continue
    const keepAll = () => {
      for (const id of post.mediaIds) mediaIds.add(id)
      if (post.cover?.source === 'image') mediaIds.add(post.cover.mediaId)
    }
    const actor = post.scheduledAt === null ? null : await publisherOf(tx, post)
    if (!actor) {
      keepAll()
      continue
    }
    try {
      const input = toCheckInput(post, 'publish')
      const report = await checkPostInTx(tx, deps, actor, input)
      const scope = { organizationId, workspaceId }
      const files = await publishFilesOfPost(tx, deps, scope, input, report)
      for (const c of distinctCopies(files)) keys.add(copyKey(c))
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      keepAll()
    }
  }
  return { keys, mediaIds }
}
