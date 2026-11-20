import { cancelPaused } from '@app/application'
import { cancelPausedRoute } from '@app/contracts'

export default defineApiRoute(
  cancelPausedRoute,
  ({ actor, params, body, ip }) =>
    cancelPaused(
      useDeps(),
      actor,
      { workspaceId: params.id, postId: params.postId, version: body.version },
      { ip },
    ),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
