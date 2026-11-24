/**
 * The watch over the worker (plan 08 Scelta 10): from the web, which keeps running when the
 * worker stops. The first run comes a minute after the start, when a worker started with the
 * web has beaten.
 */
export default defineNitroPlugin((nitroApp) => {
  let stop: (() => void) | undefined
  depsReady()
    .then(() => {
      stop = startWorkerWatch(useDeps())
    })
    .catch(() => {
      // 00.deps already logged it and stops the process
    })
  nitroApp.hooks.hook('close', () => {
    stop?.()
  })
})
