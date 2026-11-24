import { replaceTimeSlots } from '@app/application'
import { replaceTimeSlotsRoute } from '@app/contracts'

export default defineApiRoute(
  replaceTimeSlotsRoute,
  ({ actor, params, body, ip }) =>
    replaceTimeSlots(useDeps(), actor, { workspaceId: params.id, slots: body.slots }, { ip }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
