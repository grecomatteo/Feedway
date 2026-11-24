import { notificationKinds, setMyNotificationKind } from '@app/application'
import { setMyNotificationKindRoute } from '@app/contracts'

export default defineApiRoute(setMyNotificationKindRoute, ({ session, body }) =>
  setMyNotificationKind(
    { uow: useDeps().uow, kinds: notificationKinds() },
    session.user.id,
    body.kind,
    body.channels,
  ),
)
