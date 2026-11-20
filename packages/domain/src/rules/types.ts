import type { AccountHealth, Platform } from '../accounts/accounts.js'
import type { FileAnalysis } from '../media/check-file.js'
import type { MediaKind, MediaStatus } from '../media/media.js'
import type { MediaChecks, MediaFailure } from '../media/processing.js'
import type { ZonedAdjustment } from '../time/zoned.js'

// The checks before scheduling (spec §9.1–9.2, plan 05). The engine knows platforms only as
// names: what a platform takes comes from its `PlatformRules` (ADR 019, §18.6).

/** Declared by the editor, never guessed here (plan 05, Scelta 7; `suggestType` proposes it). */
export const POST_TYPES = ['photo', 'carousel', 'reel', 'story'] as const
export type PostType = (typeof POST_TYPES)[number]

/** A file of the post, as the worker left it (R5: the rules never analyse a file again). */
export interface DraftMedia {
  mediaId: string
  status: MediaStatus
  kind: MediaKind
  /** null until the worker has read the file */
  analysis: FileAnalysis | null
  checks: MediaChecks | null
  failure: MediaFailure | null
  /** of the original bytes; null until known */
  sha256: string | null
}

export type DraftCover =
  { source: 'frame'; offsetMs: number } | { source: 'image'; media: DraftMedia }

/** The common text, and the text of a platform that has its own (§11.2 point 4). */
export type PostCaption = { common: string } & Partial<Record<Platform, string>>

export type PostWhen = { mode: 'now' } | { mode: 'at'; localDate: string; localTime: string }

/** The answers a warning accepts (plan 05, «Avvisi con scelta»). */
export const RULE_OPTIONS = [
  /** take the photo or video as it is */
  'keep',
  /** a photo or a cover cut to the format: the box of the choice (D-61), or the centre */
  'crop',
  /** a reel's video cut at the centre */
  'crop_center',
  /** fit it with bands */
  'pad',
  /** convert the video (codec, frame rate) */
  'convert',
  'trim_to_60',
  'ignore_caption',
  /** the warning is read and the post goes on as it is */
  'accept',
  /** on the outcome's platform, only the photos of the carousel */
  'photos_only',
  /** on the outcome's platform, only the first `limit` files */
  'first_files',
  /** the outcome's platform as a normal video instead of a reel */
  'publish_as_video',
  /** no destination of the outcome's platform */
  'skip_platform',
] as const
export type RuleOption = (typeof RULE_OPTIONS)[number]

/**
 * A box on the original, in fractions from 0 to 1 of its width and height (D-61): it does not
 * depend on the copies.
 */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** The answer to a warning, by its stable key (`RuleOutcome.key`). Saved with the post in stage 6. */
export interface RuleChoice {
  key: string
  option: RuleOption
  /** with `crop`: where to cut; missing, the centre */
  crop?: CropRect
}

/** Who checks (D-54): the editor while writing, a save that schedules, the worker before it publishes. */
export const CHECK_PURPOSES = ['draft', 'save', 'publish'] as const
export type CheckPurpose = (typeof CHECK_PURPOSES)[number]

export interface PostDraft {
  type: PostType
  /** in the order of the post */
  media: DraftMedia[]
  cover?: DraftCover
  caption: PostCaption
  destinations: { accountId: string }[]
  when: PostWhen
  /** a reel also in the feed (§9.1) */
  shareToFeed: boolean
  choices: RuleChoice[]
}

/** What the rules know of an account; `inWorkspace` false: not assigned to the workspace. */
export interface RuleAccount {
  platform: Platform
  active: boolean
  health: AccountHealth | null
  inWorkspace: boolean
  /** the platform's own publishing quota, when it has one (Instagram) */
  quota: { used: number; total: number; checkedAt: Date } | null
}

