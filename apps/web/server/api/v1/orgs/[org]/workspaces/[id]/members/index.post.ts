import { addWorkspaceMember } from '@app/application'
import { addWorkspaceMemberRoute } from '@app/contracts'

export default defineApiRoute(
  addWorkspaceMemberRoute,
  async ({ actor, session, params, body, ip }) => {
    await addWorkspaceMember(
      useDeps(),
      actor,
      session.session,
      { workspaceId: params.id, userId: body.userId, role: body.role },
      { ip },
    )
    return { role: body.role }
  },
)
