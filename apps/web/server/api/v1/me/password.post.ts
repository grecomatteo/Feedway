import { createAuthEventSink, setFirstPassword } from '@app/application'
import { setMyPasswordRoute } from '@app/contracts'
import { passwordStrength } from '@app/infrastructure'

export default defineApiRoute(
  setMyPasswordRoute,
  async ({ event, body, session, ip, userAgent }) => {
    const { uow, clock, auth, queue, signedTokens, logger } = useDeps()
    await setFirstPassword(
      {
        uow,
        clock,
        auth,
        passwordStrength,
        events: createAuthEventSink({ uow, queue, tokens: signedTokens, clock, logger }),
      },
      session.session,
      body,
      { ip, userAgent, requestId: requestIdOf(event) },
    )
    return { passwordSet: true as const }
  },
)
