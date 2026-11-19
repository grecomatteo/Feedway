import { listAgendaIssues } from '@app/application'
import { agendaIssuesRoute } from '@app/contracts'

export default defineApiRoute(agendaIssuesRoute, ({ actor, query }) =>
  listAgendaIssues(useDeps(), actor, {
    ...(query.workspaceId === undefined ? {} : { workspaceId: query.workspaceId }),
    ...(query.from === undefined ? {} : { from: query.from }),
  }),
)
