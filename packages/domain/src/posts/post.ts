import type { Platform } from '../accounts/accounts.js'
import type { PostType, RuleChoice } from '../rules/types.js'

// The posts of a workspace (spec §9.1, §11.2, §13; plan 06 Task 3). Stage 6 knows only the
// states before publishing: the rest of §9.3 arrives with stage 7, in `publishing`.

/** The states of a post and of its destinations in stage 6 (plan 06, «Stati della tappa 6»). */
export const POST_STATUSES = ['draft', 'scheduled', 'cancelled'] as const
export type PostStatus = (typeof POST_STATUSES)[number]

/** A reel's cover: a frame of the video, or a photo of the workspace (§11.2 point 3). */
export type PostCover = { source: 'frame'; offsetMs: number } | { source: 'image'; mediaId: string }

/** What the post keeps besides its text (P5): the answers to the warnings travel with it. */
export interface PostOptions {
  /** a reel also in the feed (§9.1) */
  shareToFeed: boolean
  choices: RuleChoice[]
}

export const EMPTY_POST_OPTIONS: PostOptions = { shareToFeed: true, choices: [] }

export interface Post {
  id: string
  organizationId: string
  workspaceId: string
  type: PostType
  /** the common text */
  caption: string
  /** the text of a platform that has its own; missing = the common one (D-53) */
  captionByPlatform: Partial<Record<Platform, string>>
  /** null: no date yet (a draft) */
  scheduledAt: Date | null
  /** IANA, copied from the agency when the post is created (D-58) */
  timezone: string
  /** derived from the destinations (§9.3) */
  status: PostStatus
  options: PostOptions
  createdBy: string
  /** who scheduled it last; null while it never was */
  scheduledBy: string | null
  updatedBy: string
  /** optimistic lock: every write carries the version it read (§11.9) */
  version: number
  createdAt: Date
  updatedAt: Date
}
