// The worker's beat and the external watch (§16.7, plan 08 P5 and Scelta 10).

/** How often each worker writes its row of `system_heartbeats`. */
export const WORKER_BEAT_EVERY_MS = 30_000
/** Past this the panel shows the beat in amber: one beat was missed. */
export const WORKER_LATE_MS = 60_000
/** Past this, with no other instance beating, the worker is down. */
export const WORKER_SILENT_MS = 2 * 60_000
/** An instance silent this long is removed: a worker taken away does not keep the alarm on. */
export const HEARTBEAT_RETIRED_MS = 7 * 24 * 3600_000
/** The call to the external watch gives up after this. */
export const EXTERNAL_WATCH_TIMEOUT_MS = 10_000
const EXTERNAL_WATCH_URL_MAX = 512

export type BeatHealth = 'ok' | 'late' | 'silent'

/** Green, amber or red in Piattaforma → Integrazioni. */
export function beatHealth(lastBeatAt: Date, now: Date): BeatHealth {
  const age = now.getTime() - lastBeatAt.getTime()
  if (age > WORKER_SILENT_MS) return 'silent'
  if (age > WORKER_LATE_MS) return 'late'
  return 'ok'
}

/** No worker beat in the last two minutes: none at all counts as silent too. */
export function workerSilent(lastBeats: readonly Date[], now: Date): boolean {
  return lastBeats.every((at) => beatHealth(at, now) === 'silent')
}

export type ExternalWatchUrlProblem = 'invalid' | 'not_https' | 'credentials'

/**
 * The address of healthchecks.io or Uptime Kuma: it is the secret (whoever has it can say the
 * VPS is alive), so only over https, and never with a user and password in it.
 */
export function externalWatchUrlProblem(value: string): ExternalWatchUrlProblem | null {
  if (value.length > EXTERNAL_WATCH_URL_MAX || /\s/.test(value)) return 'invalid'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'invalid'
  }
  if (url.protocol !== 'https:') return 'not_https'
  if (url.username !== '' || url.password !== '') return 'credentials'
  return null
}
