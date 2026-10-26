import { inviteUser } from '@app/application'
import { inviteRoute } from '@app/contracts'

export default defineApiRoute(
  inviteRoute,
  async ({ actor, session, body, ip }) => {
    const invite = await inviteUser(identityDeps(useDeps()), actor, session.session, body, { ip })
    return { url: invite.url, expiresAt: invite.expiresAt.toISOString() }
  },
  { rateLimit: INVITES_RATE_LIMIT },
)
