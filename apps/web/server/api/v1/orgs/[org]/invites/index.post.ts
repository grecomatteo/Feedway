import { inviteUser } from '@app/application'
import { inviteRoute } from '@app/contracts'

export default defineApiRoute(
  inviteRoute,
  async ({ actor, session, body, ip }) => {
    const sent = await inviteUser(inviteDeps(useDeps()), actor, session.session, body, { ip })
    return { id: sent.inviteId, expiresAt: sent.expiresAt.toISOString() }
  },
  { rateLimit: INVITES_RATE_LIMIT },
)
