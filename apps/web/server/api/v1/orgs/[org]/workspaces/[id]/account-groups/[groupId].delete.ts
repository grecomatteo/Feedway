import { deleteAccountGroup } from '@app/application'
import { deleteAccountGroupRoute } from '@app/contracts'

export default defineApiRoute(
  deleteAccountGroupRoute,
  async ({ actor, params }) => {
    await deleteAccountGroup(useDeps(), actor, { workspaceId: params.id, groupId: params.groupId })
    return { deleted: true as const }
  },
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
