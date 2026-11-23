import { countMyUnreadNotifications } from '@app/application'
import { myUnreadNotificationsRoute } from '@app/contracts'

export default defineApiRoute(myUnreadNotificationsRoute, async ({ session }) => ({
  unread: await countMyUnreadNotifications(useDeps(), session.user.id),
}))
