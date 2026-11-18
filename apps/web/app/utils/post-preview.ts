// The preview's logic with no page around it (plan 06 Task 6, spec §11.3; design E4): which
// tabs a post has, how each file sits in its frame after the answers to the warnings, where the
// text is cut. The components only draw what these say.

export type PreviewView =
  | 'instagram_feed'
  | 'instagram_reel'
  | 'instagram_story'
  | 'facebook_post'
  | 'facebook_reel'
  | 'facebook_story'

/** The order of the tabs (design E4). */
export const PREVIEW_VIEWS: readonly PreviewView[] = [
  'instagram_feed',
  'instagram_reel',
  'instagram_story',
  'facebook_post',
  'facebook_reel',
  'facebook_story',
]

/** The box of a crop on the original, in fractions from 0 to 1 (D-61). */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/** What a post becomes on an account (`DestinationSummary.format`, §9.1) as the app shows it. */
export function viewOf(platform: 'instagram' | 'facebook' | null, format: string | null) {
  if (!platform || !format) return null
  const kind = format.startsWith('story_') ? 'story' : format === 'reel' ? 'reel' : 'feed'
  if (platform === 'instagram') return `instagram_${kind}` as PreviewView
  return (kind === 'feed' ? 'facebook_post' : `facebook_${kind}`) as PreviewView
}

export interface PreviewTab {
  view: PreviewView
  /** the accounts the post goes to as this view, in the order of the destinations */
  accountIds: string[]
}

/** Only the tabs the post has on at least one chosen account (design E4). */
export function previewTabs(
  destinations: readonly {
    accountId: string
    platform: 'instagram' | 'facebook' | null
    format: string | null
  }[],
): PreviewTab[] {
  const by = new Map<PreviewView, string[]>()
  for (const d of destinations) {
    const view = viewOf(d.platform, d.format)
    if (!view) continue
    by.set(view, [...(by.get(view) ?? []), d.accountId])
  }
  return PREVIEW_VIEWS.flatMap((view) => {
    const accountIds = by.get(view)
    return accountIds ? [{ view, accountIds }] : []
  })
}

/** The widest box of that ratio (width over height, in pixels) in the middle of the photo. */
export function centeredCrop(ratio: number, width: number, height: number): CropRect {
  if (width <= 0 || height <= 0 || ratio <= 0) return { x: 0, y: 0, width: 1, height: 1 }
  if (width / height > ratio) {
    const w = (height * ratio) / width
    return { x: (1 - w) / 2, y: 0, width: w, height: 1 }
  }
  const h = width / ratio / height
  return { x: 0, y: (1 - h) / 2, width: 1, height: h }
}

/** Instagram's feed takes 4:5 to 1.91:1 (§9.2): a photo outside is shown at the nearest end. */
export const FEED_RATIO = { min: 4 / 5, max: 1.91 } as const
export const clampFeedRatio = (ratio: number) =>
  Math.min(FEED_RATIO.max, Math.max(FEED_RATIO.min, ratio))

/** One file in the preview, in its frame (`PreviewMedia.vue`). */
export interface PreviewItem {
  /** the file's index among the checked files */
  index: number
  name: string
  video: boolean
  /** the copy to show; null: none can be read (the Viewer, D-72, or not ready yet) */
  src: string | null
  poster: string | null
  framing: Framing
}

/** The answer given to the warning about a file's proportions on a platform. */
export interface FrameAnswer {
  option: string | undefined
  /** the box saved with `crop`; none: the centre */
  crop?: CropRect
  /** the box's proportions of the warning (`RuleOutcome.cropRatio`) */
  cropRatio?: number
}

/**
 * How a file sits in its frame: `fill` covers the frame, `contain` shows it whole with bands,
 * `crop` shows only the box. `fallback` is for a file with no answer.
 */
export interface Framing {
  mode: 'fill' | 'contain' | 'crop'
  crop: CropRect | null
}

