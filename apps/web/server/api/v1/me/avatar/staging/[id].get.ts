import { readAvatarStaging } from '@app/application'
import { avatarStagingRoute } from '@app/contracts'

// Only in the person's own folder: another person's id is simply not there (404).
export default defineApiRoute(avatarStagingRoute, async ({ params, session }) => {
  const preview = await readAvatarStaging(avatarDeps(), session.user, params.id)
  if (!preview) throw new HttpProblem('NOT_FOUND')
  return { body: preview.body, size: preview.size, cacheControl: 'private, no-store' }
})
