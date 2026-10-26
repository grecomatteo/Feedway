import { disableMember } from '@app/application'
import { disableMemberRoute } from '@app/contracts'

export default defineApiRoute(disableMemberRoute, async ({ actor, session, params, ip }) => {
  await disableMember(identityDeps(useDeps()), actor, session.session, params.userId, { ip })
  return { status: 'disabled' as const }
})
