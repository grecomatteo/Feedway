import { listDraftsToFinish } from '@app/application'
import { agendaDraftsRoute } from '@app/contracts'

export default defineApiRoute(agendaDraftsRoute, ({ actor, query }) =>
  listDraftsToFinish(useDeps(), actor, {
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.workspaceId === undefined ? {} : { workspaceId: query.workspaceId }),
  }),
)
