import { listTelegramLinks } from '@app/application'
import { myTelegramRoute } from '@app/contracts'

export default defineApiRoute(myTelegramRoute, async ({ session }) => ({
  bots: (await listTelegramLinks(telegramLinkDeps(useDeps()), session.user.id)).map(
    telegramLinkDto,
  ),
}))
