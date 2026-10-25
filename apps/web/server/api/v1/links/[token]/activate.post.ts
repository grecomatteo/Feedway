import { activateAccount } from '@app/application'
import { activateLinkRoute } from '@app/contracts'

export default defineApiRoute(
  activateLinkRoute,
  async ({ event, params, body, session, ip, userAgent }) => {
    const result = await activateAccount(identityDeps(useDeps()), {
      token: params.token,
      ...body,
      ip,
      userAgent,
      sessionUserId: session?.user.id ?? null,
    })
    for (const cookie of result.setCookie) appendResponseHeader(event, 'set-cookie', cookie)
    return { organizationSlug: result.organizationSlug, next: result.next }
  },
  { rateLimit: LINKS_RATE_LIMIT },
)
