import { revokeMySession } from '@app/application'
import { revokeMySessionRoute } from '@app/contracts'

export default defineApiRoute(revokeMySessionRoute, async ({ session, params, ip }) => {
  await revokeMySession(useDeps(), session.user, params.id, { ip })
  return { revoked: true as const }
})
