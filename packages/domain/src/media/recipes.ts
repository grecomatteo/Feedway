import { VARIANT_RECIPE, type VariantPurpose } from './media.js'
import { REEL_ENCODE, REEL_MAX_FPS } from './reel.js'

// The copies to publish made when a post is scheduled (plan 07 P4, Task 6): what the post's
// choices ask of a file. The recipe is written in the copy's row and in its storage key as a
// readable fingerprint, so the worker knows from the row alone what to make, and two posts
// asking the same thing of a file share one copy.

/** A box on the original, in fractions of its width and height (D-61). */
export interface RecipeBox {
  x: number
  y: number
  width: number
  height: number
}

export type CopyRecipe =
  /** Instagram's feed photo cut to a box (D-61) */
  | { kind: 'crop'; box: RecipeBox }
  /** Instagram's feed photo with white bands, to the format's proportions (width over height) */
  | { kind: 'pad'; ratio: number }
  /** the photo for Facebook, when the copy for Instagram is over Facebook's limits (D-51) */
  | { kind: 'facebook' }
  /** a reel's video: bands to 9:16, cut at the centre to 9:16, or converted as it is (D-99) */
  | { kind: 'reel'; fit: 'pad' | 'crop' | 'convert' }
  /** a story: the photo or the video at the story's size, the video cut to `trimMs` */
  | { kind: 'story'; trimMs: number | null }
  /** a reel's cover from a frame of the video, framed as the video is (bands, or the centre) */
  | { kind: 'frame'; atMs: number; fit: 'pad' | 'crop' }
  /** a reel's cover from an uploaded photo, cut to its box when it has one */
  | { kind: 'cover'; box: RecipeBox | null }

/** The purpose of the copy a recipe makes. */
export function recipePurpose(recipe: CopyRecipe): VariantPurpose {
  switch (recipe.kind) {
    case 'crop':
    case 'pad':
      return 'ig_feed'
    case 'facebook':
      return 'fb_photo'
    case 'reel':
      return 'reel'
    case 'story':
      return 'story'
    case 'frame':
    case 'cover':
      return 'cover'
  }
}

/** Fractions and ratios in ten-thousandths: under half a pixel on the 4096 px master. */
const SCALE = 10_000
const toInt = (n: number) => Math.round(n * SCALE)
const boxKey = (b: RecipeBox) => [b.x, b.y, b.width, b.height].map(toInt).join('-')

/** The fingerprint of a recipe, for the row and the storage key (`VARIANT_RECIPE`). */
export function recipeKey(recipe: CopyRecipe): string {
  switch (recipe.kind) {
    case 'crop':
      return `crop-${boxKey(recipe.box)}`
    case 'pad':
      return `pad-${String(toInt(recipe.ratio))}`
    case 'facebook':
      return 'fb'
    case 'reel':
      return `reel-${recipe.fit}`
    case 'story':
      return recipe.trimMs === null ? 'story' : `story-${String(Math.round(recipe.trimMs))}`
    case 'frame':
      return `frame-${String(Math.max(0, Math.round(recipe.atMs)))}-${recipe.fit}`
    case 'cover':
      return recipe.box === null ? 'cover' : `cover-${boxKey(recipe.box)}`
  }
}

const INT = '(\\d{1,9})'
const BOX = `${INT}-${INT}-${INT}-${INT}`
const PATTERNS = {
  crop: new RegExp(`^crop-${BOX}$`),
  pad: new RegExp(`^pad-${INT}$`),
  reel: /^reel-(pad|crop|convert)$/,
  story: new RegExp(`^story(?:-${INT})?$`),
  frame: new RegExp(`^frame-${INT}-(pad|crop)$`),
  cover: new RegExp(`^cover(?:-${BOX})?$`),
}

function boxOf(parts: readonly (string | undefined)[]): RecipeBox | null {
  const [x, y, width, height] = parts.map((p) => Number(p) / SCALE)
  if (x === undefined || y === undefined || width === undefined || height === undefined) return null
  if (width <= 0 || height <= 0 || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) return null
  return { x, y, width, height }
}

/**
 * The recipe a fingerprint stands for, with the purpose of its row; null when the two do not
 * belong together or the key is not one `recipeKey` writes.
 */
