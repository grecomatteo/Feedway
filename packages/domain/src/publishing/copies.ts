import type { Platform } from '../accounts/accounts.js'
import type { MediaKind, VariantPurpose } from '../media/media.js'
import {
  NINE_SIXTEEN,
  centerBox,
  recipeKey,
  recipePurpose,
  type CopyRecipe,
} from '../media/recipes.js'
import type {
  PostType,
  RuleChoice,
  RuleOption,
  RuleOutcome,
  RuleReport,
  RuleSubject,
} from '../rules/types.js'

// Which copy of each file every destination publishes (plan 07 Task 6, P4): the post's choices
// applied to its files, after the checks. Pure: the same answer when the post is scheduled (the
// copies are asked for) and when a destination is prepared (the copies are read).

/** A file of the post, with what the worker already made of it when it was processed. */
export interface PublishFile {
  mediaId: string
  kind: MediaKind
  /** of the original, upright; null until read */
  width: number | null
  height: number | null
  /** the weight of the copy for Instagram's feed made with the file (`ig_feed`); null: none */
  feedCopyBytes: number | null
  /** whether the file has its copy for the Reels (D-40): a codec Meta does not take has none */
  hasReelCopy: boolean
}

export interface PublishPost {
  type: PostType
  /** in the order of the post, as `RuleReport.destinations[].media` counts them */
  media: readonly PublishFile[]
  cover?: { source: 'frame'; offsetMs: number } | { source: 'image'; file: PublishFile }
  choices: readonly RuleChoice[]
}

/** One copy of one file: `recipe` is `''` for the copy made with the file. */
export interface CopyRequest {
  mediaId: string
  purpose: VariantPurpose
  recipe: string
}

export interface DestinationFiles {
  accountId: string
  platform: Platform
  /** in the order the destination publishes them */
  media: CopyRequest[]
  /** the reel's cover; null: the platform's own */
  cover: CopyRequest | null
}

const plain = (mediaId: string, purpose: VariantPurpose): CopyRequest => ({
  mediaId,
  purpose,
  recipe: '',
})
const made = (mediaId: string, recipe: CopyRecipe): CopyRequest => ({
  mediaId,
  purpose: recipePurpose(recipe),
  recipe: recipeKey(recipe),
})

/** The story is cut to its first 60 seconds when the warning was answered so (§9.2). */
const STORY_TRIM_MS = 60_000

interface Answer {
  option: RuleOption
  box: CropRect | undefined
  ratio: number | undefined
}
type CropRect = NonNullable<RuleChoice['crop']>

const sameSubject = (a: RuleSubject, b: RuleSubject) =>
  a.kind === b.kind && (a.kind !== 'media' || (b.kind === 'media' && a.index === b.index))

/**
 * The files of each destination that goes out, as copies. `photoMaxBytes`: the most a photo may
 * weigh on each platform (`PlatformRules.photoMaxBytes`): «prima Instagram» (D-51), the copy of
 * the feed goes everywhere it fits, and a platform that takes less gets one of its own.
 */
export function publishFilesOf(
  post: PublishPost,
  report: Pick<RuleReport, 'outcomes' | 'destinations'>,
  photoMaxBytes: ReadonlyMap<Platform, number>,
): DestinationFiles[] {
  const boxes = new Map(post.choices.map((c) => [c.key, c.crop]))
  const answer = (
    code: RuleOutcome['code'],
    subject: RuleSubject,
    platform?: Platform,
  ): Answer | null => {
    const o = report.outcomes.find(
      (x) =>
        x.code === code &&
        x.chosen !== undefined &&
        sameSubject(x.subject, subject) &&
        (platform === undefined || x.platform === undefined || x.platform === platform),
    )
    return o?.chosen ? { option: o.chosen, box: boxes.get(o.key), ratio: o.cropRatio } : null
  }

  const reelFit = (index: number): 'pad' | 'crop' | null => {
    if (post.type !== 'reel') return null
    const a = answer('reel_aspect_ratio', { kind: 'media', index })
    return a?.option === 'pad' ? 'pad' : a?.option === 'crop_center' ? 'crop' : null
  }

  const fileCopy = (file: PublishFile, index: number, platform: Platform): CopyRequest => {
    if (post.type === 'story') {
      const trim = answer('story_too_long', { kind: 'media', index })?.option === 'trim_to_60'
      return made(file.mediaId, {
        kind: 'story',
        trimMs: file.kind === 'video' && trim ? STORY_TRIM_MS : null,
      })
    }
    if (file.kind === 'video') {
      const fit = reelFit(index)
      if (fit) return made(file.mediaId, { kind: 'reel', fit })
      return file.hasReelCopy
        ? plain(file.mediaId, 'reel')
        : made(file.mediaId, { kind: 'reel', fit: 'convert' })
    }
    const a = answer('photo_aspect_ratio', { kind: 'media', index }, platform)
    if (a?.option === 'crop' && a.ratio !== undefined)
      return made(file.mediaId, {
        kind: 'crop',
        box: a.box ?? centerBox(file.width ?? 0, file.height ?? 0, a.ratio),
      })
    if (a?.option === 'pad' && a.ratio !== undefined)
      return made(file.mediaId, { kind: 'pad', ratio: a.ratio })
    const most = photoMaxBytes.get(platform)
    if (file.feedCopyBytes !== null && most !== undefined && file.feedCopyBytes > most)
      return made(file.mediaId, { kind: 'facebook' })
    return plain(file.mediaId, 'ig_feed')
  }

  const coverCopy = (): CopyRequest | null => {
    const video = post.media[0]
    if (post.type !== 'reel' || !post.cover || !video) return null
    if (post.cover.source === 'frame')
      return made(video.mediaId, {
        kind: 'frame',
        atMs: post.cover.offsetMs,
        fit: reelFit(0) === 'pad' ? 'pad' : 'crop',
      })
    const file = post.cover.file
    // the warning is Instagram's, the copy the same for every destination
    const a = answer('cover_aspect_ratio', { kind: 'cover' })
    const box =
      a?.option === 'crop'
        ? (a.box ?? centerBox(file.width ?? 0, file.height ?? 0, a.ratio ?? NINE_SIXTEEN))
        : null
    return made(file.mediaId, { kind: 'cover', box })
  }

  const cover = coverCopy()
  return report.destinations.flatMap((d): DestinationFiles[] => {
    const platform = d.platform
    if (platform === null || d.format === null) return []
    return [
      {
        accountId: d.accountId,
        platform,
        media: d.media.flatMap((index) => {
          const file = post.media[index]
          return file ? [fileCopy(file, index, platform)] : []
        }),
        cover,
      },
    ]
  })
}

/** Every copy the destinations need, once each. */
export function distinctCopies(files: readonly DestinationFiles[]): CopyRequest[] {
  const seen = new Map<string, CopyRequest>()
  for (const d of files)
    for (const c of [...d.media, ...(d.cover ? [d.cover] : [])])
      seen.set(`${c.mediaId}/${c.purpose}/${c.recipe}`, c)
  return [...seen.values()]
}
