import { renameSync, writeFileSync } from 'node:fs'
import type { Logger } from '@app/application'

function beat(path: string): void {
  // write to a temporary file and rename: the healthcheck never sees a half-written file
  const tmp = `${path}.tmp`
  writeFileSync(tmp, new Date().toISOString())
  renameSync(tmp, path)
}

/** Writes the heartbeat now and every `everyMs`; returns the function that stops it. */
export function startHeartbeat(path: string, everyMs: number): () => void {
  beat(path)
  const timer = setInterval(() => {
    beat(path)
  }, everyMs)
  timer.unref()
  return () => {
    clearInterval(timer)
  }
}

/**
 * The beat in `system_heartbeats` (plan 08 P5), now and every `everyMs`, apart from the file: a
 * database that does not answer is in the log, and never stops the worker or Docker's check.
 * One beat at a time: a slow database does not pile them up.
 */
export function startDatabaseBeat(
  write: () => Promise<void>,
  everyMs: number,
  logger: Logger,
): () => void {
  let running = false
  const once = () => {
    if (running) return
    running = true
    write()
      .catch((error: unknown) => {
        logger.warn({ err: error }, 'worker beat not written')
      })
      .finally(() => {
        running = false
      })
  }
  once()
  const timer = setInterval(once, everyMs)
  timer.unref()
  return () => {
    clearInterval(timer)
  }
}
