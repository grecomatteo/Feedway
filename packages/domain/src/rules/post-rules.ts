import type { Platform } from '../accounts/accounts.js'
import { isSelectable } from '../accounts/accounts.js'
import type { FileFix, FileWarning } from '../media/check-file.js'
import { instantToZoned, type ZonedAdjustment } from '../time/zoned.js'
import { secondsDown, secondsUp } from './seconds.js'
import type {
  DraftMedia,
  PostDraft,
  RuleAccount,
  RuleContext,
  RuleFinding,
  RuleParams,
  RuleSubject,
} from './types.js'

// The rules every platform shares (§9.2): destinations, accounts, date, files, reel cover,
// story caption.

export interface ResolvedWhen {
  instant: Date
  adjustment: ZonedAdjustment
  /** false for «Pubblica ora»: the date rule does not apply */
  scheduled: boolean
}

export interface ResolvedDestination {
  accountId: string
  /** null: not an account of the workspace (missing, not assigned, of another agency) */
  account: RuleAccount | null
  hasRules: boolean
}

function destinationRules(destinations: readonly ResolvedDestination[]): RuleFinding[] {
  if (destinations.length === 0)
    return [{ level: 'block', code: 'no_destinations', subject: { kind: 'post' } }]
  return destinations.flatMap((d): RuleFinding[] => {
    const subject = { kind: 'destination', accountId: d.accountId } as const
    if (!d.account) return [{ level: 'block', code: 'account_unavailable', subject }]
    if (!d.hasRules)
      return [
        {
          level: 'block',
          code: 'platform_unsupported',
          subject,
          params: { platform: d.account.platform },
        },
      ]
    if (isSelectable(d.account)) return []
    const reason = !d.account.active
      ? 'inactive'
      : d.account.health === null
        ? 'unchecked'
        : 'error'
    return [{ level: 'block', code: 'account_unhealthy', subject, params: { reason } }]
  })
}

const KIND_RULE = {
  photo: (m: readonly DraftMedia[]) => m.length === 1 && m[0]?.kind === 'image',
  reel: (m: readonly DraftMedia[]) => m.length === 1 && m[0]?.kind === 'video',
  story: (m: readonly DraftMedia[]) => m.length === 1,
  carousel: () => true,
}

const CAROUSEL_MIN = 2

function mediaCountRules(draft: PostDraft): RuleFinding[] {
  const post = { kind: 'post' } as const
  if (draft.media.length === 0) return [{ level: 'block', code: 'no_media', subject: post }]
  if (draft.type === 'carousel' && draft.media.length < CAROUSEL_MIN)
    return [
      {
        level: 'block',
        code: 'carousel_too_few',
        subject: post,
        params: { limit: CAROUSEL_MIN, found: draft.media.length },
      },
    ]
  if (!KIND_RULE[draft.type](draft.media))
    return [
      {
        level: 'block',
        code: 'media_not_matching_type',
        subject: post,
        params: { type: draft.type },
      },
    ]
  return []
}

/** The fields of a fix or warning of the worker, but its code and platform, as parameters. */
function paramsOf(item: FileFix | FileWarning): RuleParams {
  const params: RuleParams = {}
  for (const [k, v] of Object.entries(item))
    if (k !== 'code' && k !== 'platform' && (typeof v === 'string' || typeof v === 'number'))
      params[k] = v
  return params
}

