import { removeAgencyTelegramBot } from '@app/application'
import { removeAgencyTelegramBotRoute } from '@app/contracts'

export default defineApiRoute(
  removeAgencyTelegramBotRoute,
  async ({ actor, session, ip }) => {
    await removeAgencyTelegramBot(telegramBotDeps(useDeps()), actor, session.session, { ip })
    return { ok: true as const }
  },
  { rateLimit: TELEGRAM_BOT_RATE_LIMIT },
)
