import sharp from 'sharp'
import { describe, expect, test } from 'vitest'
import { DomainError } from '@app/domain'
import { imageFixture, jpegWithGps, pngOfSize } from './test-images.js'
import { createAvatarProcessor } from './avatar-processor.js'
import { sniffImageType } from './sniff.js'

const processor = createAvatarProcessor()

const hasGpsIfd = (exif: Buffer | undefined) =>
  exif !== undefined && exif.includes(Buffer.from([0x25, 0x88]))

describe('sniffImageType', () => {
  test.each([
    ['photo.jpg', 'jpeg'],
    ['photo.png', 'png'],
    ['photo.webp', 'webp'],
    ['photo.heic', 'heic'],
  ] as const)('%s is %s', async (name, type) => {
    expect(sniffImageType(await imageFixture(name))).toBe(type)
  })

  test.each(['anim.gif', 'image.svg', 'doc.pdf'] as const)(
    '%s is refused by its bytes',
    async (f) => {
      expect(sniffImageType(await imageFixture(f))).toBeNull()
    },
  )

  test('too short or empty is refused', () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull()
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull()
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WAVE'))).toBeNull()
  })

  test('an AVIF (HEIF container, AV1 inside) is not taken for a HEIC', async () => {
    const avif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .avif()
      .toBuffer()
    expect(sniffImageType(avif)).toBeNull()
  })
})

describe('normalize', () => {
  test('exif and gps are removed', async () => {
    const source = await jpegWithGps()
    expect(hasGpsIfd((await sharp(source).metadata()).exif)).toBe(true)
    const { webp } = await processor.normalize(source)
    const meta = await sharp(webp).metadata()
    expect(meta.exif).toBeUndefined()
    expect(meta.icc).toBeUndefined()
    expect(webp.includes(Buffer.from('Exif'))).toBe(false)
    expect(webp.includes(Buffer.from('Test'))).toBe(false)
  })

  test('orientation is applied before stripping', async () => {
    const out = await processor.normalize(await jpegWithGps({ orientation: 6 }))
    expect([out.width, out.height]).toEqual([400, 600])
    const meta = await sharp(out.webp).metadata()
    expect([meta.width, meta.height]).toEqual([400, 600])
    expect(meta.orientation).toBeUndefined()
  })

  test.each(['photo.jpg', 'photo.png', 'photo.webp', 'photo.heic'] as const)(
    '%s becomes webp',
    async (f) => {
      const out = await processor.normalize(await imageFixture(f))
      expect(sniffImageType(out.webp)).toBe('webp')
      expect(out.width).toBeGreaterThan(0)
    },
  )

  test('the HEIC keeps its size and loses its EXIF', async () => {
    const out = await processor.normalize(await imageFixture('photo.heic'))
    expect([out.width, out.height]).toEqual([480, 320])
    expect((await sharp(out.webp).metadata()).exif).toBeUndefined()
  })

  test('the longest side is at most 2048 px, and small images are not enlarged', async () => {
    const big = await processor.normalize(await pngOfSize(4000, 1000))
    expect([big.width, big.height]).toEqual([2048, 512])
    const small = await processor.normalize(await pngOfSize(300, 200))
    expect([small.width, small.height]).toEqual([300, 200])
  })

  test.each(['anim.gif', 'image.svg', 'doc.pdf'] as const)(
    '%s is UNSUPPORTED_FILE_TYPE',
    async (f) => {
      await expect(processor.normalize(await imageFixture(f))).rejects.toMatchObject({
        code: 'UNSUPPORTED_FILE_TYPE',
      })
    },
  )

  test('under 64 px on a side is VALIDATION: no square could be saved', async () => {
    await expect(processor.normalize(await pngOfSize(50, 400))).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringMatching(/troppo piccola/) as unknown,
    })
  })

  test('a HEIC is decoded off the main thread: timers keep running meanwhile', async () => {
    const heic = await imageFixture('photo.heic')
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
    }, 1)
    try {
      await Promise.all([1, 2].map(() => processor.normalize(heic)))
    } finally {
      clearInterval(timer)
    }
    expect(ticks).toBeGreaterThan(3)
  })

  test('over 40 megapixels is VALIDATION, before decoding', async () => {
    const error = await processor.normalize(await pngOfSize(8000, 6000)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DomainError)
    expect(error).toMatchObject({ code: 'VALIDATION' })
  })

  test('a truncated image is VALIDATION, not a crash', async () => {
    const jpg = await jpegWithGps()
    await expect(processor.normalize(jpg.subarray(0, 600))).rejects.toMatchObject({
      code: 'VALIDATION',
    })
    const heic = await imageFixture('photo.heic')
    await expect(processor.normalize(heic.subarray(0, 400))).rejects.toMatchObject({
      code: 'VALIDATION',
    })
  })
})

describe('crop', () => {
  test('crop gives exact sizes', async () => {
    const { webp } = await processor.normalize(await imageFixture('photo.jpg'))
    const out = await processor.crop(webp, { x: 0, y: 0, size: 400 })
    expect((await sharp(out[256]).metadata()).width).toBe(256)
    expect((await sharp(out[256]).metadata()).height).toBe(256)
    expect((await sharp(out[64]).metadata()).width).toBe(64)
    expect((await sharp(out[64]).metadata()).height).toBe(64)
    expect(sniffImageType(out[64])).toBe('webp')
  })

  test('dimensions reads a normalized image', async () => {
    const { webp } = await processor.normalize(await imageFixture('photo.webp'))
    expect(await processor.dimensions(webp)).toEqual({ width: 400, height: 300 })
  })
})

test('at most two images are processed at once; more wait, too many are refused', async () => {
  let running = 0
  let peak = 0
  const slow = createAvatarProcessor({
    concurrency: 2,
    maxWaiting: 2,
    onStart: () => {
      running += 1
      peak = Math.max(peak, running)
    },
    onEnd: () => {
      running -= 1
    },
  })
  const png = await pngOfSize(1500, 1500)
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => slow.normalize(png)))
  expect(peak).toBe(2)
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4)
  const refused = results.find((r) => r.status === 'rejected')
  expect(refused?.status === 'rejected' && refused.reason).toMatchObject({ code: 'RATE_LIMITED' })
})
