import { confirmEmailChange } from '@app/application'
import { confirmEmailChangeRoute } from '@app/contracts'

// Public: the link comes from the email to the new address, with or without a session.
export default defineApiRoute(
  confirmEmailChangeRoute,
  ({ body, ip, userAgent }) => {
    const deps = useDeps()
    return confirmEmailChange(
      { uow: deps.uow, queue: deps.queue, tokens: deps.tokens, clock: deps.clock },
      { token: body.token, ip, userAgent },
    )
  },
  { rateLimit: { name: 'email-change-confirm', limit: 10, windowMs: 60_000 } },
)
