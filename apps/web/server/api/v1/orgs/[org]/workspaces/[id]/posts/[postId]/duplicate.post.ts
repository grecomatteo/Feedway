import { duplicatePost } from '@app/application'
import { duplicatePostRoute } from '@app/contracts'

export default defineApiRoute(
  duplicatePostRoute,
  ({ actor, params, body, ip }) =>
    duplicatePost(
      useDeps(),
      actor,
      {
        workspaceId: params.id,
        postId: params.postId,
        dates: body.dates,
        schedule: body.schedule,
      },
      { ip },
    ),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
