import { createPasswordResetLink } from '@app/application'
import { passwordResetLinkRoute } from '@app/contracts'

export default defineApiRoute(
  passwordResetLinkRoute,
  ({ actor, session, params, ip }) =>
    createPasswordResetLink(identityDeps(useDeps()), actor, session.session, params.userId, {
      ip,
    }),
  { rateLimit: RESET_LINKS_RATE_LIMIT },
)
