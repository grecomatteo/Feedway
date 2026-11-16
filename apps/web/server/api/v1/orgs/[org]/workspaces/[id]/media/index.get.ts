import { listMedia } from '@app/application'
import { listMediaRoute } from '@app/contracts'

export default defineApiRoute(listMediaRoute, ({ actor, params, query }) =>
  listMedia(useDeps(), actor, {
    workspaceId: params.id,
    ...(query.before === undefined ? {} : { before: query.before }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    filter: {
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      ...(query.folder === undefined ? {} : { folder: query.folder }),
      ...(query.tag === undefined ? {} : { tag: query.tag }),
      ...(query.q === undefined ? {} : { name: query.q }),
    },
  }),
)
