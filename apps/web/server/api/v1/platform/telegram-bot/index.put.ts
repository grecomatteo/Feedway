import { replacePlatformTelegramBot } from '@app/application'
import { replacePlatformTelegramBotRoute } from '@app/contracts'

export default defineApiRoute(
  replacePlatformTelegramBotRoute,
  async ({ actor, session, body, ip }) => {
    const view = await replacePlatformTelegramBot(
      telegramBotDeps(useDeps()),
      actor,
      { token: body.token },
      { ip, session: session.session },
    )
    return { bot: telegramBotDto(view) }
  },
  { rateLimit: TELEGRAM_BOT_RATE_LIMIT },
)
