import { markVerified } from '@app/application'
import { markVerifiedRoute } from '@app/contracts'

export default defineApiRoute(
  markVerifiedRoute,
  ({ actor, params, ip }) =>
    markVerified(
      useDeps(),
      actor,
      { workspaceId: params.id, postId: params.postId, accountId: params.accountId },
      { ip },
    ),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
