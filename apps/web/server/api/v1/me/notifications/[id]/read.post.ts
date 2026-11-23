import { countMyUnreadNotifications, markMyNotificationRead } from '@app/application'
import { readMyNotificationRoute } from '@app/contracts'

export default defineApiRoute(readMyNotificationRoute, async ({ session, params }) => {
  const deps = useDeps()
  await markMyNotificationRead(deps, session.user.id, params.id)
  return { unread: await countMyUnreadNotifications(deps, session.user.id) }
})
