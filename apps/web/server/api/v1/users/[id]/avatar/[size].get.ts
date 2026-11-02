import { readAvatar } from '@app/application'
import { userAvatarRoute } from '@app/contracts'

// The photo has no public address: a session, and the person or a colleague of an active agency.
export default defineApiRoute(userAvatarRoute, async ({ params, session }) => {
  const photo = await readAvatar(avatarDeps(), session.user.id, {
    userId: params.id,
    size: params.size === '64' ? 64 : 256,
  })
  if (!photo) throw new HttpProblem('NOT_FOUND')
  return {
    body: photo.object.body,
    size: photo.object.size,
    etag: photo.hash,
    cacheControl: 'private, max-age=86400',
  }
})
