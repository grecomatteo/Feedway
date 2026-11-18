import { captionStats } from '../../../rules/caption.js'
import type { PlatformRules, PlatformView, RuleFinding } from '../../../rules/types.js'
import { instagramFormat } from './content-types.js'
import { META_LIMITS as L } from './limits.js'
import { checkReelAndStory, imageOf, isNineSixteen } from './shared.js'

// Instagram's rules (§9.1–9.2): caption, carousel, feed proportions, reel and story, cover,
// publishing quota.

const platform = 'instagram' as const
const DAY_MS = 24 * 3_600_000

function checkCaption(view: PlatformView): RuleFinding[] {
  if (view.type === 'story') return []
  const stats = captionStats(view.caption)
  const over = [
    ['caption_too_long', stats.characters, L.instagramCaptionCharacters.value],
    ['too_many_hashtags', stats.hashtags, L.instagramCaptionHashtags.value],
    ['too_many_mentions', stats.mentions, L.instagramCaptionMentions.value],
  ] as const
  return over
    .filter(([, found, limit]) => found > limit)
    .map(([code, found, limit]) => ({
      level: 'block',
      code,
      subject: { kind: 'post' },
      platform,
      params: { platform, limit, found },
    }))
}

const ratioOf = (a: { width: number; height: number }) => a.width / a.height

function checkFeedProportions(view: PlatformView): RuleFinding[] {
  if (view.type !== 'photo' && view.type !== 'carousel') return []
  const findings: RuleFinding[] = []
  // a carousel is cropped on its first item (Content Publishing), so only that one is judged
  const first = view.media[0]
  const photo = imageOf(first)
  if (first && photo) {
    const ratio = ratioOf(photo)
    if (ratio < L.instagramFeedMinRatio.value || ratio > L.instagramFeedMaxRatio.value)
      findings.push({
        level: 'warning',
        code: 'photo_aspect_ratio',
        subject: { kind: 'media', index: first.index },
        platform,
        params: { width: photo.width, height: photo.height },
        options: ['crop', 'pad'],
        recommended: 'crop',
        // taller than 4:5 is cut to 4:5, wider than 1.91:1 to 1.91:1
        crop: {
          ratio:
            ratio < L.instagramFeedMinRatio.value
              ? L.instagramFeedMinRatio.value
              : L.instagramFeedMaxRatio.value,
          width: photo.width,
          height: photo.height,
        },
      })
  }
  if (view.type === 'carousel') {
    const ratios = view.media.flatMap((m) =>
      m.media.analysis && 'width' in m.media.analysis ? [ratioOf(m.media.analysis)] : [],
    )
    const base = ratios[0]
    if (base !== undefined && ratios.some((r) => Math.abs(r - base) > base * 0.01))
      findings.push({
        level: 'warning',
        code: 'carousel_mixed_ratios',
        subject: { kind: 'post' },
        platform,
        params: {},
        options: ['accept'],
        recommended: 'accept',
      })
  }
  return findings
}

function checkCover(view: PlatformView): RuleFinding[] {
  if (view.type !== 'reel' || view.cover?.source !== 'image') return []
  const a = view.cover.media.analysis
  if (a?.kind !== 'image') return []
  const findings: RuleFinding[] = []
  if (!isNineSixteen(a.width, a.height))
    findings.push({
      level: 'warning',
      code: 'cover_aspect_ratio',
      subject: { kind: 'cover' },
      platform,
      params: { width: a.width, height: a.height },
      options: ['crop', 'keep'],
      recommended: 'crop',
      crop: { ratio: 9 / 16, width: a.width, height: a.height },
    })
  if (a.format !== 'jpeg' || a.colorSpace === 'other' || a.sizeBytes > L.coverMaxBytes.value)
    findings.push({
      level: 'fix',
      code: 'cover_converted',
      subject: { kind: 'cover' },
      platform,
      params: { limit: L.coverMaxBytes.value },
    })
  return findings
}

export const INSTAGRAM_RULES: PlatformRules = {
  platform,
  photoMaxBytes: L.instagramPhotoMaxBytes.value,
  format: instagramFormat,
  checkPost(view) {
    const findings = [...checkCaption(view), ...checkFeedProportions(view), ...checkCover(view)]
    if (view.type === 'carousel' && view.media.length > L.instagramCarouselMaxItems.value)
      findings.push({
        level: 'block',
        code: 'carousel_too_many',
        subject: { kind: 'post' },
        platform,
        params: { platform, limit: L.instagramCarouselMaxItems.value, found: view.media.length },
      })
    return [...findings, ...checkReelAndStory(view)]
  },
  checkAccount(_view, account, history, at) {
    if (!account.quota) return []
    const scheduled = history.scheduledNear.get(account.id) ?? 0
    // the posts Meta counted have left the window 24 hours after it counted them
    const stillCounted = at.getTime() - account.quota.checkedAt.getTime() < DAY_MS
    const used = stillCounted ? account.quota.used : 0
    const left = account.quota.total - used - scheduled
    const subject = { kind: 'destination', accountId: account.id } as const
    if (left <= 0)
      return [
        {
          level: 'block',
          code: 'quota_exhausted',
          subject,
          platform,
          params: { total: account.quota.total },
        },
      ]
    if (left < L.instagramQuotaLowBelow.value)
      return [
        {
          level: 'warning',
          code: 'quota_low',
          subject,
          platform,
          params: { left, total: account.quota.total },
          options: ['accept'],
          recommended: 'accept',
        },
      ]
    return []
  },
}
