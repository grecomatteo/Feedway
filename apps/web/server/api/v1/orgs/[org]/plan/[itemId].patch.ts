import { updatePlanItem } from '@app/application'
import { updatePlanItemRoute } from '@app/contracts'

export default defineApiRoute(
  updatePlanItemRoute,
  ({ actor, params, body }) => updatePlanItem(useDeps(), actor, { itemId: params.itemId, ...body }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