/** What is already published or scheduled (R4: empty until stages 6–7). */
export interface PublishingHistoryFacts {
  /** `postFingerprint` of the posts within 7 days of the instant, by account */
  recentFingerprints: ReadonlyMap<string, ReadonlySet<string>>
  /** reels in the 24 hours before the instant, the instant included, by account (D-69) */
  reelsLast24h: ReadonlyMap<string, number>
  /** posts scheduled in the 24 hours before the instant, the instant included, by account (D-69) */
  scheduledNear: ReadonlyMap<string, number>
}

export interface RuleContext {
  /** with `publish` a date already past is no block: the worker publishes at the post's time */
  purpose: CheckPurpose
  now: Date
  timeZone: string
  workspaceId: string
  /** by account id; an account missing here is not available in the workspace */
  accounts: ReadonlyMap<string, RuleAccount>
  history: PublishingHistoryFacts
  /** R2: from the composition root, `platformRulesMap(META_RULES)` */
  platforms: ReadonlyMap<Platform, PlatformRules>
}

export type RuleLevel = 'block' | 'warning' | 'fix'

/**
 * Every code an outcome can have: the panel's texts are `rules.<code>` (it.json), and a test
 * fails when a code has no text, or a text no code. A rule giving a code not listed here does
 * not compile.
 */
export const RULE_CODES = [
  // blocks
  'no_destinations',
  'account_unavailable',
  'platform_unsupported',
  'account_unhealthy',
  'no_media',
  'carousel_too_few',
  'media_not_matching_type',
  'media_processing',
  'media_failed',
  'media_unavailable',
  'cover_not_image',
  'cover_frame_out_of_range',
  'scheduled_in_past',
  'type_not_supported',
  'caption_too_long',
  'too_many_hashtags',
  'too_many_mentions',
  'carousel_too_many',
  'reel_too_short',
  'reel_too_long',
  'story_too_short',
  'quota_exhausted',
  'facebook_reels_limit',
  /** a file no destination publishes after the choices (D-56) */
  'media_unused',
  /** the copy to publish of a file could not be made (plan 07 Task 6): only with `publish` */
  'media_copy_failed',
  // warnings
  'time_skipped',
  'time_ambiguous',
  'story_caption_ignored',
  'file_convert_codec',
  'file_convert_fps',
  'photo_aspect_ratio',
  'carousel_mixed_ratios',
  'reel_aspect_ratio',
  'story_too_long',
  'cover_aspect_ratio',
  'cover_on_facebook',
  'reel_too_long_for_facebook',
  'reel_resolution_low_for_facebook',
  'carousel_mixed_with_facebook',
  'facebook_too_many_photos',
  'carousel_videos_with_facebook',
  'quota_low',
  'duplicate_post',
  // fixes
  'file_convert_to_jpeg',
  'file_convert_to_srgb',
  'file_strip_metadata',
  'file_recompress',
  'file_resize',
  'file_faststart',
  'file_convert_for_reels',
  'file_convert_audio_for_reels',
  'story_recompressed',
  'cover_converted',
] as const
export type RuleCode = (typeof RULE_CODES)[number]

/** Whom an outcome is about (plan 05, «Ogni esito sa di chi è»). */
export type RuleSubject =
  | { kind: 'post' }
  | { kind: 'destination'; accountId: string }
  /**
   * The file at that index of `draft.media`. Its key is the file's id (`media:<id>`, with
   * `:<n>` from the second time the same file comes): a choice follows its file when the
   * files move.
   */
  | { kind: 'media'; index: number }
  | { kind: 'cover' }

export type RuleParams = Record<string, string | number>

