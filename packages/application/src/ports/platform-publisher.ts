import type { Platform, PostType, PublishErrorCode } from '@app/domain'
import type { ConnectionCredentials } from './platform-connector.js'

// How a destination reaches its platform (ADR 019, spec §8.5; plan 07 Task 4). One
// implementation per platform, in `infrastructure/src/platforms/<name>/`: the posts module never
// knows what is behind an account. Every answer arrives classified, never as a platform error.

/**
 * The ids the platform gave so far, in the implementation's own shape: the worker saves them
 * as they are (`post_targets.meta_ids`) and hands them back at the next step.
 */
export type PublishMetaIds = Record<string, unknown>

/** What a destination publishes, already decided by the post, its rules and its choices. */
export interface PublishTarget {
  targetId: string
  account: { platform: Platform; externalId: string; pageId: string | null }
  /** The connection's token, opened for this step only: never logged, never saved. */
  credentials: ConnectionCredentials
  type: PostType
  /** Facebook: a reel beyond its length goes out as a plain video (choice `publish_as_video`). */
  asVideo: boolean
  /** The text this destination publishes (`publishedCaption`); '' for a story. */
  caption: string
  /** Reels: also in the feed of the followers (§9.1). */
  shareToFeed: boolean
  /** null before the first call. */
  metaIds: PublishMetaIds | null
  /** The published post, once `publish` gave it. */
  externalPostId: string | null
}

/** A public address the platform downloads (`/m/*`), in the order of the post. */
export interface PublishFile {
  kind: 'image' | 'video'
  url: string
}

export interface PublishFiles {
  items: PublishFile[]
  /** The reel's cover: an image to download, or the frame at an offset; null: the platform's. */
  cover: { url: string } | { offsetMs: number } | null
}

/**
 * How close the platform's limits are, from the last answer (§8.6): the worker slows down the
 * account above 80% of `accountPercent` and every account of the agency above 80% of
 * `appPercent`. null: the answer did not say.
 */
export interface PlatformLoad {
  accountPercent: number | null
  appPercent: number | null
  /** What the platform says to wait before the account is served again; 0 when nothing. */
  regainMinutes: number
}

export interface StepContext {
  /** The job's signal: a stopped worker aborts the call. */
  signal: AbortSignal
  /** Saves the ids after every call, before the next one (§8.5), so a step resumes there. */
  saveIds(ids: PublishMetaIds): Promise<void>
}

/** The last answer's counters, opaque to the posts module, and how close the limits are. */
export interface StepUsage {
  usage: unknown
  load: PlatformLoad
}

/**
 * `wait`: the platform is still working on the files (`processing`) or the account has no posts
 * left in its window (`quota`): try again at `retryAt`, without counting an attempt.
 * `expired`: what was prepared is gone (an Instagram container after 24 hours): prepare again.
 */
export type StepResult =
  | (StepUsage & {
      outcome: 'done'
      metaIds: PublishMetaIds
      /** Set by `publish`. */
      externalPostId: string | null
      permalink: string | null
    })
  | (StepUsage & {
      outcome: 'wait'
      metaIds: PublishMetaIds
      reason: 'processing' | 'quota'
      retryAt: Date
    })
  | (StepUsage & { outcome: 'expired'; metaIds: PublishMetaIds })

/** A post found on the account by the uncertain search (§9.5). */
export interface FoundPost {
  externalPostId: string
  permalink: string | null
  publishedAt: Date
}

/**
 * `pending`: the platform is still processing it (look again later); `problem`: it is not
 * there, it failed or it is not of the right type (§9.6).
 */
export type VerifyResult =
  | (StepUsage & { outcome: 'confirmed'; permalink: string | null })
  | (StepUsage & { outcome: 'pending' })
  | (StepUsage & { outcome: 'problem'; reason: 'not_found' | 'failed' | 'wrong_type' })

/**
 * A call that did not work. `transient`: try again later (`retryAt` when the platform said);
 * `permanent`: the destination fails with `code`; `uncertain`: the post may be out, search
 * before anything else (§9.5).
 */
export class PublishError extends Error {
  readonly kind: 'transient' | 'permanent' | 'uncertain'
  readonly code: PublishErrorCode
  /** The platform's own code (`code` or `code/subcode`), for `target_attempts`. */
  readonly platformCode: string | null
  readonly retryAt: Date | null
  readonly load: PlatformLoad | null

  constructor(fields: {
    kind: PublishError['kind']
    code: PublishErrorCode
    platformCode?: string | null
    retryAt?: Date | null
    load?: PlatformLoad | null
  }) {
    super(`publishing failed: ${fields.kind} ${fields.code}`)
    this.name = 'PublishError'
    this.kind = fields.kind
    this.code = fields.code
    this.platformCode = fields.platformCode ?? null
    this.retryAt = fields.retryAt ?? null
    this.load = fields.load ?? null
  }
}

export interface PlatformPublisher {
  /** Everything before the post goes out: uploads, containers, waits for the processing. */
  prepare(target: PublishTarget, files: PublishFiles, ctx: StepContext): Promise<StepResult>
  /**
   * The call that publishes. Never repeated by itself: a timeout is `uncertain`. The files are
   * those of `prepare`: a Facebook photo or video goes out in one call that fetches its file.
   */
  publish(target: PublishTarget, files: PublishFiles, ctx: StepContext): Promise<StepResult>
  /**
   * Throws away what `prepare` left on the platform and never published, after the post was
   * changed (plan 07, P2): Facebook's unpublished photos and videos. Only for a destination in
   * `preparing` or `ready`; what is already gone counts as thrown away, and a step that may have
   * published answers `uncertain`. The caller then starts the next round from empty `metaIds`:
   * what was prepared holds the old files and text (an Instagram container too).
   */
  discard(target: PublishTarget, signal: AbortSignal): Promise<void>
  /** The post of this destination on the account, published from `since` to 10 minutes later. */
  findPublished(target: PublishTarget, since: Date, signal: AbortSignal): Promise<FoundPost | null>
  /** Whether the published post exists, of the right type and done processing (§9.6). */
  verify(target: PublishTarget, signal: AbortSignal): Promise<VerifyResult>
}

/** The platforms this process can publish on; one left out has no publisher here. */
export type PlatformPublishers = { readonly [P in Platform]?: PlatformPublisher }
