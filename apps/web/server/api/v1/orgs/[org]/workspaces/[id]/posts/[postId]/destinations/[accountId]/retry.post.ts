import { retryTarget } from '@app/application'
import { retryTargetRoute } from '@app/contracts'

export default defineApiRoute(
  retryTargetRoute,
  ({ actor, params, ip }) =>
    retryTarget(
      useDeps(),
      actor,
      { workspaceId: params.id, postId: params.postId, accountId: params.accountId },
      { ip },
    ),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
