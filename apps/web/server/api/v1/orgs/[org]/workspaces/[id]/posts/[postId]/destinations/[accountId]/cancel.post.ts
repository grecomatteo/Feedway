import { cancelTarget } from '@app/application'
import { cancelTargetRoute } from '@app/contracts'

export default defineApiRoute(
  cancelTargetRoute,
  ({ actor, params, ip }) =>
    cancelTarget(
      useDeps(),
      actor,
      { workspaceId: params.id, postId: params.postId, accountId: params.accountId },
      { ip },
    ),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
