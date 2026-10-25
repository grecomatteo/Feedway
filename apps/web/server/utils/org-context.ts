import type { H3Event } from 'h3'
import { resolveOrgActor } from '@app/application'
import type { OrgActor } from '@app/domain'

/**
 * The agency actor of a `/orgs/:org/**` route, resolved once per request. No session → 401;
 * not an active member, or an agency that does not exist → the same 404, so the answer never
 * says whether an agency exists; suspended → 403 ORGANIZATION_SUSPENDED.
 */
export function requireOrgActor(event: H3Event): Promise<OrgActor> {
  event.context.orgActor ??= (async () => {
    const { user } = await requireActiveSession(event)
    // any text is safe here: it is only compared with the slugs of the person's memberships
    const slug = getRouterParam(event, 'org', { decode: true }) ?? ''
    return resolveOrgActor({ uow: useDeps().uow }, { userId: user.id, organizationSlug: slug })
  })()
  return event.context.orgActor
}
