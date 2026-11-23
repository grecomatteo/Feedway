import type { Channel, Level } from '@app/domain'
import type { Tx } from './tx.js'

/**
 * One message for one person, built when it is sent from the data of now (plan 08, P3): a
 * group of notifications of the same kind is one message (Scelta 7). Plain text only; each
 * channel lays it out.
 */
export interface RenderedMessage {
  level: Level
  /** The email's subject, Telegram's first line: «3 post non sono usciti» */
  title: string
  /** The agency and the client, when the person works for more than one: null for the platform */
  context: string | null
  /** One per notification, up to `GROUP_LIST_MAX` */
  lines: readonly string[]
  /** How many more the message does not list: «e altre N» */
  more: number
  /** The page where it is dealt with: the post's outcome, the accounts */
  link: { label: string; url: string } | null
  /**
   * The morning digest's parts (§12.4, Task 8), each with its heading, after `lines`; absent in
   * the notifications of an event.
   */
  sections?: readonly MessageSection[]
}

/** One part of a message with a heading of its own: «Ieri», «Da sistemare». */
export interface MessageSection {
  title: string
  lines: readonly string[]
  more: number
}

/** Who a channel sends to: what it needs and nothing more (never a token). */
export interface ChannelRecipient {
  userId: string
  /** null: a notification of the platform */
  organizationId: string | null
  email: string
  name: string
}

export type SendResult =
  | { outcome: 'sent' }
  /** `error` is translated and safe to show: never a secret or the provider's answer as it came */
  | { outcome: 'failed'; error: string; retry: boolean }

/**
 * A place notifications go (§12.1 punto 4): adding one touches nothing else. The panel's has no
 * send: its row is the notification itself.
 */
export interface NotificationChannel {
  readonly name: Exclude<Channel, 'panel'>
  /** Whether it can reach the person now: SMTP configured, Telegram linked. */
  isAvailable(tx: Tx, recipient: ChannelRecipient): Promise<boolean>
  /** Why not, translated, for the delivery's row («Email non configurata sulla piattaforma») */
  readonly unavailable: string
  /** Outside any transaction (plan 08, «Ogni invio in transazione corta»). */
  send(
    recipient: ChannelRecipient,
    message: RenderedMessage,
    signal: AbortSignal,
  ): Promise<SendResult>
}
