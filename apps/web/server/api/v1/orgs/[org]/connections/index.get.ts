import { listConnections } from '@app/application'
import { listConnectionsRoute } from '@app/contracts'

export default defineApiRoute(listConnectionsRoute, async ({ actor }) => ({
  items: (await listConnections(connectionsDeps(useDeps()), actor)).map(connectionDto),
}))
