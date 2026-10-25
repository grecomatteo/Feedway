import { completeActivation } from '@app/application'
import { completeLinkRoute } from '@app/contracts'

// After the passkey of a new account is registered, with the session the activation opened.
export default defineApiRoute(
  completeLinkRoute,
  async ({ params, session }) => {
    await completeActivation(identityDeps(useDeps()), {
      token: params.token,
      userId: session.user.id,
    })
    return { done: true as const }
  },
  { rateLimit: LINKS_RATE_LIMIT },
)
