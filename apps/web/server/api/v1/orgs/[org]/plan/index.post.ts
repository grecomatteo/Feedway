import { createPlanItem } from '@app/application'
import { createPlanItemRoute } from '@app/contracts'

export default defineApiRoute(
  createPlanItemRoute,
  ({ actor, body }) => createPlanItem(useDeps(), actor, body),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
