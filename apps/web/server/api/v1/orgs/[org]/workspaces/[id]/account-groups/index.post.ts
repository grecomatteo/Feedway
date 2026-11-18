import { createAccountGroup } from '@app/application'
import { createAccountGroupRoute } from '@app/contracts'

export default defineApiRoute(
  createAccountGroupRoute,
  ({ actor, params, body }) =>
    createAccountGroup(useDeps(), actor, { workspaceId: params.id, ...body }),
  { rateLimit: POST_WRITES_RATE_LIMIT },
)
