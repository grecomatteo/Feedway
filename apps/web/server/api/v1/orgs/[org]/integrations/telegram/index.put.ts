import { replaceAgencyTelegramBot } from '@app/application'
import { replaceAgencyTelegramBotRoute } from '@app/contracts'

export default defineApiRoute(
  replaceAgencyTelegramBotRoute,
  async ({ actor, session, body, ip }) => {
    const view = await replaceAgencyTelegramBot(
      telegramBotDeps(useDeps()),
      actor,
      session.session,
      { token: body.token },
      { ip },
    )
    return { bot: telegramBotDto(view) }
  },
  { rateLimit: TELEGRAM_BOT_RATE_LIMIT },
)
