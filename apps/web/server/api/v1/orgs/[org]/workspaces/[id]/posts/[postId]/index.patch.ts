import { updatePost } from '@app/application'
import { updatePostRoute } from '@app/contracts'

export default defineApiRoute(updatePostRoute, ({ actor, params, body }) =>
  updatePost(useDeps(), actor, params.postId, {
    ...postContent(body),
    workspaceId: params.id,
    version: body.version,
  }),
)
