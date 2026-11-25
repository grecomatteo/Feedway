import { planItemOfPost } from '@app/application'
import { planOfPostRoute } from '@app/contracts'

export default defineApiRoute(planOfPostRoute, ({ actor, params }) =>
  planItemOfPost(useDeps(), actor, { workspaceId: params.id, postId: params.postId }),
)
