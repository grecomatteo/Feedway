import { lockAccountFromSecurityEmail } from '@app/application'
import { securityLockRoute } from '@app/contracts'

// Public: the link comes from a security email, with no session.
export default defineApiRoute(
  securityLockRoute,
  async ({ body, ip }) => {
    const deps = useDeps()
    await lockAccountFromSecurityEmail(
      { uow: deps.uow, tokens: deps.signedTokens, clock: deps.clock, queue: deps.queue },
      { token: body.token, ip },
    )
    return { locked: true as const }
  },
  { rateLimit: { name: 'security-lock', limit: 5, windowMs: 60_000 } },
)
