import { startTelegramLink } from '@app/application'
import { startMyTelegramLinkRoute } from '@app/contracts'

export default defineApiRoute(
  startMyTelegramLinkRoute,
  async ({ session, body }) => {
    const { url, expiresAt } = await startTelegramLink(
      telegramLinkDeps(useDeps()),
      session.user.id,
      body.bot,
    )
    return { url, expiresAt: expiresAt.toISOString() }
  },
  { rateLimit: TELEGRAM_LINK_RATE_LIMIT },
)
