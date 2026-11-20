import { publishNow } from '@app/application'
import { publishNowRoute } from '@app/contracts'

export default defineApiRoute(
  publishNowRoute,
  ({ actor, params, body, ip }) =>
    publishNow(
      useDeps(),
      actor,
      { workspaceId: params.id, postId: params.postId, version: body.version },
      { ip },
    ),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
