import { findNextFreeSlot } from '@app/application'
import { nextFreeSlotRoute } from '@app/contracts'

export default defineApiRoute(nextFreeSlotRoute, ({ actor, params, query }) =>
  findNextFreeSlot(useDeps(), actor, {
    workspaceId: params.id,
    ...(query.after === undefined ? {} : { after: new Date(query.after) }),
  }),
)
