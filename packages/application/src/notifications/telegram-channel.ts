import type {
  ChannelRecipient,
  NotificationChannel,
  RenderedMessage,
} from '../ports/notification-channel.js'
import type { TelegramBotOwner } from '../ports/notifications.js'
import {
  TelegramApiError,
  type TelegramBotApi,
  type TelegramFailureKind,
} from '../ports/telegram-bot-api.js'
import type { Translate } from '../ports/translator.js'
import type { Tx } from '../ports/tx.js'

// The Telegram channel (§12.3, plan 08 Task 7): a short message, plain text, one per group of
// notifications (Scelta 7). The bot is the agency's own when it has one, the platform's
// otherwise. A chat that blocked the bot (403) is unlinked: the delivery's error says so where
// the notification is shown.

/** Telegram's limit for a message's text. */
export const TELEGRAM_TEXT_MAX = 4096

/** Where the chat and the bot's token of a recipient are read (system scope: `telegram-poll.ts`). */
export interface TelegramTargets {
  find(
    recipient: ChannelRecipient,
  ): Promise<{ owner: TelegramBotOwner; token: string; chatId: number } | null>
  /** The chat blocked the bot: its link goes. */
  unlink(owner: TelegramBotOwner, chatId: number): Promise<void>
}

export interface TelegramChannelDeps {
  t: Translate
  telegram: Pick<TelegramBotApi, 'sendMessage'>
  targets: TelegramTargets
}

/** Failures that may pass on their own; the others need a person. */
const TRANSIENT: ReadonlySet<TelegramFailureKind> = new Set(['rate_limited', 'unavailable'])

/** The bot that writes to the recipient: the agency's own, if it has one, or the platform's. */
export async function telegramOwnerOf(
  tx: Tx,
  recipient: Pick<ChannelRecipient, 'organizationId'>,
): Promise<TelegramBotOwner> {
  const { organizationId } = recipient
  if (organizationId === null) return null
  const own = await tx.integrations.findForOrganization(organizationId, 'telegram')
  return own === null ? null : organizationId
}

/** The message as Telegram shows it: the title, the context, one line each, then the link. */
export function telegramText(t: Translate, message: RenderedMessage): string {
  const head = [message.title, ...(message.context ? [message.context] : [])].join('\n')
  const listed = [
    ...message.lines.map((l) => `• ${l}`),
    ...(message.more > 0 ? [t('notify.more', { n: String(message.more) })] : []),
  ]
  const link = message.link ? `${message.link.label}: ${message.link.url}` : ''
  const parts = [head, listed.join('\n'), link].filter((p) => p !== '')
  const text = parts.join('\n\n')
  if (text.length <= TELEGRAM_TEXT_MAX) return text
  // too long for one message: the lines are cut, the link always stays
  const room = TELEGRAM_TEXT_MAX - head.length - link.length - 6
  return [head, `${listed.join('\n').slice(0, Math.max(room, 0))}…`, link]
    .filter((p) => p !== '')
    .join('\n\n')
}

export function createTelegramChannel(deps: TelegramChannelDeps): NotificationChannel {
  const { t } = deps
  return {
    name: 'telegram',
    unavailable: t('notify.skipped.telegram'),
    async isAvailable(tx, recipient) {
      const owner = await telegramOwnerOf(tx, recipient)
      return (await tx.telegramLinks.findLinked(owner, recipient.userId)) !== null
    },
    async send(recipient, message, signal) {
      const target = await deps.targets.find(recipient)
      if (target === null)
        return { outcome: 'failed', error: t('notify.skipped.telegram'), retry: false }
      try {
        await deps.telegram.sendMessage(
          target.token,
          { chatId: target.chatId, text: telegramText(t, message) },
          signal,
        )
        return { outcome: 'sent' }
      } catch (error) {
        if (!(error instanceof TelegramApiError)) throw error
        if (error.kind === 'blocked') await deps.targets.unlink(target.owner, target.chatId)
        return {
          outcome: 'failed',
          error: t(`notify.telegram.errors.${error.kind}`),
          retry: TRANSIENT.has(error.kind),
        }
      }
    },
  }
}
