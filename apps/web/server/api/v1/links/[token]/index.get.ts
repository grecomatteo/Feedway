import { describeLink } from '@app/application'
import { describeLinkRoute } from '@app/contracts'

// Public: what the activation page shows before the form (Task 12).
export default defineApiRoute(
  describeLinkRoute,
  ({ params }) => describeLink(identityDeps(useDeps()), { token: params.token }),
  { rateLimit: LINKS_RATE_LIMIT },
)
