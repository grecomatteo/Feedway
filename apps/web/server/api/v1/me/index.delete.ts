import { deleteMyAccount, userAnonymizedHandlers } from '@app/application'
import { deleteMeRoute } from '@app/contracts'
import { SESSION_COOKIE } from '@app/infrastructure'

export default defineApiRoute(deleteMeRoute, async ({ event, session, ip }) => {
  const { uow, clock, auth, storage, logger } = useDeps()
  await deleteMyAccount(
    { uow, clock, auth, storage, logger, onUserAnonymized: userAnonymizedHandlers() },
    session.user,
    session.session,
    { ip },
  )
  // the session row is gone already: the cookie goes too, so the browser stops sending it
  deleteCookie(event, SESSION_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'lax' })
  return { deleted: true as const }
})
