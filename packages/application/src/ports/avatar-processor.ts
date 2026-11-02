/** A square of the normalized image, in its pixels. */
export interface AvatarCrop {
  x: number
  y: number
  size: number
}

/**
 * Turns an uploaded photo into what the panel stores: WebP, no metadata, upright. Throws
 * `UNSUPPORTED_FILE_TYPE` for bytes that are not JPEG, PNG, WebP or HEIC (whatever the name or
 * the declared type say) and `VALIDATION` for images over the pixel limit or that do not decode.
 */
export interface AvatarProcessor {
  /** Type from the bytes, EXIF and GPS removed, orientation applied, longest side 2048 px. */
  normalize(bytes: Buffer): Promise<{ webp: Buffer; width: number; height: number }>
  /** Size of an image `normalize` produced. */
  dimensions(webp: Buffer): Promise<{ width: number; height: number }>
  /**
   * Two square WebP files, 256 and 64 px, from a square the caller already validated; `hash`
   * is the SHA-256 of the 256 px file, in hex: it names the photo.
   */
  crop(webp: Buffer, crop: AvatarCrop): Promise<{ 256: Buffer; 64: Buffer; hash: string }>
}
