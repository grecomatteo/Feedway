import { listPlan } from '@app/application'
import { listPlanRoute } from '@app/contracts'

export default defineApiRoute(listPlanRoute, ({ actor, query }) =>
  listPlan(useDeps(), actor, query),
)
