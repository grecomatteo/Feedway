import { uploadLogoSource } from '@app/application'
import { uploadLogoRoute } from '@app/contracts'

export default defineApiRoute(
  uploadLogoRoute,
  async ({ actor, session, file, params }) => {
    const source = await onePerPerson(session.user.id, () =>
      uploadLogoSource(logoDeps(), actor, session.session, { bytes: file }),
    )
    return {
      ...source,
      previewUrl: `/api/v1/orgs/${encodeURIComponent(params.org)}/logo/staging/${source.stagingId}`,
    }
  },
  { rateLimit: LOGO_RATE_LIMIT },
)
