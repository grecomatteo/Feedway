import { revokeInvite } from '@app/application'
import { revokeInviteRoute } from '@app/contracts'

export default defineApiRoute(revokeInviteRoute, async ({ actor, session, params, ip }) =>
  revokeInvite(useDeps(), actor, session.session, params.inviteId, { ip }),
)
