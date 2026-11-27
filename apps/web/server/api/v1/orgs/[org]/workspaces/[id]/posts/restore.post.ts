import { restorePosts } from '@app/application'
import { restorePostsRoute } from '@app/contracts'

// «Ripristina», and «Annulla» after «Elimina» (plan 09 Scelta 12).
export default defineApiRoute(
  restorePostsRoute,
  ({ actor, params, body, ip }) =>
    restorePosts(useDeps(), actor, { workspaceId: params.id, postIds: body.postIds }, { ip }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
