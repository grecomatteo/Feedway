import type { AvatarCrop, AvatarProcessor } from '@app/application'
import { AVATAR_MAX_PIXELS, AVATAR_MIN_CROP, AVATAR_SIZES, DomainError } from '@app/domain'
import { createHash } from 'node:crypto'
import sharp, { type Metadata, type Sharp } from 'sharp'
import { decodeHeic } from './heic-decoder.js'
import { sniffImageType } from './sniff.js'

/** Longest side of the image kept for cropping. */
const MAX_SIDE = 2048
/** A HEIC decode longer than this is stopped (a 12 MP iPhone photo takes about a second). */
const HEIC_TIMEOUT_MS = 20_000
const WEBP = { quality: 85, effort: 4 } as const

// one image at a time per libvips call is plenty for photos; no cache of decoded images
sharp.cache(false)

const unreadable = () =>
  new DomainError('VALIDATION', 'Non riesco a leggere questa immagine: prova con un’altra foto', {
    field: 'file',
  })
const tooManyPixels = () =>
  new DomainError('VALIDATION', 'La foto è troppo grande: al massimo 40 megapixel', {
    field: 'file',
  })
const tooSmall = (minSide: number) =>
  new DomainError(
    'VALIDATION',
    `L’immagine è troppo piccola: almeno ${String(minSide)} pixel per lato`,
    { field: 'file' },
  )
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const
const unsupported = () =>
  new DomainError('UNSUPPORTED_FILE_TYPE', 'Usa una foto JPEG, PNG, WebP o HEIC', {
    field: 'file',
  })

/** A sharp pipeline over the source, refusing what is over the pixel limit before decoding. */
async function sourceOf(bytes: Buffer): Promise<Sharp> {
  const type = sniffImageType(bytes)
  if (type === null) throw unsupported()
  if (type === 'heic') {
    const heic = await decodeHeic(bytes, {
      maxPixels: AVATAR_MAX_PIXELS,
      timeoutMs: HEIC_TIMEOUT_MS,
    })
    if (!heic.ok) throw heic.reason === 'too_many_pixels' ? tooManyPixels() : unreadable()
    return sharp(heic.data, { raw: { width: heic.width, height: heic.height, channels: 4 } })
  }
  const options = { limitInputPixels: AVATAR_MAX_PIXELS, failOn: 'error', pages: 1 } as const
  let meta: Metadata
  try {
    meta = await sharp(bytes, options).metadata()
  } catch {
    throw unreadable()
  }
  // libvips reads the type from the bytes too: both must agree
  if (meta.format !== type) throw unsupported()
  const { width, height } = meta
  if (!width || !height) throw unreadable()
  if (width * height > AVATAR_MAX_PIXELS) throw tooManyPixels()
  // upright first: the orientation lives in the EXIF the output leaves out
  return sharp(bytes, options).autoOrient()
}

async function render(pipeline: Sharp) {
  try {
    return await pipeline.webp(WEBP).toBuffer({ resolveWithObject: true })
  } catch {
    throw unreadable()
  }
}

/** At most `concurrency` jobs at once; `maxWaiting` more wait, the next are refused. */
function limiter(opts: { concurrency: number; maxWaiting: number }) {
  let running = 0
  const waiting: (() => void)[] = []
  return async function run<T>(job: () => Promise<T>): Promise<T> {
    if (running >= opts.concurrency) {
      if (waiting.length >= opts.maxWaiting)
        throw new DomainError('RATE_LIMITED', 'Stiamo elaborando altre foto: riprova tra poco', {
          retryAfterSeconds: 5,
        })
      await new Promise<void>((resolve) => waiting.push(resolve))
    } else running += 1
    try {
      return await job()
    } finally {
      // hand the slot to the next one, or free it
      const next = waiting.shift()
      if (next) next()
      else running -= 1
    }
  }
}

export interface AvatarProcessorOptions {
  /**
   * Images processed at once in this process. One by default: a 40 MP HEIC takes ~450 MB at its
   * peak, and two at once went over the panel's memory limit.
   */
  concurrency?: number
  /** Requests that may wait for a slot; more get RATE_LIMITED. */
  maxWaiting?: number
  /** Test hooks around each job. */
  onStart?: () => void
  onEnd?: () => void
}

/** sharp (libvips) for JPEG, PNG and WebP; libheif-js for the HEIC of iPhones. */
export function createAvatarProcessor(options: AvatarProcessorOptions = {}): AvatarProcessor {
  // libvips would keep decoded images in its cache: memory the panel never gets back
  sharp.cache(false)
  const run = limiter({
    concurrency: options.concurrency ?? 1,
    maxWaiting: options.maxWaiting ?? 8,
  })
  const job = <T>(work: () => Promise<T>) =>
    run(async () => {
      options.onStart?.()
      try {
        return await work()
      } finally {
        options.onEnd?.()
      }
    })

  return {
    normalize: (bytes, opts = {}) =>
      job(async () => {
        const minSide = opts.minSide ?? AVATAR_MIN_CROP
        const source = await sourceOf(bytes)
        const { data, info } = await render(
          source.resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true }),
        )
        // the crop needs a square of at least AVATAR_MIN_CROP
        if (Math.min(info.width, info.height) < minSide) throw tooSmall(minSide)
        return { webp: data, width: info.width, height: info.height }
      }),

    async dimensions(webp) {
      const meta = await sharp(webp)
        .metadata()
        .catch(() => null)
      if (!meta?.width || !meta.height) throw unreadable()
      return { width: meta.width, height: meta.height }
    },

    crop: (webp, crop: AvatarCrop) =>
      job(async () => {
        const square = await sharp(webp)
          .extract({ left: crop.x, top: crop.y, width: crop.size, height: crop.size })
          .toBuffer()
          .catch(() => {
            throw unreadable()
          })
        const [large, small] = await Promise.all(
          AVATAR_SIZES.map(async (side) => (await render(sharp(square).resize(side, side))).data),
        )
        if (!large || !small) throw unreadable()
        return { 256: large, 64: small, hash: createHash('sha256').update(large).digest('hex') }
      }),

    fitSquare: (webp) =>
      job(async () => {
        const [large, small] = await Promise.all(
          AVATAR_SIZES.map(
            async (side) =>
              (
                await render(
                  sharp(webp)
                    .ensureAlpha()
                    .resize(side, side, { fit: 'contain', background: TRANSPARENT }),
                )
              ).data,
          ),
        )
        if (!large || !small) throw unreadable()
        return { 256: large, 64: small, hash: createHash('sha256').update(large).digest('hex') }
      }),
  }
}
