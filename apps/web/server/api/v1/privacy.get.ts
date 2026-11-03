import { getPrivacyNotice } from '@app/application'
import { publicPrivacyNoticeRoute } from '@app/contracts'

// Public: the notice linked from the sign-in page (spec §15.7).
export default defineApiRoute(
  publicPrivacyNoticeRoute,
  () => getPrivacyNotice(privacyNoticeDeps(useDeps()), { organization: null }),
  { rateLimit: LINKS_RATE_LIMIT },
)
