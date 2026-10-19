import { describeLink } from '@app/application'

// Public: what the activation page shows before the form (Task 12). Task 19 moves these routes
// to defineApiRoute and the shared error mapping.
export default defineEventHandler(async (event) => {
  const limited = await limitLinkRoutes(event)
  if (limited) return limited
  const token = getRouterParam(event, 'token') ?? ''
  try {
    return await describeLink(identityDeps(useDeps()), { token })
  } catch (error) {
    return linkDomainError(event, error)
  }
})
