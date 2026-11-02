/** Who removed the person: themselves from the panel, or the platform (CLI, retention). */
export type AnonymizationSource = 'panel' | 'system'

export interface UserAnonymizedEvent {
  userId: string
  source: AnonymizationSource
}

/**
 * Called after a person is anonymized, by every module that keeps personal data of its own
 * (stage 8 adds the Telegram links). It must be repeatable: an interrupted anonymization runs
 * every handler again.
 */
export type UserAnonymizedHandler = (event: UserAnonymizedEvent) => Promise<void>

/**
 * The modules' handlers, in the order they run. Each composition root (panel, worker, CLI)
 * passes this list to `anonymizeUser`, so no entry point forgets a module.
 */
export function userAnonymizedHandlers(): readonly UserAnonymizedHandler[] {
  return []
}
