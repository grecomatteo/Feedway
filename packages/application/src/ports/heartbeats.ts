/** What a process says of itself with its beat: never a secret. */
export interface HeartbeatDetails {
  version: string
  /** the queues this instance consumes (WORKER_QUEUES) */
  queues: number
}

/** One row of `system_heartbeats` (§16.7, plan 08 P5). */
export interface HeartbeatRecord {
  process: string
  instance: string
  lastBeatAt: Date
  details: HeartbeatDetails | null
}

/**
 * The beats of the installation's processes. The platform's only, with no agency data: read and
 * written in the system scope only.
 */
export interface SystemHeartbeatsRepository {
  /** Inserts the instance's row or moves its beat to `at`. */
  beat(input: {
    process: string
    instance: string
    at: Date
    details: HeartbeatDetails
  }): Promise<void>
  /** Every row, the most recent beat first. */
  list(): Promise<HeartbeatRecord[]>
  /** Removes the rows that did not beat since `before`; returns how many. */
  removeSilentSince(before: Date): Promise<number>
}
