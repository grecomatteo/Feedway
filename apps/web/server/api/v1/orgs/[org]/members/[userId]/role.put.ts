import { changeOrgRole } from '@app/application'
import { changeRoleRoute } from '@app/contracts'

export default defineApiRoute(changeRoleRoute, async ({ actor, session, params, body, ip }) => {
  await changeOrgRole(identityDeps(useDeps()), actor, session.session, params.userId, body.role, {
    ip,
  })
  return { role: body.role }
})
