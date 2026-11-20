import { getPostOutcome } from '@app/application'
import { getPostOutcomeRoute } from '@app/contracts'

export default defineApiRoute(getPostOutcomeRoute, ({ actor, params }) =>
  getPostOutcome(useDeps(), actor, { workspaceId: params.id, postId: params.postId }),
)
