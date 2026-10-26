import { resendInvite } from '@app/application'
import { resendInviteRoute } from '@app/contracts'

export default defineApiRoute(
  resendInviteRoute,
  async ({ actor, session, params, ip }) => {
    const sent = await resendInvite(
      inviteDeps(useDeps()),
      actor,
      session.session,
      params.inviteId,
      {
        ip,
      },
    )
    return { id: sent.inviteId, expiresAt: sent.expiresAt.toISOString() }
  },
  { rateLimit: INVITES_RATE_LIMIT },
)
