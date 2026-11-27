import { trashPosts } from '@app/application'
import { trashPostsRoute } from '@app/contracts'

// «Elimina» of the panel (plan 09 Scelta 12): into the client's «Eliminati», all or none.
export default defineApiRoute(
  trashPostsRoute,
  ({ actor, params, body, ip }) =>
    trashPosts(useDeps(), actor, { workspaceId: params.id, postIds: body.postIds }, { ip }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
