import { deletePost } from '@app/application'
import { deletePostRoute } from '@app/contracts'

export default defineApiRoute(deletePostRoute, async ({ actor, params, ip }) => {
  await deletePost(useDeps(), actor, { workspaceId: params.id, postId: params.postId }, { ip })
  return { deleted: true as const }
})
