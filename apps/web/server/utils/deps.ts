import type { Clock, IdGenerator, JobQueue, Logger } from '@app/application'
import type { WebConfig } from '@app/config'
import type { Db, DbHandle } from '@app/infrastructure'

export interface Deps {
  config: WebConfig
  logger: Logger
  db: Db
  pool: DbHandle['pool']
  queue: JobQueue
  clock: Clock
  ids: IdGenerator
}

let deps: Deps | undefined
let ready: Promise<void> | undefined

/** Starts the one-time initialisation; requests wait for it through `depsReady`. */
export function initDeps(create: () => Promise<Deps>): Promise<void> {
  ready = create().then((value) => {
    deps = value
  })
  return ready
}

export async function depsReady(): Promise<void> {
  await ready
}

export function useDeps(): Deps {
  if (!deps) throw new Error('dependencies not initialised')
  return deps
}
