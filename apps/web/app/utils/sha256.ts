/**
 * The sha-256 of a piece, counted by a Web Worker of ours (plan 04 Task 13). If the browser
 * cannot start it, the page counts it itself: slower, but the upload goes on. `mode` says which,
 * for the tests of the CSP.
 */
export function createHasher() {
  let worker: Worker | null = null
  let broken = false
  let next = 0
  const waiting = new Map<
    number,
    { resolve: (d: Uint8Array) => void; reject: (e: Error) => void }
  >()
  const state = { mode: 'idle' as 'idle' | 'worker' | 'inline' }

  const inline = async (blob: Blob) => {
    state.mode = 'inline'
    return new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
  }
  function fail(reason: string) {
    broken = true
    worker?.terminate()
    worker = null
    for (const w of waiting.values()) w.reject(new Error(reason))
    waiting.clear()
  }
  function start(): Worker | null {
    if (worker || broken) return worker
    try {
      worker = new Worker(new URL('../workers/sha256.ts', import.meta.url), { type: 'module' })
    } catch {
      broken = true
      return null
    }
    worker.onmessage = (
      event: MessageEvent<{ id: number; digest?: Uint8Array; error?: string }>,
    ) => {
      const w = waiting.get(event.data.id)
      if (!w) return
      waiting.delete(event.data.id)
      if (event.data.digest) w.resolve(event.data.digest)
      else w.reject(new Error(event.data.error ?? 'sha-256 not counted'))
    }
    worker.onerror = () => {
      fail('the sha-256 worker stopped')
    }
    return worker
  }

  async function digest(blob: Blob): Promise<Uint8Array> {
    const w = start()
    if (!w) return inline(blob)
    const id = ++next
    try {
      const out = await new Promise<Uint8Array>((resolve, reject) => {
        waiting.set(id, { resolve, reject })
        w.postMessage({ id, blob })
      })
      state.mode = 'worker'
      return out
    } catch {
      // the worker did not start (a CSP, an old browser) or stopped: count it here
      return inline(blob)
    }
  }

  return {
    digest,
    get mode() {
      return state.mode
    },
    stop() {
      worker?.terminate()
      worker = null
    },
  }
}
