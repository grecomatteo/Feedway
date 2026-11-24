/** One of the web's minute rounds; a run still going skips its next tick, not the others'. */
export interface MinuteTask {
  name: string
  run: () => Promise<unknown>
}

/**
 * Every minute, each task on its own: a slow call to healthchecks.io never delays the watch
 * over the worker, and a failure of one never stops the other.
 */
export function everyMinute(
  tasks: readonly MinuteTask[],
  logger: { error(fields: Record<string, unknown>, message: string): void },
  everyMs = 60_000,
): () => void {
  const running = new Set<string>()
  const timer = setInterval(() => {
    for (const task of tasks) {
      if (running.has(task.name)) continue
      running.add(task.name)
      task
        .run()
        .catch((error: unknown) => {
          logger.error({ err: error, task: task.name }, 'platform watch failed')
        })
        .finally(() => {
          running.delete(task.name)
        })
    }
  }, everyMs)
  timer.unref()
  return () => {
    clearInterval(timer)
  }
}
