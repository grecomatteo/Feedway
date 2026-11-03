import type { Permission, PlatformPermission } from '@app/domain'
import type { QueueName } from './ports/job-queue.js'

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
 * What a module registers (docs/moduli.md): the permissions and queues it owns and the hooks it
 * answers. Menu entries, calendar items and MCP tools join here when the stages that need them
 * arrive.
 */
export interface ModuleDefinition {
  name: string
  permissions: readonly (Permission | PlatformPermission)[]
  queues: readonly QueueName[]
  /** Removes the module's own personal data of an anonymized person; must be repeatable. */
  onUserAnonymized?: UserAnonymizedHandler
}
