import { defineContract } from '@app/contracts'
import { z } from 'zod'

// Only in the API tests: an agency route of the shape every /api/v1/orgs/:org route has.
const contract = defineContract({
  method: 'GET',
  path: '/api/__test/orgs/{org}/actor',
  summary: 'Test',
  request: { params: z.strictObject({ org: z.string() }) },
  response: z.object({ organizationId: z.string(), orgRole: z.string() }),
  auth: 'session',
  scope: 'organization',
})

const route = defineApiRoute(contract, ({ actor }) => ({
  organizationId: actor.organizationId,
  orgRole: actor.orgRole,
}))

export default defineEventHandler((event) => {
  assertTestRoutes()
  return route(event)
})
