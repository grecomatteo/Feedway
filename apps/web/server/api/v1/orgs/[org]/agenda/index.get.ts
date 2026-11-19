import { listAgenda } from '@app/application'
import { agendaRoute } from '@app/contracts'

export default defineApiRoute(agendaRoute, ({ actor, query }) =>
  listAgenda(useDeps(), actor, {
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
    ...(query.workspaceId === undefined ? {} : { workspaceId: query.workspaceId }),
  }),
)
