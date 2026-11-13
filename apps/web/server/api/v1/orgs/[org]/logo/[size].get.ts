import { readLogo } from '@app/application'
import { agencyLogoRoute } from '@app/contracts'

// The logo has no public address: a session and an active membership of the agency.
export default defineApiRoute(agencyLogoRoute, async ({ actor, params }) => {
  const logo = await readLogo(logoDeps(), actor, { size: params.size === '64' ? 64 : 256 })
  if (!logo) throw new HttpProblem('NOT_FOUND')
  return {
    body: logo.object.body,
    size: logo.object.size,
    etag: logo.hash,
    cacheControl: 'private, max-age=86400',
  }
})
