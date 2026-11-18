import { getPost } from '@app/application'
import { getPostRoute } from '@app/contracts'

export default defineApiRoute(getPostRoute, ({ actor, params }) =>
  getPost(useDeps(), actor, { workspaceId: params.id, postId: params.postId }),
)