export function framing(
  file: { width: number | null; height: number | null },
  frameRatio: number,
  answer: FrameAnswer | null,
  fallback: 'fill' | 'contain' = 'fill',
): Framing {
  const w = file.width ?? 0
  const h = file.height ?? 0
  if (answer?.option === 'crop' && answer.cropRatio)
    return { mode: 'crop', crop: answer.crop ?? centeredCrop(answer.cropRatio, w, h) }
  if (answer?.option === 'crop_center')
    return { mode: 'crop', crop: centeredCrop(answer.cropRatio ?? frameRatio, w, h) }
  if (answer?.option === 'pad' || answer?.option === 'keep') return { mode: 'contain', crop: null }
  return { mode: fallback, crop: null }
}

/** The proportions of the feed's frame: the first file's, after its answer (as Instagram). */
export function feedFrameRatio(
  first: { width: number | null; height: number | null } | undefined,
  answer: FrameAnswer | null,
): number {
  if (answer?.cropRatio && (answer.option === 'crop' || answer.option === 'pad'))
    return answer.cropRatio
  if (!first?.width || !first.height) return 1
  return clampFeedRatio(first.width / first.height)
}

/** The image inside a box of `crop`: moved and scaled so only the box shows. */
export function cropStyle(crop: CropRect): Record<string, string> {
  const pct = (n: number) => `${String(n * 100)}%`
  return {
    position: 'absolute',
    maxWidth: 'none',
    width: pct(1 / crop.width),
    height: pct(1 / crop.height),
    left: pct(-crop.x / crop.width),
    top: pct(-crop.y / crop.height),
  }
}

/**
 * The text as the app shows it closed: up to `lines` lines and `chars` characters (code points,
 * as the counters), then «… altro». Approximate, as the preview is (§11.3).
 */
export function shortCaption(
  text: string,
  limits: { chars: number; lines: number },
): { text: string; cut: boolean } {
  const lines = text.split('\n')
  let short = lines.slice(0, limits.lines).join('\n')
  const points = Array.from(short)
  if (points.length > limits.chars) short = points.slice(0, limits.chars).join('')
  short = short.trimEnd()
  return { text: short, cut: short.length < text.trimEnd().length }
}

/**
 * Where the app's buttons and names cover a reel or a story, in fractions of the 9:16 frame:
 * for reels, Meta's guidance as guides report it (top 14%, bottom 35%, 6% on each side); for
 * stories, the guides Matteo uses (about 13% at the top and at the bottom, 6% a side). Not
 * measured on the apps (D-75).
 */
export const SAFE_ZONES = {
  reel: { top: 0.14, bottom: 0.35, sides: 0.06 },
  // 250 px at the top and at the bottom and 65 px a side, on 1080×1920
  story: { top: 250 / 1920, bottom: 250 / 1920, sides: 65 / 1080 },
} as const

/** A warning on a file's proportions that the preview applies: the frame's answer. */
const FRAMING_CODES = new Set(['photo_aspect_ratio', 'reel_aspect_ratio'])

/**
 * The answers to the warnings on the proportions of each file, for one platform: by the file's
 * index in the checked files.
 */
export function frameAnswers(
  outcomes: readonly {
    code: string
    key: string
    subject: { kind: string; index?: number }
    platform?: string
    chosen?: string
    cropRatio?: number
  }[],
  choices: readonly { key: string; option: string; crop?: CropRect }[],
  platform: 'instagram' | 'facebook',
): Map<number, FrameAnswer> {
  const answers = new Map<number, FrameAnswer>()
  for (const o of outcomes) {
    if (!FRAMING_CODES.has(o.code) || o.subject.kind !== 'media') continue
    if (o.platform && o.platform !== platform) continue
    if (o.subject.index === undefined) continue
    const choice = choices.find((c) => c.key === o.key)
    answers.set(o.subject.index, {
      option: o.chosen ?? choice?.option,
      ...(choice?.crop ? { crop: choice.crop } : {}),
      ...(o.cropRatio ? { cropRatio: o.cropRatio } : {}),
    })
  }
  return answers
}
