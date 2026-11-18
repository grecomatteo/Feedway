import { unschedulePost } from '@app/application'
import { unschedulePostRoute } from '@app/contracts'

export default defineApiRoute(
  unschedulePostRoute,
  ({ actor, params, body, ip }) =>
    unschedulePost(
      useDeps(),
      actor,
      { workspaceId: params.id, postId: params.postId, version: body.version },
      { ip },
    ),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
