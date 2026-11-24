import type { Level } from '@app/domain'
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
import {
  bold,
  fitMessage,
  italic,
  joinHtml,
  link,
  plain,
  type TelegramHtml,
} from './telegram-format.js'
import type { Tx } from '../ports/tx.js'

// The Telegram channel (§12.3, plan 08 Task 7): a short message (HTML: bold title, lines, link), one per group of
// notifications (Scelta 7). The bot is the agency's own when it has one, the platform's
// otherwise. A chat that blocked the bot (403) is unlinked: the delivery's error says so where
// the notification is shown.

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

/** A mark for each level, so the message reads at a glance on the lock screen. */
const LEVEL_MARK: Readonly<Record<Level, string>> = {
  info: 'ℹ️',
  success: '✅',
  warning: '⚠️',
  error: '❌',
  critical: '🚨',
  security: '🔐',
}

/**
 * The message as Telegram shows it (parse_mode HTML): the title in bold with its mark (☀️ for
 * the morning digest), the context in italics, one line each, the digest's sections under their
 * headings, then the link, within Telegram's limit.
 */
export function telegramText(t: Translate, message: RenderedMessage): TelegramHtml {
  return fitMessage({
    head: [
      joinHtml([
        bold(`${message.sections ? '☀️' : LEVEL_MARK[message.level]} ${message.title}`),
        ...(message.context ? [italic(message.context)] : []),
      ]),
    ],
    sections: [
      { lines: message.lines.map((l) => plain(`• ${l}`)), hidden: message.more },
      // the morning digest's parts, each under its heading
      ...(message.sections ?? []).map((section) => ({
        title: bold(section.title),
        lines: section.lines.map((l) => plain(`• ${l}`)),
        hidden: section.more,
      })),
    ].filter((section) => section.lines.length > 0 || section.hidden > 0 || 'title' in section),
    tail: message.link ? [link(message.link.url, `${message.link.label} →`)] : [],
    more: (n) => italic(t('notify.more', { n: String(n) })),
  })
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
          { chatId: target.chatId, html: telegramText(t, message) },
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
