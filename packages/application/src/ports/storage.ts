/**
 * A stored file; the body is a plain async iterable, so application code needs no node:stream.
 * The caller must read `body` to the end or stop iterating it: that releases the file.
 */
export interface StoredObject {
  body: AsyncIterable<Uint8Array>
  size: number
  contentType: string
}

/**
 * Part of a stored file, for HTTP `Range`. `size` is the size of the whole file; `range` holds
 * the first and last byte in `body` (both included), or is null when the range starts past the
 * end of the file: then `body` is empty (HTTP 416).
 */
export interface StoredRange extends StoredObject {
  range: { start: number; end: number } | null
}

/**
 * Files of agencies (`org/<id>/…`) and people (`users/<id>/…`). Any other key, or one that
 * tries to leave its folder, is a VALIDATION error.
 */
export interface Storage {
  /** Atomic: a failed write leaves no partial object and keeps the previous one. */
  put(
    key: string,
    body: Buffer | AsyncIterable<Uint8Array>,
    opts: { contentType: string },
  ): Promise<{ size: number }>
  get(key: string): Promise<StoredObject | null>
  /**
   * Bytes `start` to `end`, both included; an `end` past the last byte stops at the last byte.
   * Offsets that are not whole numbers with `0 <= start <= end` are a VALIDATION error.
   */
  getRange(key: string, start: number, end: number): Promise<StoredRange | null>
  /** Idempotent. */
  delete(key: string): Promise<void>
  /** Removes every object under `prefix` (which ends with `/`); returns how many. */
  deletePrefix(prefix: string): Promise<number>
  /** `prefix` is an owner folder, or `users/` / `org/` for every owner (system jobs only). */
  list(prefix: string): Promise<{ key: string; size: number; modifiedAt: Date }[]>
}
