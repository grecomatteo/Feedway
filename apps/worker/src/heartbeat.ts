import { renameSync, writeFileSync } from 'node:fs'

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
