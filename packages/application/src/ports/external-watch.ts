/** How a call to the external watch ended: codes only, never the address or its error text. */
export type ExternalPingResult =
  | { ok: true; status: number }
  | { ok: false; problem: 'timeout' | 'network' | 'status'; status: number | null }

/** Calls the address of healthchecks.io or Uptime Kuma (§16.7) with a `GET`. */
export interface ExternalWatchPinger {
  ping(url: string, signal: AbortSignal): Promise<ExternalPingResult>
}
