import { findFreeSlots } from '@app/application'
import { freeSlotsRoute } from '@app/contracts'

export default defineApiRoute(freeSlotsRoute, ({ actor, params, query }) =>
  findFreeSlots(useDeps(), actor, {
    workspaceId: params.id,
    count: query.count ?? 1,
    ...(query.after === undefined ? {} : { after: new Date(query.after) }),
  }),
)
