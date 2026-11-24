import { getPlatformTelegramBot } from '@app/application'
import { platformTelegramBotRoute } from '@app/contracts'

export default defineApiRoute(platformTelegramBotRoute, async ({ actor, ip }) => {
  const view = await getPlatformTelegramBot(telegramBotDeps(useDeps()), actor, { ip })
  return { bot: view === null ? null : telegramBotDto(view) }
})