export interface RuleOutcome {
  level: RuleLevel
  /** stable, in English: the panel's text is `rules.<code>` (plan 05, «Codici, non testi») */
  code: RuleCode
  params: RuleParams
  subject: RuleSubject
  /** set when only that platform's destinations are concerned */
  platform?: Platform
  /** `code`, subject and platform: what a choice answers */
  key: string
  options?: readonly RuleOption[]
  recommended?: RuleOption
  /** the answer taken from `draft.choices` */
  chosen?: RuleOption
  /** an action of the editor that removes the block, e.g. «Pubblica ora» */
  action?: 'publish_now'
  /** with the option `crop`: the proportions of the box, width over height (D-61) */
  cropRatio?: number
}

/** How a choice changes the post on one platform (plan 05: applied, then evaluated again). */
export type PostEffect =
  | { kind: 'skip_platform'; platform: Platform }
  /** keep only these files (indices of `draft.media`) on the platform */
  | { kind: 'keep_media'; platform: Platform; indices: number[] }
  | { kind: 'format'; platform: Platform; format: string }

/** What a rule finds: an outcome without its key, and what each option does to the post. */
export interface RuleFinding {
  level: RuleLevel
  code: RuleCode
  params?: RuleParams
  subject: RuleSubject
  platform?: Platform
  options?: readonly RuleOption[]
  recommended?: RuleOption
  action?: 'publish_now'
  effects?: Partial<Record<RuleOption, PostEffect>>
  /** with the option `crop`: the box's proportions and the original's size, to check a box */
  crop?: { ratio: number; width: number; height: number }
}

/** A file of the post as one platform will take it, with its index in `draft.media`. */
export interface ViewMedia {
  index: number
  media: DraftMedia
}

/** The post as one platform publishes it, after the choices. */
export interface PlatformView {
  platform: Platform
  type: PostType
  media: ViewMedia[]
  /** what this platform will publish (`publishedCaption`) */
  caption: string
  cover: DraftCover | undefined
  shareToFeed: boolean
  /** from `PlatformRules.format`, or a choice */
  format: string
}

export interface PlatformRules {
  readonly platform: Platform
  /** What a post becomes here (§9.1); null: the platform has no such post. */
  format(type: PostType, media: readonly DraftMedia[]): string | null
  /** The checks of the post as this platform takes it: once, whatever its accounts. */
  checkPost(view: PlatformView): RuleFinding[]
  /** The checks of one account of the platform: quota, posts in a day. */
  checkAccount(
    view: PlatformView,
    account: RuleAccount & { id: string },
    history: PublishingHistoryFacts,
    /** when the post goes out: the quotas count the 24 hours before it */
    at: Date,
  ): RuleFinding[]
  /** The most a photo may weigh here: `checkFile` gets it in `FileLimits` (ADR 019). */
  readonly photoMaxBytes: number
}

export interface DestinationSummary {
  accountId: string
  /** null: the account is not available in the workspace, and nothing else of it is said */
  platform: Platform | null
  /** what the post becomes on the account (§9.1); null when it cannot go out there */
  format: string | null
  /** the text it will publish */
  caption: string
  /** the files it will publish, as indices of `draft.media` */
  media: number[]
  /** `postFingerprint` of what it publishes (P3); null while a file's sha256 is unknown */
  fingerprint: string | null
  /** the keys of the outcomes that touch it: each outcome is once, in `RuleReport.outcomes` */
  outcomeKeys: string[]
}

export interface RuleReport {
  outcomes: RuleOutcome[]
  /** the destinations that will go out, after the choices */
  destinations: DestinationSummary[]
  /** the keys of the outcomes of the post as a whole (not of one destination) */
  postKeys: string[]
  /** keys of the warnings with no choice */
  unresolved: string[]
  /**
   * Choices whose option the warning does not offer (D-54): left out, so their warning is to
   * be answered again. A choice saved with a post can stop being valid when a file or a
   * release changes the options; the route refuses a request that has one (422).
   */
  invalidChoices: RuleChoice[]
  /** no block, and a choice for every warning (§11.2 point 8) */
  canSchedule: boolean
  /** null for «Pubblica ora» */
  scheduledAt: Date | null
  adjustment: ZonedAdjustment
}
