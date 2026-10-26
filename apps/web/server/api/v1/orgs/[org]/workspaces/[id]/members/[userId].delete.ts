import { removeWorkspaceMember } from '@app/application'
import { removeWorkspaceMemberRoute } from '@app/contracts'

export default defineApiRoute(
  removeWorkspaceMemberRoute,
  async ({ actor, session, params, ip }) => {
    await removeWorkspaceMember(
      useDeps(),
      actor,
      session.session,
      { workspaceId: params.id, userId: params.userId },
      { ip },
    )
    return { removed: true as const }
  },
)
