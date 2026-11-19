import { listClientActivity } from '@app/application'
import { agendaClientsRoute } from '@app/contracts'

export default defineApiRoute(agendaClientsRoute, ({ actor, query }) =>
  listClientActivity(useDeps(), actor, query.from === undefined ? {} : { from: query.from }),
)
