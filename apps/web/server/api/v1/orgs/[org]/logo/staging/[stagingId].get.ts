import { readLogoStaging } from '@app/application'
import { logoStagingRoute } from '@app/contracts'

// Only in the agency's own folder: an id of another agency is simply not there (404).
export default defineApiRoute(logoStagingRoute, async ({ actor, params }) => {
  const preview = await readLogoStaging(logoDeps(), actor, params.stagingId)
  if (!preview) throw new HttpProblem('NOT_FOUND')
  return { body: preview.body, size: preview.size, cacheControl: 'private, no-store' }
})
