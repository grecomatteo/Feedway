import { cropAvatar } from '@app/application'
import { cropAvatarRoute } from '@app/contracts'

export default defineApiRoute(
  cropAvatarRoute,
  async ({ body, session, ip }) => {
    const user = await onePerPerson(session.user.id, () =>
      cropAvatar(avatarDeps(), session.user, body, { ip }),
    )
    return { ...user, sessionState: session.state }
  },
  { rateLimit: AVATAR_RATE_LIMIT },
)
