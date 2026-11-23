import type { NotificationKindRule, Permission, PlatformPermission } from '@app/domain'
import type { MessageContext, NotifiedEvent } from './notifications/message.js'
import type { IntegrationStore } from './ports/integration-store.js'
import type { QueueName } from './ports/job-queue.js'
import type { RenderedMessage } from './ports/notification-channel.js'
import type { Translate } from './ports/translator.js'
import type { Tx } from './ports/tx.js'
import type { UnitOfWork } from './ports/unit-of-work.js'

/** Who removed the person: themselves from the panel, or the platform (CLI, retention). */
export type AnonymizationSource = 'panel' | 'system'

export interface UserAnonymizedEvent {
  userId: string
  source: AnonymizationSource
}

/** What an anonymization handler works with: the composition root's unit of work. */
export interface UserAnonymizedDeps {
  uow: UnitOfWork
}

/**
 * Called after a person is anonymized, by every module that keeps personal data of its own
 * (the notifications' Telegram links, preferences and rows). It must be repeatable: an
 * interrupted anonymization runs every handler again.
 */
export type UserAnonymizedHandler = (
  event: UserAnonymizedEvent,
  deps: UserAnonymizedDeps,
) => Promise<void>

/**
 * A kind of notification a module registers for an outbox event it writes (§7.3, §12.1 punto 5):
 * level, recipients, default channels, and the message, built when it is sent from the data of
 * now in the recipient's scope (P3). One message for a group of events of the kind (Scelta 7).
 */
export interface NotificationKind extends NotificationKindRule {
  /** null: nothing left to say (every post of the group gone and nothing else to tell) */
  message(ctx: MessageContext, events: readonly NotifiedEvent[]): Promise<RenderedMessage | null>
}

/** The `meta` integration, the Graph API version of the config and the panel's zone. */
export interface DigestReminderSources {
  integrations: Pick<IntegrationStore, 'get'>
  graph: { version: string; sunset: string }
  timeZone: string
}

/** What one section of the morning digest is computed for: one agency of one person (§12.4). */
export interface DigestContext {
  organizationId: string
  userId: string
  now: Date
  /** The agency's zone: «ieri» and «oggi» are counted in it (D-58, plan 08 Scelta 9) */
  timeZone: string
  t: Translate
  panelUrl: URL
  /** What the Meta reminders are computed from, as for `accounts.daily` (`MetaReminderSources`) */
  metaReminders: DigestReminderSources
}

/**
 * One section's words, read now in the recipient's scope (P3): the digest is never stored, so
 * the section writes its lines itself, as a kind's `message` does.
 */
export interface DigestBlock {
  /** «Ieri», «Da sistemare» */
  title: string
  /** One per post or account, up to `GROUP_LIST_MAX` */
  lines: readonly string[]
  /** How many more the section does not list */
  more: number
}

/** A section of the digest (§12.4); `build` runs in `uow.run({ organizationId, userId })`. */
export interface DigestSection {
  id: string
  /** Lower first: posts of yesterday, open problems, today, plans (stage 9), accounts */
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
