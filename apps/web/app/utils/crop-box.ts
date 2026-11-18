// The box of a crop with fixed proportions (plan 06 Task 6, Scelta 5, D-61): the profile
// photo's square and the post's photo or cover. Pixels of the original; the box never leaves
// the photo, keeps its proportions and its shortest side never goes under the minimum.

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface CropSpec {
  /** the original's size, in pixels */
  width: number
  height: number
  /** width over height */
  ratio: number
  /** the shortest side the box may have, when the photo allows it */
  minSide: number
  /** whole pixels (the profile photo) */
  round?: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** The largest box of the proportions inside the photo. */
export function maxWidth(spec: CropSpec): number {
  return Math.min(spec.width, spec.height * spec.ratio)
}

/** The narrowest box allowed: its shortest side at the minimum, or the largest box if smaller. */
export function minWidth(spec: CropSpec): number {
  return Math.min(spec.minSide * Math.max(1, spec.ratio), maxWidth(spec))
}

function sized(width: number, spec: CropSpec) {
  let w = clamp(width, minWidth(spec), maxWidth(spec))
  if (spec.round) w = Math.round(w)
  const h = spec.round ? Math.round(w / spec.ratio) : w / spec.ratio
  return { w, h }
}

function inside(x: number, y: number, w: number, h: number, spec: CropSpec): Box {
  let nx = clamp(x, 0, spec.width - w)
  let ny = clamp(y, 0, spec.height - h)
  if (spec.round) {
    nx = Math.round(nx)
    ny = Math.round(ny)
  }
  return { x: nx, y: ny, width: w, height: h }
}

/** The largest box in the middle: where every crop starts. */
export function centerBox(spec: CropSpec): Box {
  const { w, h } = sized(maxWidth(spec), spec)
  const x = (spec.width - w) / 2
  const y = (spec.height - h) / 2
  return inside(spec.round ? Math.floor(x) : x, spec.round ? Math.floor(y) : y, w, h, spec)
}

/**
 * The box at `x`, `y` with that width. A new width keeps the box's centre (zooming); the box is
 * then kept inside the photo.
 */
export function placeBox(current: Box, x: number, y: number, width: number, spec: CropSpec): Box {
  const { w, h } = sized(width, spec)
  const resized = w !== current.width
  const nx = resized ? current.x + current.width / 2 - w / 2 : x
  const ny = resized ? current.y + current.height / 2 - h / 2 : y
  return inside(nx, ny, w, h, spec)
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

/**
 * A corner dragged to (`px`, `py`): the opposite corner stays where it is, the box keeps its
 * proportions and stays inside the photo.
 */
export function dragCorner(box: Box, corner: Corner, px: number, py: number, spec: CropSpec): Box {
  const east = corner === 'ne' || corner === 'se'
  const south = corner === 'sw' || corner === 'se'
  const ax = east ? box.x : box.x + box.width
  const ay = south ? box.y : box.y + box.height
  const room = Math.min(east ? spec.width - ax : ax, (south ? spec.height - ay : ay) * spec.ratio)
  const wanted = Math.max(Math.abs(px - ax), Math.abs(py - ay) * spec.ratio)
  const w0 = clamp(wanted, minWidth(spec), Math.max(minWidth(spec), room))
  const { w, h } = sized(w0, spec)
  return inside(east ? ax : ax - w, south ? ay : ay - h, w, h, spec)
}

/** The box in fractions of the photo, as a choice saves it (D-61). */
export function toFractions(box: Box, spec: CropSpec) {
  return {
    x: box.x / spec.width,
    y: box.y / spec.height,
    width: box.width / spec.width,
    height: box.height / spec.height,
  }
}

/** A saved box back in pixels, put right if the photo or the rules changed. */
export function fromFractions(
  crop: { x: number; y: number; width: number; height: number },
  spec: CropSpec,
): Box {
  const start = centerBox(spec)
  return placeBox(
    { ...start, width: crop.width * spec.width },
    crop.x * spec.width,
    crop.y * spec.height,
    crop.width * spec.width,
    spec,
  )
}
