/**
 * A read made in the background (the tab back in front, another agency): one at a time and no
 * more than once every `gapMs`, counted from when it starts (D-120.7). It never throws: a failed
 * read waits for the next one.
 */
export function quietReload(
  load: () => Promise<unknown>,
  gapMs: number,
  now: () => number = Date.now,
): () => Promise<void> {
  let running: Promise<void> | null = null
  let last = Number.NEGATIVE_INFINITY
  return () => {
    if (running) return running
    if (now() - last < gapMs) return Promise.resolve()
    last = now()
    running = load()
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => (running = null))
    return running
  }
}
