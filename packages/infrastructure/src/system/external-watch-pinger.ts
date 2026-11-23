import type { ExternalWatchPinger } from '@app/application'

/**
 * A `GET` to the external watch's address (§16.7). The address is a secret: neither it nor the
 * error of `fetch` (which may quote it) leaves this function, only codes. No redirects: the
 * address saved is the one called.
 */
export function createExternalWatchPinger(): ExternalWatchPinger {
  return {
    async ping(url, signal) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          signal,
          redirect: 'error',
          headers: { 'user-agent': 'feedway-heartbeat' },
        })
        // the body is not needed: read it away so the connection goes back to the pool
        await res.arrayBuffer().catch(() => undefined)
        return res.ok
          ? { ok: true, status: res.status }
          : { ok: false, problem: 'status', status: res.status }
      } catch {
        return { ok: false, problem: signal.aborted ? 'timeout' : 'network', status: null }
      }
    },
  }
}
