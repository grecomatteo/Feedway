import { createPost } from '@app/application'
import { createPostRoute } from '@app/contracts'

export default defineApiRoute(createPostRoute, ({ actor, params, body, ip }) =>
  createPost(
    useDeps(),
    actor,
    { workspaceId: params.id, ...postContent(body), type: body.type },
    { ip },
  ),
)
