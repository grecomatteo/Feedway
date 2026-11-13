import { removeLogo } from '@app/application'
import { removeLogoRoute } from '@app/contracts'

export default defineApiRoute(removeLogoRoute, ({ actor, session, ip }) =>
  removeLogo(logoDeps(), actor, session.session, { ip }),
)
