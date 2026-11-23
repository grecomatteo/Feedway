// The events the publishing writes in the outbox for stage 8's notifications (§12.2, plan 07
// «Eventi»), in the same transaction as the move they tell of.

export const PUBLISHING_EVENT_TYPES = [
  /** one destination is confirmed */
  'post.target_confirmed',
  /** every destination of the post is */
  'post.confirmed',
  'post.target_failed',
  'post.target_problem',
  'post.paused',
  /** a file of a scheduled post cannot be published (D-74) */
  'post.file_wont_publish',
] as const
