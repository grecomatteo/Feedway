import { listAgencyMedia } from '@app/application'
import { listAgencyMediaRoute } from '@app/contracts'

export default defineApiRoute(listAgencyMediaRoute, ({ actor, query }) =>
  listAgencyMedia(useDeps(), actor, {
    ...(query.workspaceId === undefined ? {} : { workspaceId: query.workspaceId }),
    ...(query.before === undefined ? {} : { before: query.before }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    filter: {
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      ...(query.tag === undefined ? {} : { tag: query.tag }),
      ...(query.q === undefined ? {} : { name: query.q }),
      ...(query.use === undefined ? {} : { use: query.use }),
    },
  }),
)
