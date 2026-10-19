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
  /** Idempotent. */
  delete(key: string): Promise<void>
  /** Removes every object under `prefix` (which ends with `/`); returns how many. */
  deletePrefix(prefix: string): Promise<number>
  list(prefix: string): Promise<{ key: string; size: number; modifiedAt: Date }[]>
}
