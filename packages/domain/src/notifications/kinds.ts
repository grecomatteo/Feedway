import type { OutboxEventType } from '../publishing/events.js'
import type { Channel } from './channels.js'
import type { Level } from './levels.js'
import type { RecipientRule } from './recipients.js'

/**
 * The fixed part of a kind of notification: what its module registers in `module.ts`
 * (`notificationKinds`, §7.3), without the words, which the channel builds when it sends
 * (plan 08, P3).
 */
export interface NotificationKindRule {
  type: OutboxEventType
  level: Level
  recipients: readonly RecipientRule[]
  /** §12.2, until the person chooses otherwise (P4) */
  defaultChannels: readonly Channel[]
  /** D-74: these people get the email whatever their choices */
  alwaysEmail?: RecipientRule
}
