import { sendPlatformTestEmail } from '@app/application'
import { platformMailTestRoute } from '@app/contracts'

export default defineApiRoute(
  platformMailTestRoute,
  ({ actor, session, body, ip }) =>
    sendPlatformTestEmail(platformMailDeps(useDeps()), actor, body.to, {
      ip,
      session: session.session,
    }),
  { rateLimit: MAIL_TEST_RATE_LIMIT_ROUTE },
)
