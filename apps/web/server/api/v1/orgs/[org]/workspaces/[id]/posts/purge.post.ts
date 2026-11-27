import { purgePosts } from '@app/application'
import { purgePostsRoute } from '@app/contracts'

// «Elimina per sempre» and «Svuota» of «Eliminati» (plan 09 Scelta 12).
export default defineApiRoute(
  purgePostsRoute,
  ({ actor, params, body, ip }) =>
    purgePosts(
      useDeps(),
      actor,
      body.postIds === undefined
        ? { workspaceId: params.id, all: true }
        : { workspaceId: params.id, postIds: body.postIds },
      { ip },
    ),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
