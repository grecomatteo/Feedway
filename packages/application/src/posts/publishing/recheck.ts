import { DomainError } from '@app/domain'
import type { DueRecheck } from '../../ports/publishing.js'
import { checkPostInTx } from '../../rules/index.js'
import { toCheckInput } from '../to-check-input.js'
import { blocksOf, publisherOf, type PublishingWorkerDeps } from './context.js'

// The check 3 hours before (plan 07 Scelta 4, D-74): the scheduled post is checked again as the
// worker will publish it, so a file that will not go out is told hours before, not at its time
// (stage 8 reads `post.file_wont_publish` and writes to the person who scheduled). Only a
// destination still `scheduled`: from the preparation on, the steps check by themselves.

/** The blocks that only wait for a file still being processed: the preparation waits too. */
const WAITS = new Set(['media_processing'])

export type RecheckOutcome = 'skipped' | 'fine' | 'told'

export async function recheckTarget(
  deps: Pick<
    PublishingWorkerDeps,
    'uow' | 'clock' | 'logger' | 'platformRules' | 'publishingHistory'
  >,
  due: DueRecheck,
): Promise<RecheckOutcome> {
  return deps.uow.run({ organizationId: due.organizationId, userId: null }, async (tx) => {
    const target = await tx.publishing.lockTarget(due.organizationId, due.targetId)
    if (!target || target.generation !== due.generation) return 'skipped'
    const done = () => tx.publishing.saveStep(target.organizationId, target.id, { recheckAt: null })
    if (target.status !== 'scheduled') {
      await done()
      return 'skipped'
    }
    const scope = { organizationId: target.organizationId, workspaceId: target.workspaceId }
    const post = await tx.posts.find(scope, target.postId)
    const organization = await tx.organizations.findById(target.organizationId)
    // the preparation pauses it, and says why: nothing to tell here
    const actor =
      post?.scheduledAt && organization?.status === 'active' ? await publisherOf(tx, post) : null
    if (!post || !actor) {
      await done()
      return 'skipped'
    }
    let blocks: string[]
    try {
      const report = await checkPostInTx(tx, deps, actor, toCheckInput(post, 'publish'))
      blocks = blocksOf(report, target.accountId).filter((b) => !WAITS.has(b))
    } catch (error) {
      // a client archived or a post gone meanwhile: the preparation finds it too
      if (!(error instanceof DomainError)) throw error
      deps.logger.warn({ targetId: target.id, code: error.code }, 'check before publishing refused')
      await done()
      return 'skipped'
    }
    await done()
    if (blocks.length === 0) return 'fine'
    await tx.outbox.record({
      organizationId: target.organizationId,
      type: 'post.file_wont_publish',
      payload: {
        postId: target.postId,
        targetId: target.id,
        accountId: target.accountId,
        workspaceId: target.workspaceId,
        code: blocks[0] ?? null,
        when: 'before',
      },
    })
    return 'told'
  })
}
