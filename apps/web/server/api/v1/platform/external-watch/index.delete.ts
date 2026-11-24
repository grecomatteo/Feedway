import { removeExternalWatch } from '@app/application'
import { removeExternalWatchRoute } from '@app/contracts'

export default defineApiRoute(
  removeExternalWatchRoute,
  async ({ actor, session, ip }) => {
    await removeExternalWatch(monitoringDeps(useDeps()), actor, { ip, session: session.session })
    return { ok: true as const }
  },
  { rateLimit: EXTERNAL_WATCH_RATE_LIMIT },
)