export function parseRecipe(purpose: VariantPurpose, key: string): CopyRecipe | null {
  if (!VARIANT_RECIPE.test(key) || key === '') return null
  let recipe: CopyRecipe | null = null
  let m: RegExpExecArray | null
  if ((m = PATTERNS.crop.exec(key))) {
    const box = boxOf(m.slice(1))
    recipe = box && { kind: 'crop', box }
  } else if ((m = PATTERNS.pad.exec(key))) {
    const ratio = Number(m[1]) / SCALE
    recipe = ratio > 0 ? { kind: 'pad', ratio } : null
  } else if (key === 'fb') recipe = { kind: 'facebook' }
  else if ((m = PATTERNS.reel.exec(key)))
    recipe = { kind: 'reel', fit: m[1] as 'pad' | 'crop' | 'convert' }
  else if ((m = PATTERNS.story.exec(key)))
    recipe = { kind: 'story', trimMs: m[1] === undefined ? null : Number(m[1]) }
  else if ((m = PATTERNS.frame.exec(key)))
    recipe = { kind: 'frame', atMs: Number(m[1]), fit: m[2] as 'pad' | 'crop' }
  else if ((m = PATTERNS.cover.exec(key))) {
    const box = m[1] === undefined ? null : boxOf(m.slice(1))
    recipe = m[1] !== undefined && box === null ? null : { kind: 'cover', box }
  }
  return recipe && recipePurpose(recipe) === purpose ? recipe : null
}

/** The largest box of `ratio` (width over height) at the centre of a picture, in fractions. */
export function centerBox(width: number, height: number, ratio: number): RecipeBox {
  if (width <= 0 || height <= 0 || ratio <= 0) return { x: 0, y: 0, width: 1, height: 1 }
  if (width / height > ratio) {
    const w = (height * ratio) / width
    return { x: (1 - w) / 2, y: 0, width: w, height: 1 }
  }
  const h = width / ratio / height
  return { x: 0, y: (1 - h) / 2, width: 1, height: h }
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2)

/** The story's and the reel's frame: 1080×1920 at most, 9:16 (§9.2). */
export const STORY_WIDTH = 1080
export const STORY_HEIGHT = 1920
export const NINE_SIXTEEN = 9 / 16

/**
 * The size of a video fitted to 9:16: with bands, the 9:16 frame around the picture at its own
 * scale; cut, the 9:16 box inside it. Never larger than 1080×1920, never enlarged, even sides.
 */
export function fittedSize(
  width: number,
  height: number,
  fit: 'pad' | 'crop',
): { width: number; height: number } {
  const wider = width / height > NINE_SIXTEEN
  let w: number
  let h: number
  if (fit === 'pad') {
    w = wider ? width : height * NINE_SIXTEEN
    h = wider ? width / NINE_SIXTEEN : height
  } else {
    w = wider ? height * NINE_SIXTEEN : width
    h = wider ? height : width / NINE_SIXTEEN
  }
  const scale = Math.min(1, STORY_WIDTH / w, STORY_HEIGHT / h)
  return { width: even(w * scale), height: even(h * scale) }
}

/** The frame rate of a converted copy: Meta takes 23 to 60 (§9.2), 30 is what it proposes. */
export function copyFps(fps: number): number {
  if (fps > REEL_MAX_FPS) return REEL_MAX_FPS
  if (fps < COPY_MIN_FPS) return COPY_PROPOSED_FPS
  return fps
}
const COPY_MIN_FPS = 23
const COPY_PROPOSED_FPS = 30

/**
 * The video bitrate of a converted copy: the reel's (D-40), lower when the copy must stay under
 * `maxBytes` (a story, 100 MB): the sound and a tenth of slack come off the budget.
 */
export function copyVideoBitrate(
  durationMs: number,
  maxBytes: number | null,
): { bitrate: number; maxBitrate: number } {
  const seconds = durationMs / 1000
  if (maxBytes === null || seconds <= 0)
    return { bitrate: REEL_ENCODE.videoBitrate, maxBitrate: REEL_ENCODE.maxBitrate }
  const budget = Math.floor((maxBytes * 8 * 0.9) / seconds) - REEL_ENCODE.audioBitrate
  const max = Math.max(500_000, Math.min(REEL_ENCODE.maxBitrate, budget))
  return { bitrate: Math.min(REEL_ENCODE.videoBitrate, max), maxBitrate: max }
}

/** The most a story video may weigh (§9.2, «IG User Media»: 100 MB). */
export const STORY_VIDEO_MAX_BYTES = 100_000_000
/** The most a reel's cover may weigh (§9.2, «IG User Media», cover_url: 8 MB). */
export const COVER_MAX_BYTES = 8_000_000

/** Why a copy to publish could not be made (`media_variants.failure`). */
export const COPY_FAILURES = [
  'unreadable',
  'timeout',
  'processing_failed',
  'media_unavailable',
] as const
export type CopyFailure = (typeof COPY_FAILURES)[number]
