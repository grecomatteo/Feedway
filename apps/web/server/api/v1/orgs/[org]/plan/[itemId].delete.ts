import { removePlanItem } from '@app/application'
import { deletePlanItemRoute } from '@app/contracts'

export default defineApiRoute(
  deletePlanItemRoute,
  async ({ actor, params }) => {
    await removePlanItem(useDeps(), actor, { itemId: params.itemId })
    return { deleted: true as const }
  },
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
