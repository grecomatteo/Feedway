import type { WebConfig } from '@app/config'
import type { Runtime } from '@app/infrastructure'

export interface Deps extends Runtime {
  config: WebConfig
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
