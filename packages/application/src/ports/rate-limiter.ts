/**
 * Counters shared by every process, on the database. A key is used either for hits or for
 * failures: name them apart (`ip:…`, `login:…`).
 */
export interface RateLimiter {
  /** Fixed window: the count starts again `windowMs` after the window's first hit. */
  hit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfterMs: number }>
  /** For the growing wait on an account (`loginDelayMs`). */
  failures(key: string): Promise<{ count: number; lastAt: Date | null }>
  recordFailure(key: string): Promise<void>
  /** Clears both the hits and the failures of the key. */
  reset(key: string): Promise<void>
}
