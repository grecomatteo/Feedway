import { getPrivacyNotice } from '@app/application'
import { organizationPrivacyNoticeRoute } from '@app/contracts'

export default defineApiRoute(organizationPrivacyNoticeRoute, ({ actor }) =>
  getPrivacyNotice(privacyNoticeDeps(useDeps()), { organization: actor }),
)
