import { getAgencyTelegramBot } from '@app/application'
import { agencyTelegramBotRoute } from '@app/contracts'

export default defineApiRoute(agencyTelegramBotRoute, async ({ actor }) => {
  const view = await getAgencyTelegramBot(telegramBotDeps(useDeps()), actor)
  return { bot: view === null ? null : telegramBotDto(view) }
})
