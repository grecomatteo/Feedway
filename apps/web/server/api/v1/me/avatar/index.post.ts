import { uploadAvatarSource } from '@app/application'
import { uploadAvatarRoute } from '@app/contracts'

export default defineApiRoute(
  uploadAvatarRoute,
  async ({ file, session }) => {
    const source = await onePerPerson(session.user.id, () =>
      uploadAvatarSource(avatarDeps(), session.user, { bytes: file }),
    )
    return { ...source, previewUrl: `/api/v1/me/avatar/staging/${source.stagingId}` }
  },
  { rateLimit: AVATAR_RATE_LIMIT },
)
