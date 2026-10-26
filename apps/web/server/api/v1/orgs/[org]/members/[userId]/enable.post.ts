import { enableMember } from '@app/application'
import { enableMemberRoute } from '@app/contracts'

export default defineApiRoute(enableMemberRoute, async ({ actor, session, params, ip }) => {
  await enableMember(identityDeps(useDeps()), actor, session.session, params.userId, { ip })
  return { status: 'active' as const }
})
