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

/** The answer to a warning, by its stable key (`RuleOutcome.key`). Saved with the post in stage 6. */
export interface RuleChoice {
  key: string
  option: RuleOption
}

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
  /** `postFingerprint` of the posts of the last 7 days, by account */
  recentFingerprints: ReadonlyMap<string, ReadonlySet<string>>
  /** reels in the 24 hours around the instant, by account */
  reelsLast24h: ReadonlyMap<string, number>
  /** posts scheduled in the 24 hours before the instant, by account */
  scheduledNear: ReadonlyMap<string, number>
}

export interface RuleContext {
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

/** Whom an outcome is about (plan 05, «Ogni esito sa di chi è»). */
export type RuleSubject =
  | { kind: 'post' }
  | { kind: 'destination'; accountId: string }
  /** the file at that index of `draft.media` */
  | { kind: 'media'; index: number }
  | { kind: 'cover' }

export type RuleParams = Record<string, string | number>

export interface RuleOutcome {
  level: RuleLevel
  /** stable, in English: the panel's text is `rules.<code>` (plan 05, «Codici, non testi») */
  code: string
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
  code: string
  params?: RuleParams
  subject: RuleSubject
  platform?: Platform
  options?: readonly RuleOption[]
  recommended?: RuleOption
  action?: 'publish_now'
  effects?: Partial<Record<RuleOption, PostEffect>>
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
  /** the outcomes that touch it */
  outcomes: RuleOutcome[]
}

export interface RuleReport {
  outcomes: RuleOutcome[]
  /** the destinations that will go out, after the choices */
  destinations: DestinationSummary[]
  /** the outcomes of the post as a whole (not of one destination) */
  post: RuleOutcome[]
  /** keys of the warnings with no choice */
  unresolved: string[]
  /** no block, and a choice for every warning (§11.2 point 8) */
  canSchedule: boolean
  /** null for «Pubblica ora» */
  scheduledAt: Date | null
  adjustment: ZonedAdjustment
}
