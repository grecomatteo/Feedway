import type { Auth, AvatarDeps, AvatarProcessor, Translate } from '@app/application'
import type { WebConfig } from '@app/config'
import type { Runtime } from '@app/infrastructure'

export interface Deps extends Runtime {
  config: WebConfig
  auth: Auth
  /** The panel's texts, for the emails the web writes itself (invites). */
  translate: Translate
  /** Profile photos: at most two at once in this process (memory), more wait or are refused. */
  avatars: AvatarProcessor
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

/** What the profile photo use cases need, from the process's dependencies. */
export function avatarDeps(): AvatarDeps {
  const deps = useDeps()
  return {
    uow: deps.uow,
    storage: deps.storage,
    avatars: deps.avatars,
    ids: deps.ids,
    panelUrl: deps.config.panelUrl,
  }
}
