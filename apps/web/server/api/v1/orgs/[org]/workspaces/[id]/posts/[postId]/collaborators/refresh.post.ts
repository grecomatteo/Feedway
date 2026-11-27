import { requestCollaboratorsRefresh } from '@app/application'
import { refreshCollaboratorsRoute } from '@app/contracts'

export default defineApiRoute(
  refreshCollaboratorsRoute,
  ({ actor, params }) =>
    requestCollaboratorsRefresh(useDeps(), actor, {
      workspaceId: params.id,
      postId: params.postId,
    }),
  { rateLimit: COLLABORATORS_REFRESH_RATE_LIMIT },
)
