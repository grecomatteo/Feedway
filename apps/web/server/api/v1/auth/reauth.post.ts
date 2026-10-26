import { reauthenticate } from '@app/application'
import { reauthRoute } from '@app/contracts'

export default defineApiRoute(
  reauthRoute,
  async ({ session, body, ip }) => {
    await reauthenticate(identityDeps(useDeps()), session.session, body, { ip })
    return { reauthenticated: true as const }
  },
  { rateLimit: REAUTH_RATE_LIMIT },
)
