import { unlinkTelegram } from '@app/application'
import { unlinkMyTelegramRoute } from '@app/contracts'

export default defineApiRoute(unlinkMyTelegramRoute, async ({ session, params }) => {
  await unlinkTelegram(useDeps(), session.user.id, params.bot)
  return { ok: true as const }
})
