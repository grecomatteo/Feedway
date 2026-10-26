import { revokeAllMySessions } from '@app/application'
import { revokeAllMySessionsRoute } from '@app/contracts'

export default defineApiRoute(revokeAllMySessionsRoute, async ({ session, ip }) => ({
  revoked: await revokeAllMySessions(useDeps(), session.user, { ip }),
}))
