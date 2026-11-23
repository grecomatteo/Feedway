import type {
  NotificationKindRule,
  OutboxPayload,
  Permission,
  PlatformPermission,
} from '@app/domain'
import type { QueueName } from './ports/job-queue.js'
import type { Tx } from './ports/tx.js'

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
 * A kind of notification a module registers for an outbox event it writes (§7.3, §12.1 punto 5):
 * level, recipients and default channels. Stage 8's delivery (plan 08, Task 5) adds the message
 * each channel builds when it sends (P3).
 */
export type NotificationKind = NotificationKindRule

/** What one section of the morning digest is computed for: one agency of one person (§12.4). */
export interface DigestContext {
  organizationId: string
  userId: string
  now: Date
  /** The agency's zone: «ieri» and «oggi» are counted in it (D-58, plan 08 Scelta 9) */
  timeZone: string
}

/** One section's content, ids and codes only: the channel words it, as for the events (P3). */
export interface DigestBlock {
  section: string
  items: readonly OutboxPayload[]
}

/** A section of the digest (§12.4); `build` runs in `uow.run({ organizationId, userId })`. */
export interface DigestSection {
  id: string
  order: number
  /** null: nothing to say, the section is left out */
  build(tx: Tx, ctx: DigestContext): Promise<DigestBlock | null>
}

/**
 * What a module registers (docs/moduli.md): the permissions and queues it owns, its kinds of
 * notification and digest sections, and the hooks it answers. Menu entries, calendar items and
 * MCP tools join here when the stages that need them arrive.
 */
export interface ModuleDefinition {
  name: string
  permissions: readonly (Permission | PlatformPermission)[]
  queues: readonly QueueName[]
  /** One per outbox event type the module writes (plan 08, «Registro dei tipi») */
  notificationKinds?: readonly NotificationKind[]
  digestSections?: readonly DigestSection[]
  /** Removes the module's own personal data of an anonymized person; must be repeatable. */
  onUserAnonymized?: UserAnonymizedHandler
}
