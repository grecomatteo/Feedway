import { captionStats } from '../../../rules/caption.js'
import type { PlatformRules, PlatformView, RuleFinding } from '../../../rules/types.js'
import { facebookFormat } from './content-types.js'
import { META_LIMITS as L } from './limits.js'
import { isPendingMedia } from '../../../rules/post-rules.js'
import { secondsUp } from '../../../rules/seconds.js'
import { checkReelAndStory, videoOf } from './shared.js'

// A Facebook Page's rules (§9.1–9.2): no photos and videos together, the photos of a
// multi-photo post (D-48), reels up to 90 s and 30 a day, the cover not yet verified.

const platform = 'facebook' as const
const skip = { kind: 'skip_platform', platform } as const

function checkCarousel(view: PlatformView): RuleFinding[] {
  if (view.type !== 'carousel') return []
  // a file not ready yet may be a photo or a video of its own: the choices wait (D-80.1)
  if (view.media.some((m) => isPendingMedia(m.media))) return []
  const photos = view.media.filter((m) => m.media.kind === 'image').map((m) => m.index)
  const findings: RuleFinding[] = []
  // a Page has no carousel of videos: the only way on is without Facebook
  if (photos.length === 0)
    return [
      {
        level: 'warning',
        code: 'carousel_videos_with_facebook',
        subject: { kind: 'post' },
        platform,
        params: { platform },
        options: ['skip_platform'],
        recommended: 'skip_platform',
        effects: { skip_platform: skip },
      },
    ]
  if (photos.length < view.media.length)
    findings.push({
      level: 'warning',
      code: 'carousel_mixed_with_facebook',
      subject: { kind: 'post' },
      platform,
      params: { platform, photos: photos.length },
      options: ['photos_only', 'skip_platform'],
      recommended: 'photos_only',
      effects: {
        photos_only: { kind: 'keep_media', platform, indices: photos },
        skip_platform: skip,
      },
    })
  const limit = L.facebookMultiPhotoMax.value
  if (photos.length > limit)
    findings.push({
      level: 'warning',
      code: 'facebook_too_many_photos',
      subject: { kind: 'post' },
      platform,
      params: { platform, limit, found: photos.length },
      options: ['first_files', 'skip_platform'],
      recommended: 'first_files',
      effects: {
        first_files: { kind: 'keep_media', platform, indices: photos.slice(0, limit) },
        skip_platform: skip,
      },
    })
  return findings
}

function checkReel(view: PlatformView): RuleFinding[] {
  if (view.format !== 'reel') return []
  const first = view.media[0]
  const video = videoOf(first)
  const findings: RuleFinding[] = []
  if (first && video) {
    const subject = { kind: 'media', index: first.index } as const
    const max = L.facebookReelMaxMs.value
    if (video.durationMs > max && video.durationMs <= L.reelMaxMs.value)
      findings.push({
        level: 'warning',
        code: 'reel_too_long_for_facebook',
        subject,
        platform,
        params: { platform, limit: max / 1000, found: secondsUp(video.durationMs) },
        options: ['publish_as_video', 'skip_platform'],
        recommended: 'publish_as_video',
        effects: {
          publish_as_video: { kind: 'format', platform, format: 'video' },
          skip_platform: skip,
        },
      })
    const short = Math.min(video.width, video.height)
    const long = Math.max(video.width, video.height)
    if (short < L.facebookReelMinShortSide.value || long < L.facebookReelMinLongSide.value)
      findings.push({
        level: 'warning',
        code: 'reel_resolution_low_for_facebook',
        subject,
        platform,
        params: {
          platform,
          width: video.width,
          height: video.height,
          minWidth: L.facebookReelMinShortSide.value,
          minHeight: L.facebookReelMinLongSide.value,
        },
        options: ['keep', 'skip_platform'],
        recommended: 'keep',
        effects: { skip_platform: skip },
      })
  }
  if (view.cover)
    findings.push({
      level: 'warning',
      code: 'cover_on_facebook',
      subject: { kind: 'cover' },
      platform,
      params: { platform },
      options: ['accept'],
      recommended: 'accept',
    })
  return findings
}

export const FACEBOOK_RULES: PlatformRules = {
  platform,
  photoMaxBytes: L.facebookPhotoMaxBytes.value,
  format: facebookFormat,
  checkPost(view) {
    const findings: RuleFinding[] = []
    const characters = captionStats(view.caption).characters
    const limit = L.facebookCaptionCharacters.value
    if (view.type !== 'story' && characters > limit)
      findings.push({
        level: 'block',
        code: 'caption_too_long',
        subject: { kind: 'post' },
        platform,
        params: { platform, limit, found: characters },
      })
    return [...findings, ...checkCarousel(view), ...checkReel(view), ...checkReelAndStory(view)]
  },
  // the 30 reels are counted in the 24 hours before the instant by `history.reelsLast24h` (D-69)
  checkAccount(view, account, history) {
    if (view.format !== 'reel') return []
    const reels = history.reelsLast24h.get(account.id) ?? 0
    const limit = L.facebookReelsPer24h.value
    if (reels < limit) return []
    return [
      {
        level: 'block',
        code: 'facebook_reels_limit',
        subject: { kind: 'destination', accountId: account.id },
        platform,
        params: { platform, limit },
      },
    ]
  },
}
