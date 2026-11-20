// The events the publishing writes in the outbox for stage 8's notifications (§12.2, plan 07
// «Eventi»), in the same transaction as the move they tell of.

export const OUTBOX_EVENT_TYPES = [
  /** one destination is confirmed */
  'post.target_confirmed',
  /** every destination of the post is */
  'post.confirmed',
  'post.target_failed',
  'post.target_problem',
  'post.paused',
  /** a file of a scheduled post cannot be published (D-74) */
  'post.file_wont_publish',
  /** Instagram's quota below 10%, once per window */
  'account.quota_low',
] as const
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number]

/** Ids and codes only: never a text, a name or a token (plan 07 «Eventi»). */
export type OutboxPayload = Readonly<Record<string, string | number | boolean | null>>
