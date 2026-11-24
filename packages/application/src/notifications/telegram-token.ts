import { DomainError } from '@app/domain'
import { TelegramApiError, type TelegramBotApi } from '../ports/telegram-bot-api.js'

// A bot's token as @BotFather gives it: the bot's id, a colon, the secret. It is tried with
// `getMe` before it is saved (plan 08 Task 7): a token Telegram refuses is never stored.

const TOKEN = /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/

/** What a bot's page shows: never the token, only that one is set. */
export interface TelegramBotView {
  botUsername: string
  verifiedAt: Date | null
  /** Telegram refused the token since it was saved (revoked with @BotFather). */
  rejectedAt: Date | null
  updatedAt: Date
}

export const telegramBotView = (found: {
  config: { botUsername: string }
  verifiedAt: Date | null
  rejectedAt: Date | null
  updatedAt: Date
}): TelegramBotView => ({
  botUsername: found.config.botUsername,
  verifiedAt: found.verifiedAt,
  rejectedAt: found.rejectedAt,
  updatedAt: found.updatedAt,
})

/** The token cleaned of what a paste adds, checked in form, then tried with Telegram. */
export async function verifyBotToken(
  api: Pick<TelegramBotApi, 'getMe'>,
  raw: string,
): Promise<{ token: string; botId: number; botUsername: string }> {
  const token = raw.trim()
  if (!TOKEN.test(token))
    throw new DomainError('VALIDATION', 'Il token non ha la forma di quelli di @BotFather', {
      field: 'token',
    })
  try {
    const me = await api.getMe(token)
    return { token, botId: me.id, botUsername: me.username }
  } catch (error) {
    if (error instanceof TelegramApiError && error.kind === 'unauthorized')
      throw new DomainError('VALIDATION', 'Telegram non accetta questo token', { field: 'token' })
    throw new DomainError('PLATFORM_UNAVAILABLE', 'Telegram non risponde: riprova tra poco')
  }
}
