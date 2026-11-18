import { deleteAccountGroup } from '@app/application'
import { deleteAccountGroupRoute } from '@app/contracts'

export default defineApiRoute(
  deleteAccountGroupRoute,
  async ({ actor, params, ip }) => {
    await deleteAccountGroup(
      useDeps(),
      actor,
      { workspaceId: params.id, groupId: params.groupId },
      { ip },
    )
    return { deleted: true as const }
  },
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
