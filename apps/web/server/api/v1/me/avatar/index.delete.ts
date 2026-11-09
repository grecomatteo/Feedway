import { removeAvatar } from '@app/application'
import { removeAvatarRoute } from '@app/contracts'

export default defineApiRoute(removeAvatarRoute, async ({ session, ip }) => {
  const user = await removeAvatar(avatarDeps(), session.user, { ip })
  return meOf(user, session.state)
})
