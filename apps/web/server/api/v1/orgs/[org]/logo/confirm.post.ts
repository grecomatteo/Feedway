import { confirmLogo } from '@app/application'
import { confirmLogoRoute } from '@app/contracts'

export default defineApiRoute(
  confirmLogoRoute,
  ({ actor, session, body, params, ip }) =>
    onePerPerson(session.user.id, () =>
      confirmLogo(
        logoDeps(),
        actor,
        session.session,
        { stagingId: body.stagingId, slug: params.org },
        { ip },
      ),
    ),
  { rateLimit: LOGO_RATE_LIMIT },
)
