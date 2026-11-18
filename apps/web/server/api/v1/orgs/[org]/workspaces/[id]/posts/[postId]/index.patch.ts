import { updatePost } from '@app/application'
import { updatePostRoute } from '@app/contracts'

export default defineApiRoute(
  updatePostRoute,
  ({ actor, params, body, ip }) =>
    updatePost(
      useDeps(),
      actor,
      params.postId,
      {
        ...postContent(body),
        workspaceId: params.id,
        version: body.version,
      },
      { ip },
    ),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
