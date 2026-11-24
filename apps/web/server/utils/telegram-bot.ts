import type { TelegramBotView } from '@app/application'
import type { Deps } from './deps'

/** The bots' use cases: the settings, and Telegram's `getMe` that tries a token. */
export function telegramBotDeps(deps: Deps) {
  return {
    uow: deps.uow,
    clock: deps.clock,
    integrations: deps.integrations,
    telegram: deps.telegram,
  }
}

/** What leaves for the panel: the bot's name and dates, never the token. */
export function telegramBotDto(view: TelegramBotView) {
  return {
    botUsername: view.botUsername,
    verifiedAt: view.verifiedAt?.toISOString() ?? null,
    rejectedAt: view.rejectedAt?.toISOString() ?? null,
    updatedAt: view.updatedAt.toISOString(),
  }
}

/** Each save is a call to Telegram and a reauth-protected write: a few a minute are plenty. */
export const TELEGRAM_BOT_RATE_LIMIT = { name: 'telegram-bot', limit: 10, windowMs: 60_000 }
