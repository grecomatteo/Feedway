import { removeLogo } from '@app/application'
import { removeLogoRoute } from '@app/contracts'

export default defineApiRoute(
  removeLogoRoute,
  ({ actor, session, ip }) =>
    onePerPerson(session.user.id, () => removeLogo(logoDeps(), actor, session.session, { ip })),
  { rateLimit: LOGO_RATE_LIMIT },
)
