import type { FileAnalysis } from '../../../media/check-file.js'
import type { PlatformView, RuleFinding, ViewMedia } from '../../../rules/types.js'
import { secondsDown, secondsUp } from '../../../rules/seconds.js'
import { META_LIMITS as L } from './limits.js'

// The checks Instagram and Facebook share (§9.2 «Proporzioni e durata»). Both platforms run
// them, with no platform on the finding: the engine keeps one per key.

type VideoAnalysis = Extract<FileAnalysis, { kind: 'video' }>
type ImageAnalysis = Extract<FileAnalysis, { kind: 'image' }>

export const videoOf = (m: ViewMedia | undefined): VideoAnalysis | null =>
  m?.media.analysis?.kind === 'video' ? m.media.analysis : null
export const imageOf = (m: ViewMedia | undefined): ImageAnalysis | null =>
  m?.media.analysis?.kind === 'image' ? m.media.analysis : null

const NINE_SIXTEEN = 9 / 16
/** 1% either way: 1080×1920 and 720×1280 are 9:16, a phone's 1080×1918 too. */
export const isNineSixteen = (width: number, height: number) =>
  Math.abs(width / height - NINE_SIXTEEN) <= NINE_SIXTEEN * 0.01

export function checkReelAndStory(view: PlatformView): RuleFinding[] {
  const first = view.media[0]
  const video = videoOf(first)
  if (!first || !video) return []
  const subject = { kind: 'media', index: first.index } as const
  const findings: RuleFinding[] = []
  if (view.type === 'reel') {
    if (video.durationMs < L.reelMinMs.value)
      findings.push({
        level: 'block',
        code: 'reel_too_short',
        subject,
        params: { limit: L.reelMinMs.value / 1000, found: secondsDown(video.durationMs) },
      })
    if (video.durationMs > L.reelMaxMs.value)
      findings.push({
        level: 'block',
        code: 'reel_too_long',
        subject,
        params: { limit: L.reelMaxMs.value / 60_000, found: secondsUp(video.durationMs) },
      })
    if (!isNineSixteen(video.width, video.height))
      findings.push({
        level: 'warning',
        code: 'reel_aspect_ratio',
        subject,
        params: { width: video.width, height: video.height },
        options: ['keep', 'pad', 'crop_center'],
        recommended: 'keep',
      })
  }
  if (view.type === 'story') {
    if (video.durationMs < L.storyVideoMinMs.value)
      findings.push({
        level: 'block',
        code: 'story_too_short',
        subject,
        params: { limit: L.storyVideoMinMs.value / 1000, found: secondsDown(video.durationMs) },
      })
    if (video.durationMs > L.storyVideoMaxMs.value)
      findings.push({
        level: 'warning',
        code: 'story_too_long',
        subject,
        params: { limit: L.storyVideoMaxMs.value / 1000, found: secondsUp(video.durationMs) },
        options: ['trim_to_60'],
        recommended: 'trim_to_60',
      })
    if (video.sizeBytes > L.storyVideoMaxBytes.value)
      findings.push({
        level: 'fix',
        code: 'story_recompressed',
        subject,
        params: { limit: L.storyVideoMaxBytes.value },
      })
  }
  return findings
}
