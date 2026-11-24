import { removePlatformTelegramBot } from '@app/application'
import { removePlatformTelegramBotRoute } from '@app/contracts'

export default defineApiRoute(
  removePlatformTelegramBotRoute,
  async ({ actor, session, ip }) => {
    await removePlatformTelegramBot(telegramBotDeps(useDeps()), actor, {
      ip,
      session: session.session,
    })
    return { ok: true as const }
  },
  { rateLimit: TELEGRAM_BOT_RATE_LIMIT },
)
