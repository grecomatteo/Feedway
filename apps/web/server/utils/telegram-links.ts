import {
  platformTelegramBotName,
  type TelegramBotLink,
  type TelegramLinkDeps,
} from '@app/application'
import type { Deps } from './deps'

/** «Collega Telegram» (plan 08 Task 7): the links, and the platform bot's name to link it. */
export function telegramLinkDeps(deps: Deps): TelegramLinkDeps {
  return {
    uow: deps.uow,
    clock: deps.clock,
    integrations: deps.integrations,
    tokens: deps.tokens,
    platformBotName: platformTelegramBotName(deps),
  }
}

export function telegramLinkDto(link: TelegramBotLink) {
  return {
    bot: link.bot,
    botUsername: link.botUsername,
    agencies: link.agencies,
    platform: link.platform,
    linkedAt: link.linkedAt?.toISOString() ?? null,
    pendingUntil: link.pendingUntil?.toISOString() ?? null,
  }
}

/** Each link is a new code: a few a minute are plenty. */
export const TELEGRAM_LINK_RATE_LIMIT = { name: 'telegram-link', limit: 10, windowMs: 60_000 }
