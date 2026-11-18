import { listPosts } from '@app/application'
import { listPostsRoute } from '@app/contracts'

export default defineApiRoute(listPostsRoute, ({ actor, params, query }) =>
  listPosts(useDeps(), actor, {
    workspaceId: params.id,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.before === undefined ? {} : { before: query.before }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  }),
)
