import { statSync } from 'node:fs'

export const HEARTBEAT_MAX_AGE_MS = 60_000

/** 0 when the heartbeat file is newer than 60 s, otherwise 1. */
export function runHealthcheck(path: string): 0 | 1 {
  try {
    return Date.now() - statSync(path).mtimeMs < HEARTBEAT_MAX_AGE_MS ? 0 : 1
  } catch {
    return 1
  }
}

if (import.meta.main) {
  process.exit(runHealthcheck(process.env['WORKER_HEARTBEAT_FILE'] ?? '/tmp/worker-heartbeat'))
}
