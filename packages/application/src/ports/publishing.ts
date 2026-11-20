import type {
  AttemptOutcome,
  OutboxEventType,
  OutboxPayload,
  PostType,
  PublishingPostStatus,
  TargetStatus,
  TargetStep,
} from '@app/domain'

// The publishing of the destinations (spec §9, §13; plan 07 Task 3). It lives in the `posts`
// module (P1): the jobs of the worker read and write `post_targets` through here. Every method
// but `dueTargets` takes the agency and filters by it in SQL as well: row level security is the
// second barrier.

/** A destination as the worker's steps read it. */
export interface PublishingTargetRecord {
  id: string
  organizationId: string
  workspaceId: string
  postId: string
  accountId: string
  status: TargetStatus
  step: TargetStep | null
  /** grows at every move and every new look at a container: the jobs' keys (P3) */
  generation: number
  /** the ids received from Meta, saved after every call (§8.5) */
  metaIds: Record<string, unknown> | null
  externalPostId: string | null
  permalink: string | null
  attempts: number
  nextAttemptAt: Date | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  publishedAt: Date | null
  verifiedAt: Date | null
  verification: unknown
}

/**
 * What a step writes on its destination. A new `status` is a move: the generation goes up by
 * one and the post's state is computed again from its destinations (Scelta 3). `renew` makes a
 * new generation without a move (a new look at a container, a new round of verification).
 */
export type TargetStepPatch = Partial<
  Pick<
    PublishingTargetRecord,
    | 'status'
    | 'step'
    | 'metaIds'
    | 'externalPostId'
    | 'permalink'
    | 'attempts'
    | 'nextAttemptAt'
    | 'lastErrorCode'
    | 'lastErrorMessage'
    | 'publishedAt'
    | 'verifiedAt'
    | 'verification'
  >
> & {
  renew?: boolean
  /** the preparation's claim (`claimPrepare`); null gives it back */
  claimedUntil?: Date | null
  /** the check 3 hours before (Scelta 4); null: done */
  recheckAt?: Date | null
}

/** One call of a step (`target_attempts`): codes and a duration, never a text or a token. */
export interface NewTargetAttempt {
  organizationId: string
  workspaceId: string
  targetId: string
  step: TargetStep
  outcome: AttemptOutcome
  /** Feedway's code (`PublishErrorCode`) */
  errorCode?: string | null
  /** Meta's `code` or `code/subcode` */
  metaErrorCode?: string | null
  durationMs: number
}

/** One call of a destination of a post, as the page of the outcome reads it. */
export interface PostAttempt {
  targetId: string
  accountId: string
  step: TargetStep
  outcome: AttemptOutcome
  errorCode: string | null
  createdAt: Date
}

/** A destination whose time has come, for the reconciler. */
export interface DueTarget {
  organizationId: string
  workspaceId: string
  targetId: string
  status: TargetStatus
  step: TargetStep | null
  generation: number
  nextAttemptAt: Date
}

/** A destination whose check 3 hours before has come (Scelta 4), for the reconciler. */
export interface DueRecheck {
  organizationId: string
  targetId: string
  generation: number
}

/** A destination of the account that came out, for the uncertain search and the reels of 24h. */
export interface PublishedTarget {
  targetId: string
  postId: string
  type: PostType
  externalPostId: string | null
  publishedAt: Date
}

export interface PublishingRepository {
  /**
   * Locks the destination until the transaction ends (`FOR UPDATE`), its post first, as the
   * panel's saves do, so the two never wait on each other in a circle. null: no such
   * destination in the agency.
   */
  lockTarget(organizationId: string, targetId: string): Promise<PublishingTargetRecord | null>
  /**
   * Writes the step on a destination locked by `lockTarget`; with a move, saves the post's state
   * from its destinations. null: no such destination.
   */
  saveStep(
    organizationId: string,
    targetId: string,
    patch: TargetStepPatch,
  ): Promise<{ generation: number; postStatus: PublishingPostStatus } | null>
  recordAttempt(attempt: NewTargetAttempt): Promise<void>
  /**
   * Claims a preparation on Meta for the destination until `until`, if its agency has fewer than
   * `perOrganization` and its account fewer than `perAccount` running (plan 07 «Lavori
   * pesanti»): claims of the agency go one at a time, and an expired claim no longer counts.
   * false: the destination waits for its turn.
   */
  claimPrepare(
    organizationId: string,
    targetId: string,
    claim: { now: Date; until: Date; perOrganization: number; perAccount: number },
  ): Promise<boolean>
  /**
   * The destinations of every agency in a step of the worker whose `next_attempt_at` has come,
   * the oldest first. Only in the system scope (the reconciler); a scheduled destination is due
   * once its scheduling wrote `next_attempt_at` (`prepareAt`). `statuses`: only these (the
   * steps the reconciler has a job for), every state of the worker when left out.
   */
  dueTargets(now: Date, limit: number, statuses?: readonly TargetStatus[]): Promise<DueTarget[]>
  /**
   * The destinations of every agency whose check 3 hours before has come, the oldest first,
   * whatever their state (the check clears the ones gone past `scheduled`). Only in the system
   * scope (the reconciler).
   */
  dueRechecks(now: Date, limit: number): Promise<DueRecheck[]>
  /**
   * The posts of the agency whose copies to publish are still needed (Scelta 5): a destination
   * scheduled or on its way, or one that ended (`confirmed`, `cancelled`, `failed`, `problem`)
   * after `endedAfter`, so that «Riprova» still finds them. Drafts need none.
   */
  postsNeedingCopies(
    organizationId: string,
    endedAfter: Date,
  ): Promise<{ postId: string; workspaceId: string }[]>
  /** The destinations of a post of the agency, in the order they were added. */
  targetsOfPost(organizationId: string, postId: string): Promise<PublishingTargetRecord[]>
  /** The same for several posts in one query, by post and then in the order they were added. */
  targetsOfPosts(
    organizationId: string,
    postIds: readonly string[],
  ): Promise<PublishingTargetRecord[]>
  /**
   * The calls of the destinations of a post that ended a step or failed it for good (`done`,
   * `permanent`, `uncertain`), the latest first, at most `limit`: the activity of the page of the
   * outcome (plan 07 Scelta 6).
   */
  attemptsOfPost(organizationId: string, postId: string, limit: number): Promise<PostAttempt[]>
  /** The destinations of the account published in `[from, to)`, the latest first. */
  publishedNear(
    organizationId: string,
    accountId: string,
    range: { from: Date; to: Date },
  ): Promise<PublishedTarget[]>
}

/** An event for stage 8's notifications; `organizationId` null: one of the platform. */
export interface OutboxEvent {
  organizationId: string | null
  type: OutboxEventType
  payload: OutboxPayload
}

/** Writes in the transaction of the change it tells of (§12.2). */
export interface Outbox {
  record(event: OutboxEvent): Promise<void>
}
