import { DomainError, instantToZoned, type CheckPurpose } from '@app/domain'
import type { PostRecord } from '../ports/posts.js'
import type { PostCheckInput } from '../rules/index.js'

export const noDate = () =>
  new DomainError('VALIDATION', 'Scegli il giorno e l’ora del post', { field: 'when' })

/**
 * The saved post as the checks take it (plan 06, Scelta 9): its own time zone and its choices,
 * and no text for a story. The text stays saved with the draft and comes back when the type
 * changes; `story_caption_ignored` is only for someone who calls the API with a text. A post
 * with no date yet cannot be checked for scheduling.
 */
export function toCheckInput(post: PostRecord, purpose: CheckPurpose): PostCheckInput {
  if (post.scheduledAt === null) throw noDate()
  const { localDate, localTime } = instantToZoned(post.scheduledAt, post.timezone)
  return {
    workspaceId: post.workspaceId,
    type: post.type,
    mediaIds: post.mediaIds,
    ...(post.cover === null ? {} : { cover: post.cover }),
    caption:
      post.type === 'story' ? { common: '' } : { common: post.caption, ...post.captionByPlatform },
    destinations: post.targets.map((t) => ({ accountId: t.accountId })),
    when: { mode: 'at', localDate, localTime },
    shareToFeed: post.options.shareToFeed,
    choices: post.options.choices,
    purpose,
    postId: post.id,
  }
}
