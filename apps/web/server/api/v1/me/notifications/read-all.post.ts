import { countMyUnreadNotifications, markAllMyNotificationsRead } from '@app/application'
import { readAllMyNotificationsRoute } from '@app/contracts'

export default defineApiRoute(readAllMyNotificationsRoute, async ({ session }) => {
  const deps = useDeps()
  await markAllMyNotificationsRead(deps, session.user.id)
  return { unread: await countMyUnreadNotifications(deps, session.user.id) }
})
