import { listLabels } from '@app/application'
import { listLabelsRoute } from '@app/contracts'

export default defineApiRoute(listLabelsRoute, ({ actor, params }) =>
  listLabels(useDeps(), actor, { workspaceId: params.id }),
)
