import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

const FIXTURES = new URL('./fixtures/', import.meta.url)

/** A photo-like picture: stripes and a circle, so a crop or a rotation shows. */
function picture(width: number, height: number) {
  const n = (value: number) => String(value)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}">
    <rect width="100%" height="100%" fill="#f0c878"/>
    <rect width="${n(Math.round(width / 3))}" height="100%" fill="#1e5aa0"/>
    <circle cx="${n(width / 2)}" cy="${n(height / 2)}" r="${n(Math.min(width, height) / 4)}"
      fill="#c82838"/>
  </svg>`
  return sharp(Buffer.from(svg))
}

/** A JPEG with a camera name and a GPS position in its EXIF, as phones write them. */
export function jpegWithGps(opts: { orientation?: number } = {}): Promise<Buffer> {
  return picture(600, 400)
    .jpeg({ quality: 80 })
    .withExif({
      IFD0: { Make: 'Test' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '45/1 27/1 0/1' },
    })
    .withMetadata({ orientation: opts.orientation ?? 1 })
    .toBuffer()
}

/** A PNG of the given size, cheap to make whatever the size (one colour compresses well). */
export function pngOfSize(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#808080' } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

export type ImageFixture =
  'photo.jpg' | 'photo.png' | 'photo.webp' | 'photo.heic' | 'anim.gif' | 'image.svg' | 'doc.pdf'

/**
 * Test images. The HEIC (made for the tests from a drawing, with a fake GPS position in its
 * EXIF), the GIF, the SVG and the PDF are files; the others are drawn here.
 */
export async function imageFixture(name: ImageFixture): Promise<Buffer> {
  switch (name) {
    case 'photo.jpg':
      return jpegWithGps()
    case 'photo.png':
      return picture(500, 500).png().toBuffer()
    case 'photo.webp':
      return picture(400, 300).webp().toBuffer()
    default:
      return readFile(new URL(name, FIXTURES))
  }
}

/** What a test checks of an image: its size and whether it still carries EXIF. */
export async function imageInfo(
  bytes: Buffer,
): Promise<{ format: string | undefined; width: number; height: number; exif: boolean }> {
  const meta = await sharp(bytes).metadata()
  return {
    format: meta.format,
    width: meta.width,
    height: meta.height,
    exif: meta.exif !== undefined,
  }
}