/** A file is usable only once the worker made it `ready` (R5); its checks are the worker's. */
function fileRules(
  media: DraftMedia,
  subject: RuleSubject,
  platforms: ReadonlySet<Platform>,
): RuleFinding[] {
  switch (media.status) {
    case 'uploading':
    case 'processing':
      return [{ level: 'block', code: 'media_processing', subject }]
    case 'failed':
      return [
        {
          level: 'block',
          code: 'media_failed',
          subject,
          params: { reason: media.failure?.code ?? 'processing_failed' },
        },
      ]
    case 'deleted':
      return [{ level: 'block', code: 'media_unavailable', subject }]
    case 'ready':
      break
  }
  const fixes = (media.checks?.fixes ?? []).flatMap((fix): RuleFinding[] => {
    if (fix.code === 'recompress' && !platforms.has(fix.platform)) return []
    return [
      {
        level: 'fix',
        code: `file_${fix.code}`,
        subject,
        params: paramsOf(fix),
        ...(fix.code === 'recompress' ? { platform: fix.platform } : {}),
      },
    ]
  })
  const warnings = (media.checks?.warnings ?? []).map((w): RuleFinding => ({
    level: 'warning',
    code: `file_${w.code}`,
    subject,
    params: paramsOf(w),
    options: ['convert', 'keep'],
    recommended: 'convert',
  }))
  return [...fixes, ...warnings]
}

/**
 * A reel's cover (§9.2): a photo of the library, or a frame inside the video. A cover that is
 * not a photo blocks, and its own checks are not said: they are about a file that cannot be
 * a cover (P2 of the stage 5 review).
 */
function coverRules(draft: PostDraft, platforms: ReadonlySet<Platform>): RuleFinding[] {
  if (draft.type !== 'reel' || !draft.cover) return []
  const subject = { kind: 'cover' } as const
  if (draft.cover.source === 'image') {
    const media = draft.cover.media
    if (media.kind !== 'image') return [{ level: 'block', code: 'cover_not_image', subject }]
    return fileRules(media, subject, platforms)
  }
  const video = draft.media[0]?.analysis
  if (video?.kind !== 'video' || draft.cover.offsetMs <= video.durationMs) return []
  return [
    {
      level: 'block',
      code: 'cover_frame_out_of_range',
      subject,
      params: { found: secondsUp(draft.cover.offsetMs), limit: secondsDown(video.durationMs) },
    },
  ]
}

function whenRules(when: ResolvedWhen, ctx: RuleContext): RuleFinding[] {
  if (!when.scheduled) return []
  const post = { kind: 'post' } as const
  // the time is HH:MM: a post for the minute in progress is already past
  // the worker publishes a post at its time, or a little after it (D-54)
  if (ctx.purpose !== 'publish' && when.instant.getTime() <= ctx.now.getTime())
    return [{ level: 'block', code: 'scheduled_in_past', subject: post, action: 'publish_now' }]
  if (when.adjustment === 'none') return []
  const { localTime, offset } = instantToZoned(when.instant, ctx.timeZone)
  return [
    {
      level: 'warning',
      code: when.adjustment === 'skipped_forward' ? 'time_skipped' : 'time_ambiguous',
      subject: post,
      // the panel names the zone from these (D-58): «ora legale dell'Europa centrale»
      params: { time: localTime, offset, timeZone: ctx.timeZone, at: when.instant.toISOString() },
      options: ['accept'],
      recommended: 'accept',
    },
  ]
}

function storyCaptionRule(draft: PostDraft): RuleFinding[] {
  if (draft.type !== 'story') return []
  const texts = [draft.caption.common, draft.caption.instagram, draft.caption.facebook]
  if (!texts.some((t) => t !== undefined && t.trim() !== '')) return []
  return [
    {
      level: 'warning',
      code: 'story_caption_ignored',
      subject: { kind: 'post' },
      options: ['ignore_caption'],
      recommended: 'ignore_caption',
    },
  ]
}

export function commonRules(
  draft: PostDraft,
  ctx: RuleContext,
  when: ResolvedWhen,
  destinations: readonly ResolvedDestination[],
  platforms: ReadonlySet<Platform>,
): RuleFinding[] {
  return [
    ...destinationRules(destinations),
    ...mediaCountRules(draft),
    ...draft.media.flatMap((m, index) => fileRules(m, { kind: 'media', index }, platforms)),
    ...coverRules(draft, platforms),
    ...whenRules(when, ctx),
    ...storyCaptionRule(draft),
  ]
}
