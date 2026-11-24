import { preparePlanItem } from '@app/application'
import { preparePlanItemRoute } from '@app/contracts'

export default defineApiRoute(
  preparePlanItemRoute,
  ({ actor, params, ip }) => preparePlanItem(useDeps(), actor, { itemId: params.itemId, ip }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
