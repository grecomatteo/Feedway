import { listTimeSlots } from '@app/application'
import { listTimeSlotsRoute } from '@app/contracts'

export default defineApiRoute(listTimeSlotsRoute, ({ actor, params }) =>
  listTimeSlots(useDeps(), actor, { workspaceId: params.id }),
)
