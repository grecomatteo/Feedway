import { refreshCollaborators } from '@app/application'
import type { JobHandler } from '../job-handler.js'
import { publishingDeps } from './target-steps.js'

// `posts.collaborators_refresh` (plan 09 Task 15): the answers of the collaborators invited on
// Instagram, after the post is confirmed and at «Aggiorna» on the page of the outcome.
export const postsCollaboratorsRefresh: JobHandler<'posts.collaborators_refresh'> = async (
  job,
  deps,
) => {
  const report = await refreshCollaborators(publishingDeps(deps), {
    ...job.data,
    ...(job.signal ? { signal: job.signal } : {}),
  })
  deps.logger.info({ jobId: job.id, postId: job.data.postId, ...report }, 'collaborators read')
}
