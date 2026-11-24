import { replaceExternalWatch } from '@app/application'
import { replaceExternalWatchRoute } from '@app/contracts'

export default defineApiRoute(
  replaceExternalWatchRoute,
  async ({ actor, session, body, ip }) => {
    await replaceExternalWatch(
      monitoringDeps(useDeps()),
      actor,
      { url: body.url },
      { ip, session: session.session },
    )
    return { ok: true as const }
  },
  { rateLimit: EXTERNAL_WATCH_RATE_LIMIT },
)
