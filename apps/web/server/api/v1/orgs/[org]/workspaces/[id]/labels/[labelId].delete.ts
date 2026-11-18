import { deleteLabel } from '@app/application'
import { deleteLabelRoute } from '@app/contracts'

export default defineApiRoute(
  deleteLabelRoute,
  async ({ actor, params }) => {
    await deleteLabel(useDeps(), actor, { workspaceId: params.id, labelId: params.labelId })
    return { deleted: true as const }
  },
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
