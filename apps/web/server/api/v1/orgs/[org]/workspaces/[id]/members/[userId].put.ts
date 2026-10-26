import { changeWorkspaceMemberRole } from '@app/application'
import { changeWorkspaceMemberRoute } from '@app/contracts'

export default defineApiRoute(
  changeWorkspaceMemberRoute,
  async ({ actor, session, params, body, ip }) => {
    await changeWorkspaceMemberRole(
      useDeps(),
      actor,
      session.session,
      { workspaceId: params.id, userId: params.userId, role: body.role },
      { ip },
    )
    return { role: body.role }
  },
)
